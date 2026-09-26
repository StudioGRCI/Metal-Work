'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const FORMATO = z.object({
  id: z.string().uuid(),
  orden_compra_id: z.string().uuid(),
  tipo: z.enum(['ORDEN_COMPRA', 'ORDEN_PAGO', 'ORDEN_SERVICIO', 'FACTURA', 'OTRO']),
})

export async function registrarDocumentoCompra(
  _previo: unknown,
  formulario: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Adjuntar documentos de compra corresponde a Logística.' }

  const datos = FORMATO.safeParse({
    id: formulario.get('id'),
    orden_compra_id: formulario.get('orden_compra_id'),
    tipo: formulario.get('tipo'),
  })
  const archivo = formulario.get('archivo')
  if (!datos.success || !(archivo instanceof File)) {
    return { ok: false, error: 'Selecciona el tipo de documento y un PDF.' }
  }
  if (archivo.size < 1 || archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
    return { ok: false, error: 'El archivo debe ser un PDF válido de hasta 20 MB.' }
  }

  const supabase = await createClient()
  const ruta = `compra/${datos.data.orden_compra_id}/${datos.data.id}.pdf`
  const { data: existente, error: errorExistente } = await supabase
    .from('documentos_compra_material')
    .select('id, orden_compra_id, subido_por')
    .eq('id', datos.data.id)
    .maybeSingle()
  if (errorExistente) return { ok: false, error: mensajeDeError(errorExistente) }
  if (existente) {
    if (existente.orden_compra_id !== datos.data.orden_compra_id || existente.subido_por !== perfil.id) {
      return { ok: false, error: 'Ese identificador ya pertenece a otro documento. Recarga la compra antes de volver a intentar.' }
    }
    return { ok: true, mensaje: 'El documento ya estaba adjuntado a la compra.' }
  }
  const { error: errorSubida } = await supabase.storage
    .from('documentos-compras')
    .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
  if (errorSubida) {
    return { ok: false, error: 'No se pudo subir el documento. Revisa la conexión y vuelve a intentar.' }
  }

  const { error } = await supabase.from('documentos_compra_material').insert({
    id: datos.data.id,
    orden_compra_id: datos.data.orden_compra_id,
    tipo: datos.data.tipo,
    nombre_archivo: archivo.name.trim().slice(0, 200) || 'Documento de compra.pdf',
    ruta_storage: ruta,
    mime_type: 'application/pdf',
    tamano_bytes: archivo.size,
    subido_por: perfil.id,
  })
  if (error) {
    const { error: errorLimpieza } = await supabase.storage.from('documentos-compras').remove([ruta])
    if (errorLimpieza) {
      return { ok: false, error: `${mensajeDeError(error)} El PDF quedó sin registrar; avisa a Administración para retirarlo con seguridad.` }
    }
    return { ok: false, error: mensajeDeError(error) }
  }

  revalidatePath('/materiales/atencion')
  revalidatePath('/tesoreria')
  return { ok: true, mensaje: 'Documento adjuntado a la compra y disponible para Tesorería.' }
}

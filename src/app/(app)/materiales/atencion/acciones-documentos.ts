'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { normalizarNumeroFactura } from '@/lib/dominio/finanzas'
import { hoyLima } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const FORMATO = z.object({
  id: z.guid(),
  orden_compra_id: z.guid(),
  tipo: z.enum(['ORDEN_COMPRA', 'ORDEN_PAGO', 'ORDEN_SERVICIO', 'FACTURA', 'COMPROBANTE', 'OTRO']),
  nombre_archivo: z.string().trim().min(1).max(200),
  // La factura anexada lleva su número y su fecha (migración 20261016702000):
  // Contabilidad la registra con ellos.
  factura_numero: z.string().trim().max(40).optional(),
  factura_fecha: z.union([z.literal(''), z.iso.date()]).optional(),
})

const campo = (formulario: FormData, nombre: string) => {
  const v = formulario.get(nombre)
  return typeof v === 'string' ? v : undefined
}

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
    nombre_archivo: formulario.get('nombre_archivo'),
    factura_numero: campo(formulario, 'factura_numero'),
    factura_fecha: campo(formulario, 'factura_fecha'),
  })
  if (!datos.success) {
    return {
      ok: false,
      error: datos.error.issues[0]?.path[0] === 'factura_fecha' ? 'Revisa la fecha de la factura.' : 'Selecciona el tipo de documento y un PDF.',
    }
  }
  const esFactura = datos.data.tipo === 'FACTURA'
  const numeroFactura = esFactura ? normalizarNumeroFactura(datos.data.factura_numero ?? '') : null
  const fechaFactura = esFactura ? datos.data.factura_fecha || null : null
  if (esFactura && !numeroFactura) return { ok: false, error: 'Escribe el número de la factura con su serie y su número, como F001-123.' }
  if (esFactura && !fechaFactura) return { ok: false, error: 'Escribe la fecha de la factura.' }
  if (fechaFactura && fechaFactura > hoyLima()) return { ok: false, error: 'La fecha de la factura no puede ser posterior a hoy.' }

  const supabase = await createClient()
  const ruta = `compra/${datos.data.orden_compra_id}/${datos.data.id}.pdf`
  const adjuntado = numeroFactura
    ? `Factura ${numeroFactura} adjuntada a la compra: Contabilidad la registra con su número y su fecha.`
    : 'Documento adjuntado a la compra y disponible para Tesorería.'
  // El mismo envío repetido (no le llegó la respuesta) recibe la misma respuesta
  // que la primera vez; con otro número, otra fecha u otra persona ya no es el
  // mismo, y la pantalla no puede decir que quedó lo que no se guardó.
  type Anotado = { orden_compra_id: string; subido_por: string; tipo: string; nombre_archivo: string; numero_documento: string | null; fecha_emision: string | null }
  const esElMismo = (d: Anotado) =>
    d.orden_compra_id === datos.data.orden_compra_id && d.subido_por === perfil.id && d.tipo === datos.data.tipo
    && d.nombre_archivo === datos.data.nombre_archivo && d.numero_documento === numeroFactura && d.fecha_emision === fechaFactura
  const { data: existente, error: errorExistente } = await supabase
    .from('documentos_compra_material')
    .select('orden_compra_id, subido_por, tipo, nombre_archivo, numero_documento, fecha_emision')
    .eq('id', datos.data.id)
    .maybeSingle()
  if (errorExistente) return { ok: false, error: mensajeDeError(errorExistente) }
  if (existente) {
    if (!esElMismo(existente)) {
      return { ok: false, error: 'Ese documento ya quedó adjuntado con otros datos. Recarga la compra para verlo antes de volver a intentar.' }
    }
    return { ok: true, mensaje: adjuntado }
  }
  const { data: archivo, error: errorSubida } = await supabase.storage
    .from('documentos-compras')
    .download(ruta)
  if (errorSubida || !archivo) {
    return { ok: false, error: 'No se pudo comprobar el PDF cargado. Revisa la conexión y vuelve a intentar.' }
  }
  if (archivo.size < 1 || archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
    return { ok: false, error: 'El archivo debe ser un PDF válido de hasta 20 MB.' }
  }

  const { data: guardado, error } = await supabase.from('documentos_compra_material').insert({
    id: datos.data.id,
    orden_compra_id: datos.data.orden_compra_id,
    tipo: datos.data.tipo,
    nombre_archivo: datos.data.nombre_archivo,
    ruta_storage: ruta,
    mime_type: 'application/pdf',
    tamano_bytes: archivo.size,
    subido_por: perfil.id,
    numero_documento: numeroFactura,
    fecha_emision: fechaFactura,
  }).select('id').maybeSingle()
  if (error) {
    if (error.code === '23505') {
      const repetido = await supabase.from('documentos_compra_material')
        .select('orden_compra_id, subido_por, tipo, nombre_archivo, numero_documento, fecha_emision').eq('id', datos.data.id).maybeSingle()
      if (!repetido.error && repetido.data && esElMismo(repetido.data)) return { ok: true, mensaje: adjuntado }
    }
    const { error: errorLimpieza } = await supabase.storage.from('documentos-compras').remove([ruta])
    if (errorLimpieza) {
      return { ok: false, error: `${mensajeDeError(error)} El PDF quedó sin registrar; avisa a Administración para retirarlo con seguridad.` }
    }
    return { ok: false, error: mensajeDeError(error) }
  }
  if (!guardado) return { ok: false, error: 'No se confirmó el documento. Recarga la compra antes de volver a intentar.' }

  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/kardex')
  revalidatePath('/adquisiciones')
  return { ok: true, mensaje: adjuntado }
}

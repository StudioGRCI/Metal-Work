'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { TIPO_DOCUMENTO_COMPRA } from '@/lib/dominio/adquisiciones'
import { normalizarNumeroFactura } from '@/lib/dominio/finanzas'
import { fecha, hoyLima } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const FORMATO = z.object({
  id: z.guid(),
  orden_compra_id: z.guid(),
  // La cotización del proveedor tiene su tipo desde la migración 20261020170000.
  tipo: z.enum(['COTIZACION', 'ORDEN_COMPRA', 'ORDEN_PAGO', 'ORDEN_SERVICIO', 'FACTURA', 'COMPROBANTE', 'OTRO']),
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
  const { data: existente, error: errorExistente } = await supabase
    .from('documentos_compra_material')
    .select('id, orden_compra_id, subido_por, tipo, nombre_archivo')
    .eq('id', datos.data.id)
    .maybeSingle()
  if (errorExistente) return { ok: false, error: mensajeDeError(errorExistente) }
  if (existente) {
    if (existente.orden_compra_id !== datos.data.orden_compra_id || existente.subido_por !== perfil.id
      || existente.tipo !== datos.data.tipo || existente.nombre_archivo !== datos.data.nombre_archivo) {
      return { ok: false, error: 'Ese identificador ya pertenece a otro documento. Recarga la compra antes de volver a intentar.' }
    }
    return { ok: true, mensaje: 'El documento ya estaba adjuntado a la compra.' }
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
  // El mismo PDF dos veces en la misma compra y con el mismo tipo (mismo nombre
  // y mismo tamaño) es un toque de más: en Adquisiciones salía la misma
  // cotización dos veces (2026-10-20). Con otro tipo sí entra: es la forma de
  // corregir uno mal elegido, porque un documento adjunto no se edita ni se borra.
  const { data: igual, error: errorIgual } = await supabase
    .from('documentos_compra_material')
    .select('tipo, creado_en')
    .eq('orden_compra_id', datos.data.orden_compra_id)
    .eq('nombre_archivo', datos.data.nombre_archivo)
    .eq('tamano_bytes', archivo.size)
    .eq('tipo', datos.data.tipo)
    // El que Logística anuló por un número mal escrito se vuelve a anexar bien.
    .is('anulado_en', null)
    .limit(1)
    .maybeSingle()
  if (errorIgual) return { ok: false, error: mensajeDeError(errorIgual) }
  if (igual) {
    return {
      ok: false,
      error: `Ese PDF ya está adjunto a esta compra como «${TIPO_DOCUMENTO_COMPRA[igual.tipo] ?? igual.tipo}» desde el ${fecha(igual.creado_en)}: no hace falta subirlo otra vez. Si es otro documento, revisa que elegiste el archivo correcto.`,
    }
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
        .select('orden_compra_id, subido_por, tipo, nombre_archivo').eq('id', datos.data.id).maybeSingle()
      if (!repetido.error && repetido.data?.orden_compra_id === datos.data.orden_compra_id
        && repetido.data.subido_por === perfil.id && repetido.data.tipo === datos.data.tipo
        && repetido.data.nombre_archivo === datos.data.nombre_archivo) {
        return { ok: true, mensaje: 'El documento ya estaba adjuntado a la compra.' }
      }
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
  revalidatePath('/tesoreria/por-pagar')
  if (!numeroFactura) return { ok: true, mensaje: 'Documento adjuntado a la compra y disponible para Tesorería.' }
  // La OC con boleta que Tesorería ya pagó directo: Contabilidad no registra ni
  // paga la factura hasta que se anule ese pago; si Contabilidad ya la tenía
  // registrada y pagada, la compra se pagó dos veces. Lo dice la base con la
  // misma regla del aviso a Tesorería; si no se pudo leer, no se afirma el paso
  // siguiente.
  const { data: situacion, error: errorSituacion } = await supabase.rpc('situacion_de_pago_de_compra', { p_compra: datos.data.orden_compra_id })
  if (errorSituacion) console.error('No se pudo leer el pago de la OC después de anexar su factura', errorSituacion)
  const s = situacion?.[0]
  const pagos = s?.pagos_vigentes ?? 0
  const esePago = pagos === 1 ? 'ese pago' : 'esos pagos'
  const registrada = s?.en_camino_origen === 'REGISTRADA'
  return {
    ok: true,
    mensaje: errorSituacion || !s
      ? `Factura ${numeroFactura} adjuntada a la compra.`
      : registrada && s.en_camino_alcanza === false
        ? `Factura ${numeroFactura} adjuntada a la compra, pero Contabilidad la registró para otras OC y no alcanza para esta: revisa el número. Si no es de esta OC, anula el anexo${pagos > 0 ? '; el pago por su boleta no se toca' : ' y la OC se paga por su boleta'}.`
      : pagos > 0 && registrada && Number(s.pagada_dos_veces ?? 0) > 0
        ? `Factura ${numeroFactura} adjuntada a la compra. Ojo: Tesorería ya pagó esta OC por su boleta y Contabilidad ya tenía esa factura registrada y pagada: la compra se pagó dos veces. Tesorería recibió el aviso para pedir la devolución al proveedor.`
        : pagos > 0 && registrada
          ? `Factura ${numeroFactura} adjuntada a la compra. Tesorería ya pagó esta OC por su boleta y Contabilidad ya tenía esa factura registrada: Tesorería anula ${esePago} y paga la factura con el mismo voucher.`
          : pagos > 0 && s.en_camino
            ? `Factura ${numeroFactura} adjuntada a la compra. Tesorería ya pagó esta OC por su boleta: Contabilidad registra la factura cuando Tesorería anule ${esePago}.`
            : registrada
              ? `Factura ${numeroFactura} adjuntada a la compra: Contabilidad ya la tenía registrada, y la OC se paga por ella en Cuentas por pagar.`
              : `Factura ${numeroFactura} adjuntada a la compra: Contabilidad la registra con su número y su fecha.`,
  }
}

const ANULACION = z.object({
  id: z.guid(),
  motivo: z.string().trim().min(10, 'Cuenta por qué se anula, en 10 a 500 caracteres.').max(500, 'El motivo va en 10 a 500 caracteres.'),
})

/**
 * Logística anula la factura o la boleta que anexó por error a una OC, con su
 * motivo (migración 20261020210000): queda tachada como evidencia y deja de
 * contar para el pago. Mismo permiso que la anexa (`compras.crear`); la base
 * avisa a Tesorería y a Contabilidad si les cambia algo.
 */
export async function anularDocumentoCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Anular un documento de compra corresponde a Logística.' }
  const datos = ANULACION.safeParse({ id: formulario.get('id'), motivo: formulario.get('motivo') })
  if (!datos.success) return { ok: false, error: datos.error.issues[0]?.message ?? 'Cuenta por qué se anula.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_documento_compra', { p_id: datos.data.id, p_motivo: datos.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó la anulación. Recarga la pantalla antes de volver a intentar.' }
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/compras')
  revalidatePath('/ordenes/[id]', 'page')
  return { ok: true, mensaje: 'Documento anulado: queda tachado con su motivo y ya no cuenta para el pago de la OC.' }
}

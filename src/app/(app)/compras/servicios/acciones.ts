'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { CODIGO_INTERNO_LARGO, FALTA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { NO_SUJETA } from '@/lib/dominio/detraccion'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

function refrescar() {
  revalidatePath('/compras/servicios')
  revalidatePath('/compras/aprobacion')
}

/** El tipo de SUNAT (tres cifras) o «no sujeta», con su motivo. */
const detraccion = z.union([z.literal(NO_SUJETA), z.string().regex(/^[0-9]{3}$/)], {
  message: 'Indica si el servicio lleva detracción: elige su tipo según SUNAT, o «No está sujeta».',
})

function motivoDeNoSujeta(tipo: string, motivo: string) {
  if (tipo === NO_SUJETA && (motivo.length < 5 || motivo.length > 200)) {
    return 'Escribe por qué no está sujeta a detracción (de 5 a 200 caracteres), por ejemplo: el proveedor no cobra IGV.'
  }
  return null
}

/**
 * La orden de servicio: un trabajo que hace un tercero (un torno, una pintura,
 * un doblez), con el código interno de la unidad y su detracción. Exige
 * `compras.crear`, el mismo permiso que `emitir_orden_servicio`. Siempre espera
 * la aprobación de Gerencia.
 */
export async function emitirOrdenServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Tu perfil no puede emitir órdenes de servicio.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      proveedor_id: z.guid('Elige el proveedor del padrón. Si es nuevo, regístralo con «Nuevo».'),
      orden_id: z.guid().optional(),
      area_id: z.guid().optional(),
      codigo_interno: z.string().trim().min(2, FALTA_CODIGO_INTERNO).max(60, CODIGO_INTERNO_LARGO),
      descripcion: z
        .string()
        .trim()
        .min(10, 'Describe el servicio en al menos 10 caracteres: qué se hace, a qué pieza o unidad.')
        .max(1000, 'La descripción pasa de 1000 caracteres.'),
      referencia: z.string().trim().max(100, 'La referencia del proveedor pasa de 100 caracteres.'),
      fecha_inicio: z.iso.date().optional(),
      fecha_fin: z.iso.date().optional(),
      moneda: z.enum(['PEN', 'USD']),
      monto: z.coerce
        .number({ message: 'Indica el monto sin IGV.' })
        .min(0, 'El monto no puede ser negativo.')
        .max(999999999, 'El monto es demasiado grande.')
        .multipleOf(0.01, 'El monto lleva como máximo dos decimales.'),
      condicion: z.enum(['CONTADO', 'CREDITO']),
      dias: z.coerce.number().int().min(0).max(365),
      detraccion,
      motivo_detraccion: z.string().trim(),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      proveedor_id: dato(formulario, 'proveedor_id'),
      orden_id: dato(formulario, 'orden_id') || undefined,
      area_id: dato(formulario, 'area_id') || undefined,
      codigo_interno: dato(formulario, 'codigo_interno'),
      descripcion: dato(formulario, 'descripcion'),
      referencia: dato(formulario, 'referencia'),
      fecha_inicio: dato(formulario, 'fecha_inicio') || undefined,
      fecha_fin: dato(formulario, 'fecha_fin') || undefined,
      moneda: dato(formulario, 'moneda'),
      monto: dato(formulario, 'monto'),
      condicion: dato(formulario, 'condicion'),
      dias: dato(formulario, 'dias'),
      detraccion: dato(formulario, 'detraccion'),
      motivo_detraccion: dato(formulario, 'motivo_detraccion'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la orden de servicio.' }
  const d = analisis.data
  const faltaMotivo = motivoDeNoSujeta(d.detraccion, d.motivo_detraccion)
  if (faltaMotivo) return { ok: false, error: faltaMotivo }
  if (d.referencia && d.referencia.length < 2) {
    return { ok: false, error: 'La referencia del proveedor va de 2 a 100 caracteres, o déjala vacía.' }
  }
  if ((d.condicion === 'CONTADO' && d.dias !== 0) || (d.condicion === 'CREDITO' && d.dias === 0)) {
    return { ok: false, error: 'Indica 0 días para contado o un plazo de 1 a 365 días para crédito.' }
  }
  if (d.fecha_inicio && d.fecha_fin && d.fecha_fin < d.fecha_inicio) {
    return { ok: false, error: 'La fecha de término no puede ser anterior a la de inicio.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_orden_servicio', {
    p_id: d.operacion_id,
    p_proveedor_id: d.proveedor_id,
    p_orden_id: d.orden_id ?? null,
    p_area_id: d.area_id ?? null,
    p_codigo_interno: d.codigo_interno,
    p_descripcion: d.descripcion,
    p_referencia: d.referencia || null,
    p_fecha_inicio: d.fecha_inicio ?? null,
    p_fecha_fin: d.fecha_fin ?? null,
    p_moneda: d.moneda,
    p_monto: d.monto,
    p_condicion: d.condicion,
    p_dias: d.dias,
    p_detraccion: d.detraccion,
    p_motivo_detraccion: d.detraccion === NO_SUJETA ? d.motivo_detraccion : null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'La orden de servicio no quedó registrada. Recarga la pantalla.' }

  const { data: emitida } = await supabase.from('ordenes_servicio').select('numero').eq('id', d.operacion_id).maybeSingle()

  refrescar()
  return { ok: true, mensaje: `Orden de servicio ${emitida?.numero ?? ''} emitida. Gerencia la aprueba antes de que el proveedor empiece.` }
}

const PASOS = {
  EN_EJECUCION: 'Marcada en ejecución.',
  CONFORME: 'Conformidad registrada: Tesorería ya puede pagarla.',
  ANULADA: 'Orden de servicio anulada. Queda con su número y su motivo.',
} as const

/** En ejecución, conforme o anulada. Mismo permiso que `avanzar_orden_servicio`. */
export async function avanzarOrdenServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Llevar las órdenes de servicio corresponde a Logística.' }

  const analisis = z
    .object({
      id: z.guid(),
      paso: z.enum(['EN_EJECUCION', 'CONFORME', 'ANULADA']),
      nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), paso: formulario.get('paso'), nota: dato(formulario, 'nota') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  if (analisis.data.paso === 'ANULADA' && analisis.data.nota.length < 10) {
    return { ok: false, error: 'Cuenta por qué se anula, en al menos 10 caracteres.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('avanzar_orden_servicio', {
    p_id: analisis.data.id,
    p_paso: analisis.data.paso,
    p_nota: analisis.data.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return { ok: true, mensaje: PASOS[analisis.data.paso] }
}

/**
 * Corrige el código interno o la detracción de una OS. El código lo cambia
 * Logística (`compras.crear`) hasta la conformidad; la detracción, Logística o
 * Contabilidad (`compras.detraccion`) hasta que se anula. Mismos permisos que
 * `corregir_orden_servicio`, que decide cuál toca.
 */
export async function corregirOrdenServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['compras.crear', 'compras.detraccion'])) {
    return { ok: false, error: 'Corregir una orden de servicio corresponde a Logística, y su detracción también a Contabilidad.' }
  }

  const analisis = z
    .object({
      id: z.guid(),
      codigo_interno: z.string().trim().max(60, CODIGO_INTERNO_LARGO),
      detraccion,
      motivo_detraccion: z.string().trim(),
    })
    .safeParse({
      id: formulario.get('id'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      detraccion: dato(formulario, 'detraccion'),
      motivo_detraccion: dato(formulario, 'motivo_detraccion'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data
  if (d.codigo_interno && d.codigo_interno.length < 2) return { ok: false, error: FALTA_CODIGO_INTERNO }
  const faltaMotivo = motivoDeNoSujeta(d.detraccion, d.motivo_detraccion)
  if (faltaMotivo) return { ok: false, error: faltaMotivo }

  const supabase = await createClient()
  const { error } = await supabase.rpc('corregir_orden_servicio', {
    p_id: d.id,
    p_codigo_interno: d.codigo_interno || null,
    p_detraccion: d.detraccion,
    p_motivo_detraccion: d.detraccion === NO_SUJETA ? d.motivo_detraccion : null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  revalidatePath('/codigos-internos/detalle')
  return { ok: true, mensaje: 'Orden de servicio corregida.' }
}

/** Adjuntan y anulan los documentos de una OS los mismos que la base: `puede_adjuntar_documento_servicio`. */
const ADJUNTAN = ['compras.crear', 'tesoreria.pagar_servicios']
const NO_ADJUNTA = 'Los documentos de la orden de servicio los adjuntan Logística y Tesorería.'

function repintarDocumentos() {
  revalidatePath('/compras/servicios')
  revalidatePath('/tesoreria/pagos-de-servicio')
  revalidatePath('/adquisiciones')
}

/**
 * Anota la factura, la boleta, el recibo, el contrato u otro documento de una
 * OS, ya subido a `documentos-servicio/{orden de servicio}/…` (migración
 * 20261020210000). El número va solo con la factura, la boleta y el recibo. El
 * id llega de la pantalla: un reintento no anota otro.
 */
export async function adjuntarDocumentoServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ADJUNTAN)) return { ok: false, error: NO_ADJUNTA }
  const analisis = z
    .object({
      id: z.guid(),
      orden_servicio_id: z.guid(),
      tipo: z.enum(['FACTURA', 'BOLETA', 'RECIBO', 'CONTRATO', 'OTRO'], 'Elige qué documento es.'),
      numero: z.string().trim().max(30, 'El número pasa de 30 caracteres.'),
      nombre: z.string().trim().min(1, 'Adjunta el archivo.').max(200),
      ruta: z.string().min(1, 'Adjunta el archivo.').max(200),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      orden_servicio_id: dato(formulario, 'orden_servicio_id'),
      tipo: dato(formulario, 'tipo'),
      numero: dato(formulario, 'numero'),
      nombre: dato(formulario, 'nombre'),
      ruta: dato(formulario, 'ruta'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el documento.' }
  const d = analisis.data
  const comprobante = d.tipo === 'FACTURA' || d.tipo === 'BOLETA' || d.tipo === 'RECIBO'
  if (comprobante && d.numero.length < 3) return { ok: false, error: 'Escribe el número del comprobante con su serie, como F001-123.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('adjuntar_documento_servicio', {
    p_id: d.id,
    p_orden_servicio: d.orden_servicio_id,
    p_tipo: d.tipo,
    p_numero: comprobante ? d.numero : null,
    p_nombre: d.nombre,
    p_ruta: d.ruta,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El documento no se anotó. Recarga la pantalla.' }
  repintarDocumentos()
  return { ok: true, mensaje: 'Documento adjunto a la orden de servicio.' }
}

/** Anular con su motivo un documento adjunto por error: queda como evidencia. Mismo permiso que `anular_documento_servicio`. */
export async function anularDocumentoServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ADJUNTAN)) return { ok: false, error: NO_ADJUNTA }
  const analisis = z
    .object({ id: z.guid(), motivo: z.string().trim().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.') })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_documento_servicio', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El documento no se anuló. Recarga la pantalla.' }
  repintarDocumentos()
  return { ok: true, mensaje: 'Documento anulado: queda en el historial con su motivo.' }
}

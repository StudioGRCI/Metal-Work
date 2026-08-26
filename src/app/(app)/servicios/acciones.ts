'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const TIPOS = [
  'ARENADO',
  'CORTE_LASER',
  'CORTE_PLASMA',
  'DOBLADO',
  'TORNO',
  'GALVANIZADO',
  'TRATAMIENTO_TERMICO',
  'TAPICERIA',
  'PINTURA',
  'ELECTRICIDAD',
  'HIDRAULICA',
  'TRANSPORTE',
  'CERTIFICACION',
  'OTRO',
] as const

const esquemaAlta = z.object({
  orden_id: z.string().uuid('Elige la orden de trabajo'),
  proveedor_id: z.string().uuid('Elige el proveedor'),
  tipo_servicio: z.enum(TIPOS),
  descripcion: z.string().trim().min(5, 'Describe el trabajo que se manda a hacer'),
  especificacion: z.string().trim().optional(),
  fecha: z.string().trim().min(1, 'Falta la fecha'),
  plazo_dias: z.coerce.number().int().min(0).max(365).default(0),
  moneda: z.enum(['PEN', 'USD']).default('PEN'),
  monto: z.coerce.number().positive('El monto tiene que ser mayor que cero'),
  tipo_cambio: z.coerce.number().positive().default(1),
})

function nulo(valor: string | undefined) {
  const t = valor?.trim()
  return t ? t : null
}

/** Suma días de calendario a una fecha en formato AAAA-MM-DD. */
function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T00:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

export async function crearOrdenDeServicio(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['compras.crear', 'costos.editar'])) {
    return { ok: false, error: 'No tienes permiso para emitir órdenes de servicio.' }
  }

  const analisis = esquemaAlta.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del servicio.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase.from('servicios_terceros').insert({
    orden_id: v.orden_id,
    proveedor_id: v.proveedor_id,
    tipo_servicio: v.tipo_servicio,
    descripcion: v.descripcion,
    especificacion: nulo(v.especificacion),
    fecha: v.fecha,
    plazo_dias: v.plazo_dias || null,
    fecha_entrega: v.plazo_dias ? sumarDias(v.fecha, v.plazo_dias) : null,
    moneda: v.moneda,
    monto: v.monto,
    tipo_cambio: v.moneda === 'PEN' ? 1 : v.tipo_cambio,
    estado: 'SOLICITADO',
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/servicios')
  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/costos')
  return { ok: true, mensaje: 'Orden de servicio emitida.' }
}

export async function cambiarEstadoServicio(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['compras.crear', 'costos.editar'])) {
    return { ok: false, error: 'No tienes permiso para mover una orden de servicio.' }
  }

  const analisis = z
    .object({
      id: z.string().uuid(),
      estado: z.enum(['EN_EJECUCION', 'EJECUTADO', 'ANULADO']),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('servicios_terceros')
    .update({ estado: analisis.data.estado })
    .eq('id', analisis.data.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/servicios')
  revalidatePath('/costos')
  return { ok: true, mensaje: 'Orden de servicio actualizada.' }
}

export async function darConformidad(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'calidad.inspeccionar')) {
    return { ok: false, error: 'La conformidad la da calidad o la jefatura de taller.' }
  }

  const analisis = z
    .object({ id: z.string().uuid(), observaciones: z.string().trim().optional() })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('dar_conformidad_servicio', {
    p_servicio: analisis.data.id,
    p_observaciones: analisis.data.observaciones?.trim() || undefined,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/servicios')
  revalidatePath('/costos')
  return { ok: true, mensaje: 'Conformidad registrada: ya cuenta como costo de la unidad.' }
}

export async function registrarPago(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.editar')) {
    return { ok: false, error: 'No tienes permiso para registrar el pago.' }
  }

  const analisis = z
    .object({
      id: z.string().uuid(),
      numero_factura: z.string().trim().min(3, 'Falta el número de factura'),
      fecha_factura: z.string().trim().min(1, 'Falta la fecha de la factura'),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos de la factura.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('servicios_terceros')
    .update({
      estado: 'PAGADO',
      numero_factura: analisis.data.numero_factura,
      fecha_factura: analisis.data.fecha_factura,
    })
    .eq('id', analisis.data.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/servicios')
  revalidatePath('/costos')
  return { ok: true, mensaje: 'Pago registrado.' }
}

'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'

export type ResultadoAccion = { ok: true; mensaje?: string } | { ok: false; error: string }

/**
 * Traduce los errores de Postgres a algo que el usuario del taller entienda.
 * Los triggers del esquema ya lanzan mensajes en español; se aprovechan tal cual
 * y solo se traduce lo que viene del propio motor.
 */
function mensajeDeError(error: { message: string; code?: string }): string {
  const m = error.message

  if (error.code === '23505') return 'Ya existe un registro con esos datos.'
  if (error.code === '23503') return 'El registro está referenciado por otro documento y no se puede modificar.'
  if (error.code === '42501' || error.code === 'PGRST301')
    return 'No tienes permisos para realizar esta operación.'

  // Los mensajes de los triggers propios ya vienen redactados en español para el
  // usuario; solo se reescribe el texto crudo de una restricción CHECK del motor.
  const check = /violates check constraint "([^"]+)"/.exec(m)
  if (check) return `El dato no cumple la regla ${check[1]}.`

  return m
}

const esquemaNuevaOrden = z.object({
  cliente_id: z.string().uuid('Selecciona un cliente'),
  unidad_id: z.string().uuid().optional().or(z.literal('')),
  sede_id: z.string().uuid('Selecciona la sede o taller'),
  tipo_carroceria_id: z.string().uuid().optional().or(z.literal('')),
  tipo_trabajo: z.enum(['FABRICACION', 'REPARACION', 'REPOTENCIACION', 'MANTENIMIENTO', 'GARANTIA']),
  prioridad: z.enum(['BAJA', 'NORMAL', 'ALTA', 'URGENTE']),
  descripcion: z.string().trim().min(5, 'Describe el trabajo a realizar'),
  especificaciones_tecnicas: z.string().trim().optional(),
  fecha_inicio_programada: z.string().optional(),
  fecha_fin_programada: z.string().optional(),
  fecha_entrega_comprometida: z.string().optional(),
  responsable_id: z.string().uuid().optional().or(z.literal('')),
  monto_presupuestado: z.coerce.number().min(0).default(0),
  observaciones: z.string().trim().optional(),
})

function opcional(valor: FormDataEntryValue | null) {
  const t = typeof valor === 'string' ? valor.trim() : ''
  return t === '' ? null : t
}

export async function crearOrden(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.crear')) return { ok: false, error: 'No tienes permiso para crear órdenes.' }

  const analisis = esquemaNuevaOrden.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del formulario.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ordenes_trabajo')
    .insert({
      cliente_id: v.cliente_id,
      unidad_id: opcional(v.unidad_id ?? null),
      sede_id: v.sede_id,
      tipo_carroceria_id: opcional(v.tipo_carroceria_id ?? null),
      tipo_trabajo: v.tipo_trabajo,
      prioridad: v.prioridad,
      descripcion: v.descripcion,
      especificaciones_tecnicas: opcional(v.especificaciones_tecnicas ?? null),
      fecha_inicio_programada: opcional(v.fecha_inicio_programada ?? null),
      fecha_fin_programada: opcional(v.fecha_fin_programada ?? null),
      fecha_entrega_comprometida: opcional(v.fecha_entrega_comprometida ?? null),
      responsable_id: opcional(v.responsable_id ?? null),
      monto_presupuestado: v.monto_presupuestado,
      observaciones: opcional(v.observaciones ?? null),
    })
    .select('id, numero')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/ordenes')
  redirect(`/ordenes/${data.id}?creada=1`)
}

const esquemaCambioEstado = z.object({
  orden_id: z.string().uuid(),
  estado: z.enum([
    'BORRADOR', 'APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA',
    'CONTROL_CALIDAD', 'TERMINADA', 'ENTREGADA', 'FACTURADA', 'ANULADA',
  ]),
  motivo: z.string().trim().optional(),
})

export async function cambiarEstadoOrden(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()

  const analisis = esquemaCambioEstado.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Solicitud inválida.' }
  const { orden_id, estado, motivo } = analisis.data

  const permisoNecesario =
    estado === 'APROBADA' ? 'ordenes.aprobar'
    : estado === 'ANULADA' ? 'ordenes.anular'
    : estado === 'ENTREGADA' ? 'ordenes.entregar'
    : 'ordenes.cambiar_estado'

  if (!puede(perfil, permisoNecesario)) {
    return { ok: false, error: 'No tienes permiso para realizar este cambio de estado.' }
  }

  // Pausar y anular exigen motivo; la base también lo valida, pero avisar aquí
  // evita un viaje al servidor con un mensaje menos claro.
  if ((estado === 'PAUSADA' || estado === 'ANULADA') && !motivo) {
    return { ok: false, error: 'Indica el motivo para continuar.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('ordenes_trabajo')
    .update({
      estado,
      ...(estado === 'PAUSADA' ? { motivo_pausa: motivo } : {}),
      ...(estado === 'ANULADA' ? { motivo_anulacion: motivo } : {}),
    })
    .eq('id', orden_id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${orden_id}`)
  revalidatePath('/ordenes')
  return { ok: true, mensaje: 'Estado actualizado.' }
}

const esquemaAvanceEtapa = z.object({
  etapa_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  avance_porcentaje: z.coerce.number().min(0).max(100),
  estado: z.enum(['PENDIENTE', 'EN_PROCESO', 'PAUSADA', 'TERMINADA', 'OMITIDA']),
  observaciones: z.string().trim().optional(),
})

export async function actualizarEtapa(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para registrar avance de producción.' }
  }

  const analisis = esquemaAvanceEtapa.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase
    .from('ot_etapas')
    .update({
      avance_porcentaje: v.avance_porcentaje,
      estado: v.estado,
      observaciones: v.observaciones || null,
    })
    .eq('id', v.etapa_id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Avance registrado.' }
}

const esquemaComentario = z.object({
  orden_id: z.string().uuid(),
  descripcion: z.string().trim().min(3, 'Escribe el comentario'),
})

export async function comentarOrden(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.ver')) return { ok: false, error: 'No tienes acceso a esta orden.' }

  const analisis = esquemaComentario.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el comentario.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('ot_registrar_evento', {
    p_orden_id: analisis.data.orden_id,
    p_tipo: 'COMENTARIO',
    p_descripcion: analisis.data.descripcion,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Comentario registrado.' }
}

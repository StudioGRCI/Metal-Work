'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Las observaciones de la orden (migración 106) se escriben solo por sus dos
 * funciones: son las que avisan al área y al jefe, dejan la traza en la
 * bitácora y deciden quién resuelve. Acá se valida la forma para responder
 * rápido; las reglas las pone la base y sus mensajes llegan tal cual.
 */
const esquemaLevantar = z.object({
  orden_id: z.string().uuid(),
  area_id: z.string().uuid('Elige a qué área va la observación'),
  descripcion: z
    .string()
    .trim()
    .min(3, 'Cuenta qué está mal: el área tiene que entenderlo sin preguntar')
    .max(2000, 'La observación pasa de 2000 caracteres: resúmela'),
})

export async function levantarObservacion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.ver')) return { ok: false, error: 'No tienes acceso a esta orden.' }

  const analisis = esquemaLevantar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la observación.' }
  }
  const v = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('levantar_observacion_ot', {
    p_orden: v.orden_id,
    p_area: v.area_id,
    p_descripcion: v.descripcion,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Observación anotada: se les avisó al área y al jefe de producción.' }
}

const esquemaResolver = z.object({
  id: z.string().uuid(),
  orden_id: z.string().uuid(),
  resolucion: z
    .string()
    .trim()
    .min(3, 'Cuenta qué se hizo para resolverla')
    .max(1000, 'Lo que se hizo pasa de 1000 caracteres: resúmelo'),
})

export async function resolverObservacion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.ver')) return { ok: false, error: 'No tienes acceso a esta orden.' }

  const analisis = esquemaResolver.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa lo que se hizo.' }
  }
  const v = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('resolver_observacion_ot', {
    p_id: v.id,
    p_resolucion: v.resolucion,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Observación resuelta.' }
}

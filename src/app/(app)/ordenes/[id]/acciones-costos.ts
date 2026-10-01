'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const id = z.string().uuid()

export async function solicitarTesoreria(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.solicitar_pago')) return { ok: false, error: 'Solo Costos y Materiales envía estas solicitudes.' }
  // Desde la OT solo se pide la revisión de salida: la solicitud de pago de
  // materiales se retiró de la pestaña Costos el 2026-10-01.
  const entrada = z.object({
    orden_id: id,
    concepto: z.string().trim().min(10).max(1000),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa la solicitud.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_solicitudes_tesoreria').insert({
    orden_id: v.orden_id, tipo: 'SALIDA_OT', concepto: v.concepto, monto: null, moneda: null,
  }).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/tesoreria')
  return { ok: true, mensaje: 'Solicitud enviada a Tesorería.' }
}

export async function responderSolicitudTesoreria(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.liberar')) return { ok: false, error: 'Solo Tesorería responde estas solicitudes.' }
  const entrada = z.object({
    id,
    orden_id: id,
    estado: z.enum(['ATENDIDA', 'OBSERVADA']),
    respuesta: z.string().trim().min(3).max(2000),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Indica la respuesta.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_solicitudes_tesoreria')
    .update({ estado: v.estado, respuesta: v.respuesta, atendido_por: perfil.id, atendido_en: new Date().toISOString() })
    .eq('id', v.id).eq('orden_id', v.orden_id).eq('estado', 'PENDIENTE')
    .select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/tesoreria')
  return { ok: true, mensaje: 'Respuesta registrada en la OT.' }
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const id = z.string().uuid()

export async function guardarChecklist(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.controlar_ot')) return { ok: false, error: 'Solo Costos y Materiales registra estas listas.' }
  const entrada = z.object({
    orden_id: id,
    tipo: z.enum(['INGRESO', 'SALIDA']),
    observacion: z.string().trim().max(2000),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa la lista.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_checklists').upsert({
    orden_id: v.orden_id,
    tipo: v.tipo,
    identidad_verificada: datos.get('identidad_verificada') === 'on',
    documentos_verificados: datos.get('documentos_verificados') === 'on',
    materiales_verificados: datos.get('materiales_verificados') === 'on',
    condicion_verificada: datos.get('condicion_verificada') === 'on',
    observacion: v.observacion,
  }, { onConflict: 'orden_id,tipo' }).select('id, completado_en').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: data.completado_en ? 'Lista completada y guardada.' : 'Avance de la lista guardado.' }
}

export async function solicitarTesoreria(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.solicitar_pago')) return { ok: false, error: 'Solo Costos y Materiales envía estas solicitudes.' }
  const entrada = z.object({
    orden_id: id,
    tipo: z.enum(['MATERIALES', 'SALIDA_OT']),
    concepto: z.string().trim().min(10).max(1000),
    monto: z.string().trim(),
    moneda: z.enum(['PEN', 'USD', '']),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa la solicitud.' }
  const v = entrada.data
  const monto = v.tipo === 'MATERIALES' ? Number(v.monto) : null
  if (v.tipo === 'MATERIALES' && (!Number.isFinite(monto) || monto === null || monto <= 0 || !/^\d{1,12}(?:\.\d{1,2})?$/.test(v.monto) || !v.moneda)) {
    return { ok: false, error: 'Indica el importe y moneda del pago de materiales.' }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_solicitudes_tesoreria').insert({
    orden_id: v.orden_id, tipo: v.tipo, concepto: v.concepto,
    monto, moneda: v.tipo === 'MATERIALES' ? (v.moneda as 'PEN' | 'USD') : null,
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

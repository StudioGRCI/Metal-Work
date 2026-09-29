'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ResultadoAccion, mensajeDeError, NO_TOCO_NADA } from '@/lib/acciones'
import { CRITERIOS_DISENO, puntajeDiseno } from '@/lib/dominio/evaluacion-diseno'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

export async function crearEvaluacionDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) return { ok: false, error: 'Solo Jefatura de Diseño registra evaluaciones.' }
  const entrada = z.object({
    id: z.string().uuid(),
    evaluado_nombre: z.string().trim().min(2).max(120),
    puesto: z.string().trim().min(2).max(100),
    fecha_ingreso: z.union([z.iso.date(), z.literal('')]),
    fecha_evaluacion: z.iso.date(),
    comentarios: z.string().trim().max(3000),
  }).safeParse(Object.fromEntries(datos))
  const respuestas = CRITERIOS_DISENO.map((_, i) => Number(datos.get(`puntaje_${i}`)))
  if (!entrada.success) return { ok: false, error: 'Completa los datos de la persona y la fecha.' }
  try { puntajeDiseno(respuestas) }
  catch { return { ok: false, error: 'Califica los veinte criterios de 1 a 5.' } }
  const db = await createClient()
  const v = entrada.data
  const { data, error } = await db.from('diseno_evaluaciones').insert({
    id: v.id, evaluado_nombre: v.evaluado_nombre, puesto: v.puesto,
    fecha_ingreso: v.fecha_ingreso || null, fecha_evaluacion: v.fecha_evaluacion,
    respuestas, comentarios: v.comentarios, evaluador_id: perfil.id,
  }).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/diseno/evaluaciones')
  return { ok: true, mensaje: `Evaluación registrada: ${puntajeDiseno(respuestas)} de 100 puntos.` }
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

async function exigirGestion() {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'garantias.gestionar')) {
    return 'Registrar o evaluar reclamos es del área de garantías.'
  }
  return null
}

/** El reclamo entra tal como llega; la base sella si está dentro del plazo. */
export async function registrarReclamo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirGestion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      entrega_id: z.string().uuid(),
      descripcion: z.string().trim().min(5, 'Cuenta qué reclama el cliente'),
      reportado_por: z.string().trim().optional(),
      contacto: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reclamo.' }
  }

  const v = analisis.data
  const supabase = await createClient()
  const { error } = await supabase.from('garantia_reclamos').insert({
    entrega_id: v.entrega_id,
    descripcion: v.descripcion,
    reportado_por: v.reportado_por || null,
    contacto: v.contacto || null,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/garantias')
  return { ok: true, mensaje: 'Reclamo registrado.' }
}

/** Mover el reclamo: evaluarlo, decidir si procede, cerrarlo. */
export async function moverReclamo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirGestion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      id: z.string().uuid(),
      estado: z.enum(['EN_EVALUACION', 'PROCEDE', 'NO_PROCEDE', 'ATENDIDO']),
      evaluacion: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Revisa los datos.' }

  const v = analisis.data
  if (['NO_PROCEDE', 'ATENDIDO'].includes(v.estado) && !v.evaluacion) {
    return { ok: false, error: 'Para cerrar el reclamo escribe la evaluación: es lo que se le responde al cliente.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('garantia_reclamos')
    .update({ estado: v.estado, evaluacion: v.evaluacion || null })
    .eq('id', v.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/garantias')
  return { ok: true }
}

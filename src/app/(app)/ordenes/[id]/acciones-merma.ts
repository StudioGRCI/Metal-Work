'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

/**
 * Diseño e Ingeniería evalúa la merma de material de la OT y fija su
 * porcentaje. `fijar_merma_ot` exige `diseno.planos`, el mismo permiso que se
 * pide aquí, y que la OT siga abierta.
 */
export async function fijarMermaOrden(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) return { ok: false, error: 'La merma la evalúa y la fija Diseño e Ingeniería.' }

  const v = z.object({
    orden_id: z.string().uuid(),
    porcentaje: z.coerce.number().min(0).max(100).multipleOf(0.01),
    motivo: z.string().trim().min(5).max(300),
  }).safeParse({
    orden_id: dato(formulario, 'orden_id'),
    porcentaje: dato(formulario, 'porcentaje'),
    motivo: dato(formulario, 'motivo'),
  })
  if (!v.success) return { ok: false, error: 'Indica un porcentaje de 0 a 100 (hasta 2 decimales) y cómo se evaluó (de 5 a 300 caracteres).' }

  const db = await createClient()
  const { data, error } = await db.rpc('fijar_merma_ot', {
    p_orden: v.data.orden_id,
    p_porcentaje: v.data.porcentaje,
    p_motivo: v.data.motivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.orden_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.data.orden_id}`)
  return { ok: true, mensaje: 'Merma fijada. El costeo la aplica sobre el material valorizado de la OT.' }
}

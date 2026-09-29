'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const ordenId = z.string().uuid()
const integranteId = z.string().uuid()
const nombre = z.string().trim().min(2, 'Escribe el nombre completo.').max(120)
const funcion = z.enum(['RESPONSABLE', 'COLABORADOR'])

async function permiso() {
  const perfil = await exigirSesion()
  return puede(perfil, 'diseno.planos')
}

export async function agregarPersonaDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  if (!await permiso()) return { ok: false, error: 'Solo Diseño organiza su equipo.' }
  const entrada = z.object({ orden_id: ordenId, nombre, funcion })
    .safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa la persona.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_equipo_diseno')
    .insert(v).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}/planos`)
  return { ok: true, mensaje: 'Persona agregada al equipo de Diseño.' }
}

export async function actualizarPersonaDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  if (!await permiso()) return { ok: false, error: 'Solo Diseño organiza su equipo.' }
  const entrada = z.object({ orden_id: ordenId, id: integranteId, nombre, funcion })
    .safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa la persona.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_equipo_diseno')
    .update({ nombre: v.nombre, funcion: v.funcion })
    .eq('id', v.id).eq('orden_id', v.orden_id).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}/planos`)
  return { ok: true, mensaje: 'Nombre o función actualizados.' }
}

export async function quitarPersonaDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  if (!await permiso()) return { ok: false, error: 'Solo Diseño organiza su equipo.' }
  const entrada = z.object({ orden_id: ordenId, id: integranteId })
    .safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'No se identificó a la persona.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_equipo_diseno')
    .delete().eq('id', v.id).eq('orden_id', v.orden_id).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}/planos`)
  return { ok: true, mensaje: 'Persona retirada del equipo.' }
}

export async function asignarAutorPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  if (!await permiso()) return { ok: false, error: 'Solo Diseño asigna los planos.' }
  const entrada = z.object({
    orden_id: ordenId, plano_id: z.string().uuid(),
    integrante_id: z.union([integranteId, z.literal('')]),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'Elige un plano y una persona válidos.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_planos')
    .update({ integrante_diseno_id: v.integrante_id || null })
    .eq('id', v.plano_id).eq('orden_id', v.orden_id).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}/planos`)
  return { ok: true, mensaje: 'Autor del plano actualizado.' }
}

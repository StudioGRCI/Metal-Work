'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { RUTA_TIEMPOS } from '@/lib/dominio/tiempos-entrega'
import { editaComoRrhh, exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Quién lleva cada etapa (migración 20261125310000). El mismo permiso que
 * exigen `asignar_responsable_de_etapa` y `quitar_responsable_de_etapa`: solo
 * Recursos Humanos; Gerencia consulta.
 */
const SIN_PERMISO = 'Solo Recursos Humanos asigna quién lleva cada etapa.'
const NO_SE_RECONOCE = 'No se reconoce la etapa. Recarga la pantalla.'

function repintar() {
  for (const ruta of [RUTA_TIEMPOS, `${RUTA_TIEMPOS}/codigo`, `${RUTA_TIEMPOS}/personas`, '/planos', '/diseno/codigo', '/codigos-internos/detalle']) {
    revalidatePath(ruta)
  }
}

export async function asignarResponsable(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.tiempos_entrega_asignar')) return { ok: false, error: SIN_PERMISO }
  const etapa = z.guid().safeParse(formulario.get('etapa_id'))
  if (!etapa.success) return { ok: false, error: NO_SE_RECONOCE }
  const persona = z.guid().safeParse(formulario.get('trabajador_id'))
  if (!persona.success) return { ok: false, error: 'Elige a la persona que lleva la etapa.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('asignar_responsable_de_etapa', { p_etapa: etapa.data, p_trabajador: persona.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No quedó asignada. Recarga la pantalla.' }
  repintar()
  return { ok: true, mensaje: 'Persona asignada.' }
}

export async function quitarResponsable(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.tiempos_entrega_asignar')) return { ok: false, error: SIN_PERMISO }
  const etapa = z.guid().safeParse(formulario.get('etapa_id'))
  if (!etapa.success) return { ok: false, error: NO_SE_RECONOCE }

  const supabase = await createClient()
  const { error } = await supabase.rpc('quitar_responsable_de_etapa', { p_etapa: etapa.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: 'La etapa quedó sin persona a cargo.' }
}

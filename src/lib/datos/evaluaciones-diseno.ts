import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Las evaluaciones de desempeño de Diseño. Quién ve cuál lo decide el RLS de
 * `diseno_evaluaciones` (migración 20261001190000): el evaluador, las suyas;
 * Administración, las que ya le enviaron. Recursos Humanos no ve ninguna.
 *
 * Sin embebidos hacia `usuarios`: la tabla tiene tres llaves hacia ella y el
 * nombre del evaluador viaja copiado en la fila (`evaluador_nombre`).
 */
const CAMPOS_LISTA =
  'id, evaluado_nombre, puesto, area_servicio, fecha_evaluacion, respuestas, estado, evaluador_nombre, evaluador_id, enviada_en, observada_en, recibida_en'

const CAMPOS_FICHA =
  'id, evaluado_nombre, puesto, area_servicio, fecha_ingreso, fecha_evaluacion, respuestas, comentarios, estado, evaluador_id, evaluador_nombre, evaluador_cargo, creado_en, enviada_en, observacion, observada_en, recibida_en'

export async function listarEvaluacionesDiseno() {
  const db = await createClient()
  const { data, error } = await db
    .from('diseno_evaluaciones')
    .select(CAMPOS_LISTA)
    .order('fecha_evaluacion', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(200)
  if (error) throw new Error(`No se pudieron cargar las evaluaciones: ${error.message}`)
  return data ?? []
}

export type EvaluacionEnLista = Awaited<ReturnType<typeof listarEvaluacionesDiseno>>[number]

export async function obtenerEvaluacionDiseno(id: string) {
  const db = await createClient()
  const { data, error } = await db.from('diseno_evaluaciones').select(CAMPOS_FICHA).eq('id', id).maybeSingle()
  if (error) throw new Error(`No se pudo cargar la evaluación: ${error.message}`)
  return data
}

export type EvaluacionDiseno = NonNullable<Awaited<ReturnType<typeof obtenerEvaluacionDiseno>>>

/**
 * Nombres del equipo de Diseño para sugerir al escribir a quién se evalúa:
 * los que figuran en el equipo de alguna OT. Es solo una ayuda para no
 * escribir dos veces lo mismo de dos formas; el campo sigue siendo libre.
 */
export async function nombresDelEquipoDeDiseno() {
  const db = await createClient()
  const { data, error } = await db.from('ot_equipo_diseno').select('nombre').order('nombre').limit(500)
  if (error) return []
  const vistos = new Map<string, string>()
  for (const fila of data ?? []) {
    const nombre = fila.nombre.trim().replace(/\s+/g, ' ')
    const clave = nombre.toLocaleLowerCase('es')
    if (nombre && !vistos.has(clave)) vistos.set(clave, nombre)
  }
  return [...vistos.values()]
}

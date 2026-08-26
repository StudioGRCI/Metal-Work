import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type AccesorioOT = {
  id: string
  orden: number
  cantidad: number
  unidad: string
  descripcion: string
  incluye_el_accesorio: boolean
  verificado: boolean
  verificado_en: string | null
  observacion: string | null
  verificador: { nombres: string; apellidos: string } | null
}

export type RepuestoOT = {
  id: string
  orden: number
  cantidad: number
  descripcion: string
  marca: string | null
  observacion: string | null
}

export type PasoVerificacion = {
  id: string
  numero: number
  descripcion: string
  responsable_id: string | null
  avance_1: boolean
  avance_1_en: string | null
  avance_2: boolean
  avance_2_en: string | null
  observaciones: string | null
  responsable: { nombres: string; apellidos: string } | null
}

/** Sección 6 del formato: el equipamiento a montar, con su visto bueno. */
export async function accesoriosDeOrden(ordenId: string): Promise<AccesorioOT[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_accesorios')
    .select(
      'id, orden, cantidad, unidad, descripcion, incluye_el_accesorio, verificado, verificado_en, observacion, verificador:usuarios!ot_accesorios_verificado_por_fkey(nombres, apellidos)',
    )
    .eq('orden_id', ordenId)
    .order('orden')

  if (error) throw new Error(`No se pudieron leer los accesorios: ${error.message}`)
  return (data ?? []) as unknown as AccesorioOT[]
}

/** Sección 8 del formato: repuestos con cantidad y marca. */
export async function repuestosDeOrden(ordenId: string): Promise<RepuestoOT[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_repuestos')
    .select('id, orden, cantidad, descripcion, marca, observacion')
    .eq('orden_id', ordenId)
    .order('orden')

  if (error) throw new Error(`No se pudieron leer los repuestos: ${error.message}`)
  return (data ?? []) as unknown as RepuestoOT[]
}

/** Sección 11 del formato: verificación y funcionamiento, con sus dos avances. */
export async function verificacionesDeOrden(ordenId: string): Promise<PasoVerificacion[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_verificaciones')
    .select(
      'id, numero, descripcion, responsable_id, avance_1, avance_1_en, avance_2, avance_2_en, observaciones, responsable:usuarios!ot_verificaciones_responsable_id_fkey(nombres, apellidos)',
    )
    .eq('orden_id', ordenId)
    .order('numero')

  if (error) throw new Error(`No se pudo leer la verificación: ${error.message}`)
  return (data ?? []) as unknown as PasoVerificacion[]
}

/** Cuánto lleva verificado la orden, para el encabezado de la pestaña. */
export async function resumenFichaOrden(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_ficha_resumen')
    .select('accesorios, accesorios_verificados, pasos, pasos_avance_1, pasos_avance_2, repuestos')
    .eq('orden_id', ordenId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer el avance de la ficha: ${error.message}`)
  return data as unknown as {
    accesorios: number
    accesorios_verificados: number
    pasos: number
    pasos_avance_1: number
    pasos_avance_2: number
    repuestos: number
  } | null
}

/** Quiénes pueden figurar como responsables de un paso: el personal del taller. */
export async function personalDelTaller() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombres, apellidos')
    .eq('activo', true)
    .order('apellidos')

  if (error) throw new Error(`No se pudo leer el personal: ${error.message}`)
  return (data ?? []) as unknown as { id: string; nombres: string; apellidos: string }[]
}

import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { createClient } from '@/lib/supabase/server'

/**
 * El gasto operativo (lo cargado a PLANTA) de la migración 20261127190000:
 * `gasto_operativo` exige `gasto_operativo.ver` (todas las áreas) o
 * `gasto_operativo.area` (la suya, sin la mano de obra), y dice de cada línea
 * si suma y cuánto pesa en soles, con la misma regla que el costo de cada código.
 */
export type LineaGastoOperativo = {
  fecha: string
  /** Null: «Planta, sin área». */
  area_id: string | null
  area: string
  fuente: string
  grupo: string
  concepto: string
  detalle: string | null
  cantidad: number
  unidad: string | null
  moneda: 'PEN' | 'USD' | null
  monto: number | null
  /** Lo que pesa en soles. Null si no suma o si todavía no se puede pasar a soles. */
  soles: number | null
  suma: boolean
  documento: string | null
  referencia_id: string | null
  /** El RQ de lo salido del almacén, para abrirlo. */
  requerimiento_id: string | null
}

/** El orden en que la base las da; con él se leen de mil en mil sin saltar ni repetir. */
const ORDEN = ['fecha.desc', 'area', 'grupo', 'concepto', 'referencia_id', 'fuente', 'documento', 'detalle', 'area_id', 'cantidad', 'unidad', 'moneda', 'monto', 'soles', 'suma', 'sin_precio', 'requerimiento_id']

/** Las líneas entre dos fechas (`YYYY-MM-DD`, las dos incluidas), de la más nueva a la más vieja. */
export async function gastoOperativo(desde: string, hasta: string): Promise<LineaGastoOperativo[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => supabase.rpc('gasto_operativo', { p_desde: desde, p_hasta: hasta }), ORDEN)
  if (error) throw new Error(`No se pudo leer el gasto operativo: ${error.message}`)
  return (data ?? []).map((f) => ({
    fecha: f.fecha ?? '',
    area_id: f.area_id,
    area: f.area ?? 'Planta, sin área',
    fuente: f.fuente ?? '',
    grupo: f.grupo ?? 'OTROS',
    concepto: f.concepto ?? '',
    detalle: f.detalle,
    cantidad: Number(f.cantidad ?? 0),
    unidad: f.unidad,
    moneda: f.moneda === 'USD' ? 'USD' : f.moneda === 'PEN' ? 'PEN' : null,
    monto: f.monto === null ? null : Number(f.monto),
    soles: f.soles === null ? null : Number(f.soles),
    suma: Boolean(f.suma),
    documento: f.documento,
    referencia_id: f.referencia_id,
    requerimiento_id: f.requerimiento_id,
  }))
}

/** El nombre de un área, para decirlo aunque ese mes no tenga gasto. Null si no existe. */
export async function nombreDelArea(id: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('nombre').eq('id', id).maybeSingle()
  if (error) throw new Error(`No se pudo leer el área: ${error.message}`)
  return data?.nombre ?? null
}

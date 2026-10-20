import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas } from '@/types/database'

export type ConceptoGastoGeneral = Pick<Tablas<'conceptos_gasto_general'>, 'codigo' | 'nombre' | 'grupo'>

/** Los conceptos activos, en el orden de la hoja RESUMEN de la empresa. */
export async function conceptosGastoGeneral(): Promise<ConceptoGastoGeneral[]> {
  const db = await createClient()
  const { data, error } = await db.from('conceptos_gasto_general')
    .select('codigo,nombre,grupo').eq('activo', true).order('orden')
  if (error) throw new Error(`No se pudieron leer los conceptos de gasto: ${error.message}`)
  return data ?? []
}

/**
 * Los gastos del local y de operación de un mes, anulados incluidos: un gasto
 * anulado se queda a la vista con su motivo, no desaparece.
 * Lectura: `costos.gastos_generales` o `costos.ver` (política `ver_gastos_generales_mes`).
 */
export async function gastosGeneralesDelMes(periodo: string) {
  const db = await createClient()
  const { data, error } = await db.from('gastos_generales_mes')
    .select('id,periodo,concepto,descripcion,monto,moneda,reparto,tasa,estado,motivo_anulacion,anulado_en,creado_en,registrador:usuarios!gastos_generales_mes_registrado_por_fkey(nombres,apellidos),anulador:usuarios!gastos_generales_mes_anulado_por_fkey(nombres,apellidos)')
    .eq('periodo', periodo)
    .order('creado_en', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los gastos del mes: ${error.message}`)
  return data ?? []
}

export type GastoGeneral = Awaited<ReturnType<typeof gastosGeneralesDelMes>>[number]

/**
 * Entre qué unidades se reparten los gastos de un mes: sus horas y el porcentaje
 * de cada gasto que carga cada una. Exige `costos.gastos_generales` o `costos.ver`.
 */
export async function repartoDelMes(periodo: string) {
  const db = await createClient()
  const { data, error } = await db.rpc('gastos_del_mes_reparto', { p_periodo: periodo })
  if (error) throw new Error(`No se pudo leer el reparto del mes: ${error.message}`)
  return (data ?? []).flatMap((f) => (f.codigo ? [{ codigo: f.codigo, horas: Number(f.horas), parte: Number(f.parte) }] : []))
}

/**
 * El sueldo de la oficina de un mes (lo que RR. HH. registró como pagado), sumado y
 * sin cuántas personas son, y a cuántas de la oficina les faltan días pagados. Exige `costos.ver`,
 * `costos.gastos_generales` o `codigos_internos.ver`.
 */
export async function oficinaDelMes(periodo: string) {
  const db = await createClient()
  const { data, error } = await db.rpc('gastos_del_mes_oficina', { p_periodo: periodo })
  if (error) throw new Error(`No se pudo leer el sueldo de la oficina: ${error.message}`)
  const f = data?.[0]
  return { monto: Number(f?.monto ?? 0), sinPago: f?.sin_pago ?? 0 }
}

/**
 * Los meses (`YYYY-MM-01`) en que el código tuvo horas y a alguien de la oficina le
 * faltan días pagados: el cierre del costeo los espera (`cerrar_costeo_codigo`).
 * Exige `codigos_internos.ver`, `codigos_internos.cerrar` o `costos.ver`.
 */
export async function mesesSinPagosDeOficina(codigo: string): Promise<string[]> {
  const db = await createClient()
  const { data, error } = await db.rpc('meses_sin_pagos_oficina', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo leer qué meses esperan los pagos de la oficina: ${error.message}`)
  return (data ?? []).flatMap((f) => (f.periodo ? [f.periodo] : []))
}

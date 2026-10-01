import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas } from '@/types/database'

export type ConceptoGastoGeneral = Pick<Tablas<'conceptos_gasto_general'>, 'codigo' | 'nombre' | 'grupo' | 'tasa_sugerida'>

/** Los conceptos activos, en el orden de la hoja RESUMEN de la empresa. */
export async function conceptosGastoGeneral(): Promise<ConceptoGastoGeneral[]> {
  const db = await createClient()
  const { data, error } = await db.from('conceptos_gasto_general')
    .select('codigo,nombre,grupo,tasa_sugerida').eq('activo', true).order('orden')
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

import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type MaterialParaValorizar = Database['public']['Functions']['materiales_para_valorizar']['Returns'][number]

/**
 * Lo que hay en almacén con su último precio de compra y el precio que fijó
 * Logística. La función exige `compras.crear`, `almacen.ver` o `costos.ver`:
 * Logística no lee los movimientos del almacén, recibe solo esto.
 */
export async function materialesParaValorizar(): Promise<MaterialParaValorizar[]> {
  const db = await createClient()
  const { data, error } = await db.rpc('materiales_para_valorizar')
  if (error) throw new Error(`No se pudo leer la valorización del almacén: ${error.message}`)
  return data ?? []
}

/**
 * El precio con el que el costeo valoriza una salida de hoy: el de la última
 * compra y, si el material nunca se compró por el sistema, el que fijó
 * Logística. Mismo orden que `detalle_costeo_ot`.
 */
export function precioDeCosteo(m: MaterialParaValorizar): { precio: number; moneda: 'PEN' | 'USD'; origen: 'COMPRA' | 'LOGISTICA' } | null {
  if (m.ultima_compra !== null && (m.moneda_compra === 'PEN' || m.moneda_compra === 'USD')) {
    return { precio: Number(m.ultima_compra), moneda: m.moneda_compra, origen: 'COMPRA' }
  }
  if (m.precio !== null && (m.moneda === 'PEN' || m.moneda === 'USD')) {
    return { precio: Number(m.precio), moneda: m.moneda, origen: 'LOGISTICA' }
  }
  return null
}

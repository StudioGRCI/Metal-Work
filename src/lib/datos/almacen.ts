import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Vistas } from '@/types/database'

export type FilaStock = Vistas<'v_stock_actual'>

export async function listarStock(filtros: { busqueda?: string; bajoMinimo?: boolean } = {}) {
  const supabase = await createClient()

  let consulta = supabase.from('v_stock_actual').select('*')

  if (filtros.bajoMinimo) consulta = consulta.eq('bajo_minimo', true)

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(`material_codigo.ilike.%${t}%,material_descripcion.ilike.%${t}%`)
  }

  const { data, error } = await consulta.order('material_descripcion').limit(300)
  if (error) throw new Error(`No se pudo cargar el stock: ${error.message}`)

  return data ?? []
}

/** Cuenta y valoriza el almacén en la base: traer todas las filas para sumarlas
 * se queda corto en cuanto el catálogo pase de mil materiales. */
export async function resumenAlmacen() {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('resumen_almacen').single()
  if (error) throw new Error(`No se pudo cargar el resumen de almacén: ${error.message}`)

  return {
    materiales: data.materiales ?? 0,
    valorizado: Number(data.valorizado ?? 0),
    bajoMinimo: data.bajo_minimo ?? 0,
  }
}

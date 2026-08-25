import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Vistas } from '@/types/database'

export type MargenOrden = Vistas<'v_ot_margen'>

export async function listarMargenes(filtros: { estado?: string; busqueda?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase.from('v_ot_margen').select('*')

  if (filtros.estado === 'ABIERTAS') {
    consulta = consulta.in('estado', ['APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA', 'CONTROL_CALIDAD'])
  } else if (filtros.estado) {
    consulta = consulta.eq('estado', filtros.estado as never)
  }

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(`numero.ilike.%${t}%,cliente.ilike.%${t}%`)
  }

  const { data, error } = await consulta.order('fecha_registro', { ascending: false }).limit(200)
  if (error) throw new Error(`No se pudo cargar el costeo: ${error.message}`)

  return data ?? []
}

export async function costoDeOrden(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_ot_margen')
    .select('*')
    .eq('orden_id', ordenId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar el costo de la orden: ${error.message}`)
  return data
}

/** Detalle de los materiales consumidos por una orden, tomado del kardex. */
export async function materialesDeOrden(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('kardex')
    .select(
      'id, fecha, tipo_movimiento, cantidad, costo_unitario, costo_total, material:materiales!inner(codigo, descripcion, unidad:unidades_medida!inner(codigo))',
    )
    .eq('orden_id', ordenId)
    .in('tipo_movimiento', ['SALIDA_OT', 'INGRESO_DEVOLUCION'])
    .order('secuencia', { ascending: false })
    .limit(200)

  if (error) throw new Error(`No se pudieron cargar los materiales: ${error.message}`)
  return data ?? []
}

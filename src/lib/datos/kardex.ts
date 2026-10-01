import 'server-only'

import { sumarDias } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import type { Database, Vistas } from '@/types/database'

export type FilaKardex = Pick<Vistas<'v_kardex_almacen'>,
  'id' | 'fecha' | 'material_id' | 'material_codigo' | 'material' | 'unidad_medida' | 'movimiento' | 'origen'
  | 'entrada' | 'salida' | 'saldo' | 'documento' | 'codigo_unidad' | 'orden_id' | 'orden_numero'
  | 'recibido_por_nombre' | 'registrado_por_nombre' | 'con_foto'>

export type UnidadParaSalida = Database['public']['Functions']['unidades_para_salida_almacen']['Returns'][number]

/** Qué se pide al kardex: un material o todo el almacén, un tipo, un rango y una unidad. */
export type FiltrosKardex = {
  material?: string
  tipo?: 'INGRESO' | 'SALIDA' | 'AJUSTE'
  desde?: string
  hasta?: string
  unidad?: string
  pagina: number
}

export const FILAS_POR_PAGINA = 100

const COLUMNAS = 'id,fecha,material_id,material_codigo,material,unidad_medida,movimiento,origen,entrada,salida,saldo,documento,codigo_unidad,orden_id,orden_numero,recibido_por_nombre,registrado_por_nombre,con_foto'

/**
 * Las filas del kardex. Con un material elegido se leen en orden de fecha,
 * como el formato en papel, con el saldo de ese material tras cada movimiento.
 * Sin material es el historial de todo el almacén, lo último primero.
 *
 * El saldo lo calcula la vista sobre todos los movimientos del material, así
 * que filtrar por fecha o por unidad no lo altera: cada fila sigue diciendo
 * cuánto quedó en almacén en ese momento.
 */
export async function cargarKardex(filtros: FiltrosKardex) {
  const db = await createClient()
  const cronologico = Boolean(filtros.material)
  let consulta = db.from('v_kardex_almacen').select(COLUMNAS, { count: 'exact' })

  if (filtros.material) consulta = consulta.eq('material_id', filtros.material)
  if (filtros.tipo === 'INGRESO') consulta = consulta.eq('movimiento', 'INGRESO')
  if (filtros.tipo === 'SALIDA') consulta = consulta.in('movimiento', ['SALIDA', 'DESPACHO'])
  if (filtros.tipo === 'AJUSTE') consulta = consulta.eq('movimiento', 'AJUSTE')
  // Los días son de Lima: el 30 de setiembre termina a medianoche de Lima, no
  // de Greenwich, o las salidas de la tarde caerían en el día siguiente.
  if (filtros.desde) consulta = consulta.gte('fecha', `${filtros.desde}T00:00:00-05:00`)
  if (filtros.hasta) consulta = consulta.lt('fecha', `${sumarDias(filtros.hasta, 1)}T00:00:00-05:00`)
  if (filtros.unidad) consulta = consulta.ilike('codigo_unidad', `%${filtros.unidad}%`)

  const desde = (filtros.pagina - 1) * FILAS_POR_PAGINA
  const { data, error, count } = await consulta
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
    .range(desde, desde + FILAS_POR_PAGINA - 1)
  if (error) throw new Error(`No se pudo cargar el kardex: ${error.message}`)

  const filas: FilaKardex[] = data ?? []
  return { filas: cronologico ? [...filas].reverse() : filas, total: count ?? 0, cronologico }
}

/** Los materiales que tienen kardex: los que alguna vez entraron, salieron o se contaron. */
export async function materialesDelKardex() {
  const db = await createClient()
  const filas: { material_id: string; codigo: string; descripcion: string; unidad: string | null; existencia: number; disponible: number }[] = []
  let ultimo: string | undefined
  for (;;) {
    let consulta = db.from('v_existencias_materiales')
      .select('material_id,codigo,descripcion,unidad,existencia,disponible')
      .order('material_id').limit(1000)
    if (ultimo) consulta = consulta.gt('material_id', ultimo)
    const { data, error } = await consulta
    if (error) throw new Error(`No se pudieron cargar los materiales del kardex: ${error.message}`)
    for (const m of data ?? []) {
      if (!m.material_id) continue
      filas.push({
        material_id: m.material_id, codigo: m.codigo ?? '', descripcion: m.descripcion ?? 'Material',
        unidad: m.unidad, existencia: Number(m.existencia ?? 0), disponible: Number(m.disponible ?? 0),
      })
    }
    if (!data?.length || data.length < 1000) break
    ultimo = data[data.length - 1].material_id ?? undefined
    if (!ultimo) break
  }
  return filas.sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'))
}

/** Los vehículos a los que Almacén puede vincular una salida. */
export async function unidadesParaSalida(): Promise<UnidadParaSalida[]> {
  const db = await createClient()
  const { data, error } = await db.rpc('unidades_para_salida_almacen')
  if (error) throw new Error(`No se pudieron cargar las unidades: ${error.message}`)
  return data ?? []
}

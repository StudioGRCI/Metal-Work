import 'server-only'

import { type Almacen, esAlmacen } from '@/lib/dominio/almacen'
import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import { sumarDias } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import type { Database, Vistas } from '@/types/database'

export type FilaKardex = Pick<Vistas<'v_kardex_almacen'>,
  'id' | 'fecha' | 'material_id' | 'material_codigo' | 'material' | 'unidad_medida' | 'movimiento' | 'origen'
  | 'entrada' | 'salida' | 'saldo' | 'documento' | 'codigo_unidad' | 'orden_id' | 'orden_numero'
  | 'recibido_por_nombre' | 'registrado_por_nombre' | 'con_foto' | 'desde_planilla' | 'cargado_en'
  | 'almacen' | 'codigo_interno' | 'requerimiento_numero' | 'con_formato' | 'formato_pendiente'>

export type UnidadParaSalida = Database['public']['Functions']['unidades_para_salida_almacen']['Returns'][number]

/** Qué se pide al kardex: un material o todo el almacén, un tipo, un rango y una unidad. */
export type FiltrosKardex = {
  material?: string
  tipo?: 'INGRESO' | 'SALIDA' | 'AJUSTE'
  desde?: string
  hasta?: string
  unidad?: string
  /** Uno de los cuatro almacenes, o todos. */
  almacen?: Almacen
  pagina: number
}

export const FILAS_POR_PAGINA = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIA = /^\d{4}-\d{2}-\d{2}$/
const texto = (valor: string | string[] | null | undefined) => (typeof valor === 'string' ? valor.trim() : '')

/** Los filtros de la URL, los mismos para la pantalla y para el Excel. */
export function filtrosDeKardex(params: Record<string, string | string[] | undefined>): FiltrosKardex {
  const material = texto(params.material)
  const tipo = texto(params.tipo)
  const desde = texto(params.desde)
  const hasta = texto(params.hasta)
  const unidad = texto(params.unidad).slice(0, 60)
  const almacen = texto(params.almacen).toUpperCase()
  return {
    material: UUID.test(material) ? material : undefined,
    tipo: tipo === 'INGRESO' || tipo === 'SALIDA' || tipo === 'AJUSTE' ? tipo : undefined,
    desde: DIA.test(desde) ? desde : undefined,
    hasta: DIA.test(hasta) ? hasta : undefined,
    unidad: unidad || undefined,
    almacen: esAlmacen(almacen) ? almacen : undefined,
    pagina: Math.max(1, Number.parseInt(texto(params.pagina) || '1', 10) || 1),
  }
}

const COLUMNAS = 'id,fecha,material_id,material_codigo,material,unidad_medida,movimiento,origen,entrada,salida,saldo,documento,codigo_unidad,orden_id,orden_numero,recibido_por_nombre,registrado_por_nombre,con_foto,desde_planilla,cargado_en,almacen,codigo_interno,requerimiento_numero,con_formato,formato_pendiente'

/** Lo que más filas puede llevar el Excel del kardex: un año largo de almacén. */
export const MAX_FILAS_EXCEL = 20000

/** La misma consulta para la pantalla y para el Excel: los filtros no pueden decir cosas distintas. */
function consultaKardex(db: Awaited<ReturnType<typeof createClient>>, filtros: Omit<FiltrosKardex, 'pagina'>, contar: boolean) {
  let consulta = db.from('v_kardex_almacen').select(COLUMNAS, contar ? { count: 'exact' } : undefined)
  if (filtros.material) consulta = consulta.eq('material_id', filtros.material)
  if (filtros.tipo === 'INGRESO') consulta = consulta.eq('movimiento', 'INGRESO')
  if (filtros.tipo === 'SALIDA') consulta = consulta.in('movimiento', ['SALIDA', 'DESPACHO'])
  if (filtros.tipo === 'AJUSTE') consulta = consulta.eq('movimiento', 'AJUSTE')
  // Los días son de Lima: el 30 de setiembre termina a medianoche de Lima, no
  // de Greenwich, o las salidas de la tarde caerían en el día siguiente.
  if (filtros.desde) consulta = consulta.gte('fecha', `${filtros.desde}T00:00:00-05:00`)
  if (filtros.hasta) consulta = consulta.lt('fecha', `${sumarDias(filtros.hasta, 1)}T00:00:00-05:00`)
  for (const filtro of filtrosDeBusqueda(['codigo_unidad'], filtros.unidad)) consulta = consulta.or(filtro)
  if (filtros.almacen) consulta = consulta.eq('almacen', filtros.almacen)
  return consulta
}

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
  const desde = (filtros.pagina - 1) * FILAS_POR_PAGINA
  const { data, error, count } = await consultaKardex(db, filtros, true)
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
    .range(desde, desde + FILAS_POR_PAGINA - 1)
  if (error) throw new Error(`No se pudo cargar el kardex: ${error.message}`)

  const filas: FilaKardex[] = data ?? []
  return { filas: cronologico ? [...filas].reverse() : filas, total: count ?? 0, cronologico }
}

/**
 * Todas las filas del kardex con los mismos filtros, en orden de fecha, para el
 * Excel. Se leen de mil en mil; `truncado` avisa si pasaron de MAX_FILAS_EXCEL.
 */
export async function kardexParaExcel(filtros: Omit<FiltrosKardex, 'pagina'>) {
  const db = await createClient()
  const filas: FilaKardex[] = []
  for (let desde = 0; desde < MAX_FILAS_EXCEL; desde += 1000) {
    const { data, error } = await consultaKardex(db, filtros, false)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, Math.min(desde + 999, MAX_FILAS_EXCEL - 1))
    if (error) throw new Error(`No se pudo leer el kardex: ${error.message}`)
    filas.push(...(data ?? []))
    if ((data ?? []).length < 1000) return { filas, truncado: false }
  }
  return { filas, truncado: true }
}

export type MaterialDelKardex = {
  material_id: string
  codigo: string
  descripcion: string
  unidad: string | null
  existencia: number
  disponible: number
  /** A cuál de los cuatro almacenes pertenece; null mientras esté por clasificar. */
  almacen: Almacen | null
  categoria: string | null
}

/** Los materiales que tienen kardex: los que alguna vez entraron, salieron o se contaron. */
export async function materialesDelKardex() {
  const db = await createClient()
  const filas: MaterialDelKardex[] = []
  let ultimo: string | undefined
  for (;;) {
    let consulta = db.from('v_existencias_materiales')
      .select('material_id,codigo,descripcion,unidad,existencia,disponible,almacen,categoria')
      .order('material_id').limit(1000)
    if (ultimo) consulta = consulta.gt('material_id', ultimo)
    const { data, error } = await consulta
    if (error) throw new Error(`No se pudieron cargar los materiales del kardex: ${error.message}`)
    for (const m of data ?? []) {
      if (!m.material_id) continue
      filas.push({
        material_id: m.material_id, codigo: m.codigo ?? '', descripcion: m.descripcion ?? 'Material',
        unidad: m.unidad, existencia: Number(m.existencia ?? 0), disponible: Number(m.disponible ?? 0),
        almacen: esAlmacen(m.almacen) ? m.almacen : null, categoria: m.categoria,
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

/** El stock mínimo de cada material que lo tiene fijado. Los demás no avisan. */
export async function minimosDeStock(): Promise<Map<string, number>> {
  const db = await createClient()
  const minimos = new Map<string, number>()
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from('materiales')
      .select('id,stock_minimo')
      .not('stock_minimo', 'is', null)
      .eq('activo', true)
      .order('id')
      .range(desde, desde + 999)
    if (error) throw new Error(`No se pudieron cargar los stocks mínimos: ${error.message}`)
    for (const m of data ?? []) if (m.stock_minimo !== null) minimos.set(m.id, Number(m.stock_minimo))
    if (!data || data.length < 1000) break
  }
  return minimos
}

/** Una salida de materia prima o EPP que sigue abierta: falta su formato firmado. */
export type SalidaPorCerrar = Pick<FilaKardex, 'id' | 'fecha' | 'material_id' | 'material' | 'material_codigo' | 'unidad_medida'
  | 'salida' | 'codigo_unidad' | 'recibido_por_nombre' | 'documento' | 'almacen' | 'requerimiento_numero'>

/** Las salidas que esperan el escaneo del formato firmado, la más antigua primero. */
export async function salidasPorCerrar(): Promise<SalidaPorCerrar[]> {
  const db = await createClient()
  const { data, error } = await db.from('v_kardex_almacen')
    .select('id,fecha,material_id,material,material_codigo,unidad_medida,salida,codigo_unidad,recibido_por_nombre,documento,almacen,requerimiento_numero')
    .eq('formato_pendiente', true)
    .order('fecha', { ascending: true })
    .limit(200)
  if (error) throw new Error(`No se pudieron cargar las salidas por cerrar: ${error.message}`)
  return data ?? []
}

/** Una línea de requerimiento con algo por entregar, para atenderla desde la salida. */
export type LineaRqParaSalida = {
  linea_id: string
  requerimiento_id: string
  numero: string
  codigo_interno: string
  area: string
  item: number
  descripcion: string
  cantidad: number
  unidad: string
  categoria: string
  almacen: Almacen | null
  entregado: number
  pendiente: number
  /** El material del catálogo con que se pidió: la salida lo trae elegido. */
  material_id: string | null
}

/** Lo que piden los requerimientos vivos y todavía no se entregó, por número e ítem. */
export async function lineasDeRequerimientoParaSalida(): Promise<LineaRqParaSalida[]> {
  const db = await createClient()
  const { data, error } = await db.from('v_rq_lineas_para_salida')
    .select('linea_id,requerimiento_id,numero,codigo_interno,area,item,descripcion,cantidad,unidad,categoria,almacen,entregado,pendiente,material_id')
    .gt('pendiente', 0)
    .order('numero', { ascending: false })
    .order('item')
    .limit(500)
  if (error) throw new Error(`No se pudieron cargar los requerimientos por atender: ${error.message}`)
  return (data ?? []).flatMap((l) => l.linea_id && l.requerimiento_id && l.numero ? [{
    linea_id: l.linea_id, requerimiento_id: l.requerimiento_id, numero: l.numero,
    codigo_interno: l.codigo_interno ?? 'PLANTA', area: l.area ?? '', item: l.item ?? 0,
    descripcion: l.descripcion ?? '', cantidad: Number(l.cantidad ?? 0), unidad: l.unidad ?? '',
    categoria: l.categoria ?? '', almacen: esAlmacen(l.almacen) ? l.almacen : null,
    entregado: Number(l.entregado ?? 0), pendiente: Number(l.pendiente ?? 0), material_id: l.material_id,
  }] : [])
}

export type MaterialParaPlanilla = {
  id: string
  codigo: string
  descripcion: string
  unidad_id: string
  unidad: string | null
  /** Del catálogo importado con la unidad provisional: la planilla la confirma al contarlo. */
  unidad_pendiente: boolean
}

/**
 * Todo el catálogo activo, también lo que tiene la unidad provisional: la
 * planilla busca ahí por código o por descripción, porque Almacén copia los
 * nombres del catálogo completo y no solo de lo que ya tiene saldo.
 */
export async function materialesParaPlanilla(): Promise<MaterialParaPlanilla[]> {
  const db = await createClient()
  const materiales: MaterialParaPlanilla[] = []
  let ultimo: string | undefined
  for (;;) {
    let consulta = db.from('materiales').select('id,codigo,descripcion,unidad_medida_id,unidad_pendiente,unidad:unidades_medida(codigo)')
      .eq('activo', true).order('id').limit(1000)
    if (ultimo) consulta = consulta.gt('id', ultimo)
    const { data, error } = await consulta
    if (error) throw new Error(`No se pudo cargar el catálogo de Almacén: ${error.message}`)
    materiales.push(...(data ?? []).map((m) => ({
      id: m.id, codigo: m.codigo, descripcion: m.descripcion, unidad_id: m.unidad_medida_id,
      unidad: m.unidad?.codigo ?? null, unidad_pendiente: m.unidad_pendiente,
    })))
    if (!data?.length || data.length < 1000) break
    ultimo = data[data.length - 1].id
  }
  return materiales
}

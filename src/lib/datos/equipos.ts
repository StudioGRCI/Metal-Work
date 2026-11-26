import 'server-only'

import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import type { EstadoEquipo } from '@/lib/dominio/equipos'
import { paginaQueExiste } from '@/lib/dominio/paginas'
import { createClient } from '@/lib/supabase/server'
import type { Tablas } from '@/types/database'

/**
 * El padrón de equipos de la planta: máquinas, herramientas y equipos de
 * cómputo. Lo lleva Mantenimiento; Almacén cambia quién tiene cada uno y
 * Gerencia consulta. No trae costo, proveedor ni factura: no están en la tabla.
 */
export type CategoriaDeEquipo = Pick<Tablas<'equipo_categorias'>, 'id' | 'nombre' | 'prefijo' | 'activo'>

export type Equipo = Pick<
  Tablas<'equipos'>,
  | 'id'
  | 'codigo'
  | 'descripcion'
  | 'categoria_id'
  | 'marca'
  | 'serie_maquina'
  | 'serie_cabezal'
  | 'area_id'
  | 'ubicacion'
  | 'a_cargo_de'
  | 'estado_nota'
  | 'estado_desde'
  | 'observaciones'
  | 'activo'
  | 'baja_motivo'
  | 'dado_de_baja_en'
  | 'actualizado_en'
> & {
  estado: EstadoEquipo
  categoria: { nombre: string } | null
  area: { codigo: string; nombre: string } | null
  /** Quién lo dio de baja. Hay dos llaves hacia `usuarios`: se nombra la de la baja. */
  baja: { nombres: string; apellidos: string | null } | null
}

export type AreaDeEquipo = { id: string; codigo: string; nombre: string }

export const EQUIPOS_POR_PAGINA = 25

const COLUMNAS =
  'id, codigo, descripcion, categoria_id, marca, serie_maquina, serie_cabezal, area_id, ubicacion, a_cargo_de, estado, estado_nota, estado_desde, observaciones, activo, baja_motivo, dado_de_baja_en, actualizado_en, categoria:equipo_categorias(nombre), area:areas(codigo, nombre), baja:usuarios!equipos_baja_por_fkey(nombres, apellidos)'

export type FiltrosDeEquipos = {
  busqueda?: string
  estado?: EstadoEquipo
  categoria?: string
  /** Los dados de baja en lugar de los que están en uso. */
  deBaja?: boolean
  pagina?: number
}

export async function listarEquipos(filtros: FiltrosDeEquipos = {}): Promise<{
  equipos: Equipo[]
  total: number
  pagina: number
  paginas: number
}> {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * EQUIPOS_POR_PAGINA

  let consulta = supabase
    .from('equipos')
    .select(COLUMNAS, { count: 'exact' })
    .eq('activo', !filtros.deBaja)
    .order('codigo')
    .order('id')

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado)
  if (filtros.categoria) consulta = consulta.eq('categoria_id', filtros.categoria)
  for (const filtro of filtrosDeBusqueda(
    ['codigo', 'descripcion', 'marca', 'serie_maquina', 'serie_cabezal', 'a_cargo_de', 'ubicacion'],
    filtros.busqueda,
  )) {
    consulta = consulta.or(filtro)
  }

  const { data, error, count } = await consulta.range(desde, desde + EQUIPOS_POR_PAGINA - 1)
  // Una página que ya no existe se cambia por la última que sí hay.
  const otra = await paginaQueExiste(
    pagina,
    EQUIPOS_POR_PAGINA,
    { error, count, filas: data?.length ?? 0 },
    async () => (await listarEquipos({ ...filtros, pagina: 1 })).total,
  )
  if (otra) return listarEquipos({ ...filtros, pagina: otra })
  if (error) throw new Error(`No se pudo leer el padrón de equipos: ${error.message}`)

  return {
    equipos: (data ?? []) as Equipo[],
    total: count ?? 0,
    pagina,
    paginas: Math.max(1, Math.ceil((count ?? 0) / EQUIPOS_POR_PAGINA)),
  }
}

/**
 * Cuántos equipos hay en cada estado y en cada categoría, para las pastillas y
 * el encabezado. El padrón son decenas de filas: se cuentan de una lectura.
 */
export async function contarEquipos(): Promise<{
  enUso: number
  deBaja: number
  porEstado: Record<EstadoEquipo, number>
  porCategoria: Record<string, number>
}> {
  const supabase = await createClient()
  const porEstado: Record<EstadoEquipo, number> = { OPERATIVO: 0, CON_OBSERVACION: 0, PARADO: 0 }
  const porCategoria: Record<string, number> = {}
  let enUso = 0
  let deBaja = 0
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase
      .from('equipos')
      .select('estado, categoria_id, activo')
      .order('id')
      .range(desde, desde + 999)
    if (error) throw new Error(`No se pudo contar el padrón de equipos: ${error.message}`)
    for (const e of data ?? []) {
      if (!e.activo) {
        deBaja += 1
        continue
      }
      enUso += 1
      porEstado[e.estado as EstadoEquipo] = (porEstado[e.estado as EstadoEquipo] ?? 0) + 1
      porCategoria[e.categoria_id] = (porCategoria[e.categoria_id] ?? 0) + 1
    }
    if (!data || data.length < 1000) break
  }
  return { enUso, deBaja, porEstado, porCategoria }
}

export async function categoriasDeEquipo(): Promise<CategoriaDeEquipo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('equipo_categorias')
    .select('id, nombre, prefijo, activo')
    .order('orden')
    .order('nombre')
  if (error) throw new Error(`No se pudieron leer las categorías de equipos: ${error.message}`)
  return data ?? []
}

/** Las áreas de la empresa, para decir de cuál es cada equipo. */
export async function areasDeEquipo(): Promise<AreaDeEquipo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('id, codigo, nombre').eq('activo', true).order('orden_secuencia')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

/**
 * El código que le toca al próximo equipo de cada categoría, para mostrarlo en
 * el alta. Lo calcula la base (`equipos_codigos_que_siguen`), que es quien lo
 * pone al guardar: aquí no se vuelve a calcular.
 */
export async function codigosQueSiguen(): Promise<Record<string, string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('equipos_codigos_que_siguen')
  if (error) throw new Error(`No se pudo leer el código que sigue de cada categoría: ${error.message}`)
  return Object.fromEntries((data ?? []).flatMap((f) => (f.codigo ? [[f.categoria_id, f.codigo]] : [])))
}

/**
 * La historia de un equipo (Plan 16.4, `equipos_historia`): las averías sin las
 * anuladas, las repetidas, las veces que no quedó bien y las horas parado que
 * anotó Mantenimiento al cerrar, en total y en los últimos 90 días; y el reporte
 * que lo tiene parado hoy. Las cuenta la base, todas, para quien ve el padrón.
 */
export type HistoriaDeEquipo = {
  averias: number
  averias90: number
  repetidas: number
  repetidas90: number
  noQuedoBien: number
  horasParado: number
  horasParado90: number
  abiertas: number
  /** El número del reporte que tiene parado el equipo ahora, si lo hay. */
  paradoPor: string | null
  paradoDesde: string | null
  ultimaEn: string | null
  /** Para nombrarlo en la lectura de Gerencia sin otra consulta. */
  codigo: string | null
  descripcion: string | null
}

type FilaHistoria = {
  equipo_id: string | null
  averias: number | null
  averias_90: number | null
  repetidas: number | null
  repetidas_90: number | null
  no_quedo_bien: number | null
  horas_parado: number | null
  horas_parado_90: number | null
  abiertas: number | null
  parado_por: string | null
  parado_desde: string | null
  ultima_en: string | null
  codigo: string | null
  descripcion: string | null
}

function aHistoria(f: FilaHistoria): HistoriaDeEquipo {
  return {
    averias: f.averias ?? 0,
    averias90: f.averias_90 ?? 0,
    repetidas: f.repetidas ?? 0,
    repetidas90: f.repetidas_90 ?? 0,
    noQuedoBien: f.no_quedo_bien ?? 0,
    horasParado: Number(f.horas_parado ?? 0),
    horasParado90: Number(f.horas_parado_90 ?? 0),
    abiertas: f.abiertas ?? 0,
    paradoPor: f.parado_por,
    paradoDesde: f.parado_desde,
    ultimaEn: f.ultima_en,
    codigo: f.codigo,
    descripcion: f.descripcion,
  }
}

/** La historia de todos los equipos en uso, por id. */
export async function historiaDeEquipos(): Promise<Map<string, HistoriaDeEquipo>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('equipos_historia', { p_equipo: null })
  // Si el código llega antes que la migración 20261126995000, el padrón sale sin
  // la lectura de arriba en vez de caerse entero.
  if (error?.code === 'PGRST202') return new Map()
  if (error) throw new Error(`No se pudo leer la historia de los equipos: ${error.message}`)
  return new Map(((data ?? []) as FilaHistoria[]).flatMap((f) => (f.equipo_id ? [[f.equipo_id, aHistoria(f)] as const] : [])))
}

/** La historia de un equipo, también si está dado de baja. */
export async function historiaDeEquipo(id: string): Promise<HistoriaDeEquipo | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('equipos_historia', { p_equipo: id })
  if (error) throw new Error(`No se pudo leer la historia del equipo: ${error.message}`)
  const fila = ((data ?? []) as FilaHistoria[])[0]
  return fila ? aHistoria(fila) : null
}

/** Un equipo del padrón, en uso o dado de baja; `null` si no existe o quien mira no ve el padrón. */
export async function cargarEquipo(id: string): Promise<Equipo | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('equipos').select(COLUMNAS).eq('id', id).maybeSingle()
  if (error) throw new Error(`No se pudo leer el equipo: ${error.message}`)
  return (data as Equipo | null) ?? null
}


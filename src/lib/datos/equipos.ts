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
  'id, codigo, descripcion, categoria_id, marca, serie_maquina, serie_cabezal, area_id, ubicacion, a_cargo_de, estado, estado_nota, estado_desde, observaciones, activo, baja_motivo, dado_de_baja_en, categoria:equipo_categorias(nombre), area:areas(codigo, nombre), baja:usuarios!equipos_baja_por_fkey(nombres, apellidos)'

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

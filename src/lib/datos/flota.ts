import 'server-only'

import type { DatosRevision } from '@/lib/dominio/estados'
import { createClient } from '@/lib/supabase/server'

/**
 * Los trabajos sin orden: una unidad de un cliente que entró sin orden de
 * trabajo, o algo que el propio taller está implementando. Viven en las tablas
 * `flota_*`, de cuando esto era solo para unidades de flota; el nombre de las
 * tablas se quedó, el de las cosas no.
 */
export type EstadoFlota = 'EN_TALLER' | 'LISTA' | 'SALIO'

export type TrabajoSinOrden = {
  id: string
  placa: string | null
  placa_clave: string | null
  descripcion: string | null
  cliente: string | null
  trajo: string | null
  trabajo: string
  estado: string
  ingreso: string
  ingreso_fecha: string
  lista_en: string | null
  salio_en: string | null
  retiro: string | null
  sede_id: string | null
  registrado_por: string | null
  registrado_por_nombre: string | null
  ultimo_avance_fecha: string | null
  ultimo_avance: string | null
  area_actual_id: string | null
  area_actual: string | null
  avance_porcentaje: number | null
  dias_sin_avance: number | null
  dias_en_taller: number | null
  impedimento: string | null
  fotos: number
  reportes: number
}

export type ReporteDeFlota = {
  id: string
  flota_id: string
  fecha: string
  descripcion: string
  avance_porcentaje: number | null
  impedimento: string | null
  creado_en: string
  area_id: string
  area_codigo: string
  area: string
  placa: string | null
  unidad: string | null
  cliente: string | null
  trabajo: string
  estado: string
  registrado_por: string | null
  registrado_por_nombre: string | null
  fotos: number
} & DatosRevision

export type FotoDeFlota = {
  id: string
  avance_id: string
  ruta_storage: string
  nombre_archivo: string
  pie: string | null
}

const COLUMNAS_UNIDAD =
  'id, placa, placa_clave, descripcion, cliente, trajo, trabajo, estado, ingreso, ingreso_fecha, lista_en, salio_en, retiro, sede_id, registrado_por, registrado_por_nombre, ultimo_avance_fecha, ultimo_avance, area_actual_id, area_actual, avance_porcentaje, dias_sin_avance, dias_en_taller, impedimento, fotos, reportes'

const COLUMNAS_REPORTE =
  'id, flota_id, fecha, descripcion, avance_porcentaje, impedimento, creado_en, area_id, area_codigo, area, placa, unidad, cliente, trabajo, estado, registrado_por, registrado_por_nombre, fotos, revision, observacion, revisado_en, revisado_por_nombre, corregido_en'

/**
 * Los trabajos sin orden, el que más días lleva sin noticias primero.
 *
 * Sin filtro de estado trae los que siguen abiertos (en curso o terminados);
 * con `SALIO`, los cerrados. La búsqueda mira la placa normalizada —«abc 123»
 * encuentra «ABC-123»— y también qué es y de quién es, porque un trabajo del
 * propio taller no tiene placa.
 */
export async function listarFlota(
  filtros: { estado?: EstadoFlota | null; buscar?: string; trabadas?: boolean } = {},
): Promise<TrabajoSinOrden[]> {
  const supabase = await createClient()

  let consulta = supabase
    .from('v_flota_unidades')
    .select(COLUMNAS_UNIDAD)
    .order('dias_sin_avance', { ascending: false, nullsFirst: true })
    .order('ingreso', { ascending: false })
    .limit(200)

  consulta = filtros.estado
    ? consulta.eq('estado', filtros.estado)
    : consulta.in('estado', ['EN_TALLER', 'LISTA'])

  if (filtros.trabadas) consulta = consulta.not('impedimento', 'is', null)

  // Lo escrito viaja dentro de un filtro `or` de PostgREST, donde la coma,
  // los paréntesis y el comodín tienen significado: se quitan antes.
  const texto = filtros.buscar?.replace(/[,()*%\\]/g, ' ').trim()
  if (texto) {
    const clave = texto.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const ramas = [`descripcion.ilike.*${texto}*`, `cliente.ilike.*${texto}*`]
    if (clave) ramas.unshift(`placa_clave.ilike.*${clave}*`)
    consulta = consulta.or(ramas.join(','))
  }

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudieron leer los trabajos sin orden: ${error.message}`)
  return (data ?? []) as unknown as TrabajoSinOrden[]
}

/** Los que siguen abiertos: para el tablero del taller y para «quién no reportó». */
export function flotaEnTaller() {
  return listarFlota()
}

export async function obtenerFlota(id: string): Promise<TrabajoSinOrden | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_flota_unidades')
    .select(COLUMNAS_UNIDAD)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer el trabajo: ${error.message}`)
  return (data as unknown as TrabajoSinOrden) ?? null
}

/** El estado crudo del trabajo, para que una acción sepa si todavía admite reportes. */
export async function estadoDeFlota(id: string): Promise<EstadoFlota | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('flota_unidades').select('estado').eq('id', id).maybeSingle()
  return (data?.estado as EstadoFlota | undefined) ?? null
}

/** Los reportes de un trabajo, del más reciente al más viejo. */
export async function reportesDeFlota(flotaId: string, limite = 60): Promise<ReporteDeFlota[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_flota_avance_diario')
    .select(COLUMNAS_REPORTE)
    .eq('flota_id', flotaId)
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudieron leer los reportes de la unidad: ${error.message}`)
  return (data ?? []) as unknown as ReporteDeFlota[]
}

/** Lo que se reportó de las unidades sin orden en un día, de todas las áreas. */
export async function flotaDelDia(fecha: string): Promise<ReporteDeFlota[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_flota_avance_diario')
    .select(COLUMNAS_REPORTE)
    .eq('fecha', fecha)
    .order('area')
    .order('creado_en')
    .limit(300)

  if (error) throw new Error(`No se pudo leer la flota del día: ${error.message}`)
  return (data ?? []) as unknown as ReporteDeFlota[]
}

/** Las fotos de un puñado de reportes, agrupadas por reporte. */
export async function fotosDeReportesFlota(avanceIds: string[]) {
  if (avanceIds.length === 0) return {} as Record<string, FotoDeFlota[]>

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('flota_avance_fotos')
    .select('id, avance_id, ruta_storage, nombre_archivo, pie')
    .in('avance_id', avanceIds)
    .order('orden_visual')

  if (error) throw new Error(`No se pudieron leer las fotos: ${error.message}`)

  const porReporte: Record<string, FotoDeFlota[]> = {}
  for (const foto of (data ?? []) as unknown as FotoDeFlota[]) {
    ;(porReporte[foto.avance_id] ??= []).push(foto)
  }
  return porReporte
}

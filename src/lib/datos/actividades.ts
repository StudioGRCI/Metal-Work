import 'server-only'

import { ESTADOS_ACTIVOS_OT, type DatosRevision } from '@/lib/dominio/estados'
import { createClient } from '@/lib/supabase/server'

export type ActividadArea = {
  id: string
  orden_id: string
  area_id: string
  area_codigo: string
  area: string
  orden_secuencia: number
  nombre: string
  detalle: string | null
  referencia: string | null
  peso_pct: number
  avance_pct: number
  terminada: boolean
  ultimo_reporte: string | null
  reportes: number | null
}

export type AvanceDeArea = {
  area_id: string
  area_codigo: string
  area: string
  actividades: number
  terminadas: number
  peso_repartido: number
  avance_pct: number
  ultimo_reporte: string | null
}

/** Un reporte de la hoja por área, con quién lo escribió y en qué va con el jefe. */
export type ReporteDiario = AvanceDelDia

/**
 * La hoja de cada área: sus actividades, cuánto lleva de lo suyo y el diario de
 * los últimos días.
 *
 * El diario sale de la vista `v_ot_avance_diario` y no de la tabla con un
 * `usuarios(...)` embebido: desde la migración 097 la tabla tiene dos llaves
 * hacia `usuarios` —quién reportó y quién revisó—, PostgREST no sabe cuál
 * embeber y la consulta falla. Como ese error no se lanzaba, el diario salía
 * vacío sin avisar.
 */
export async function actividadesDeOrden(ordenId: string): Promise<{
  actividades: ActividadArea[]
  areas: AvanceDeArea[]
  diario: ReporteDiario[]
}> {
  const supabase = await createClient()

  const [actividades, areas, diario] = await Promise.all([
    supabase
      .from('v_ot_actividades')
      .select(
        'id, orden_id, area_id, area_codigo, area, orden_secuencia, nombre, detalle, referencia, peso_pct, avance_pct, terminada, ultimo_reporte, reportes',
      )
      .eq('orden_id', ordenId)
      .order('area')
      .order('orden_secuencia')
      .limit(300),
    supabase
      .from('v_ot_avance_areas')
      .select('area_id, area_codigo, area, actividades, terminadas, peso_repartido, avance_pct, ultimo_reporte')
      .eq('orden_id', ordenId),
    supabase
      .from('v_ot_avance_diario')
      .select(COLUMNAS_DIARIO)
      .eq('orden_id', ordenId)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })
      .limit(40),
  ])

  if (actividades.error) {
    throw new Error(`No se pudieron leer las actividades: ${actividades.error.message}`)
  }
  if (diario.error) {
    throw new Error(`No se pudo leer el diario de la unidad: ${diario.error.message}`)
  }

  return {
    actividades: (actividades.data ?? []) as unknown as ActividadArea[],
    areas: (areas.data ?? []) as unknown as AvanceDeArea[],
    diario: (diario.data ?? []) as unknown as ReporteDiario[],
  }
}

export type AvanceDelDia = {
  id: string
  fecha: string
  avance_pct: number
  nota: string | null
  creado_en: string
  actividad_id: string
  actividad: string
  referencia: string | null
  peso_pct: number
  area_id: string
  area_codigo: string
  area: string
  orden_id: string
  orden_numero: string
  orden_estado: string
  orden_descripcion: string
  reportado_por: string | null
  reportado_por_nombre: string | null
  acumulado_pct: number | null
} & DatosRevision

const COLUMNAS_DIARIO =
  'id, fecha, avance_pct, nota, creado_en, actividad_id, actividad, referencia, peso_pct, area_id, area_codigo, area, orden_id, orden_numero, orden_estado, orden_descripcion, reportado_por, reportado_por_nombre, acumulado_pct, revision, observacion, revisado_en, revisado_por_nombre, corregido_en'

export type HojaDeArea = {
  orden_id: string
  area_id: string
  area_codigo: string
  area: string
  actividades: number
  terminadas: number
  peso_repartido: number
  avance_pct: number
  ultimo_reporte: string | null
  orden_numero: string
  orden_estado: string
}

/**
 * Lo que reportó el taller en un día, de todas las órdenes y todas las áreas.
 *
 * Es la pantalla del jefe de producción: hasta ahora el diario solo se podía
 * leer orden por orden. Sin el cliente a propósito —el taller no tiene
 * `clientes.ver` y traerlo escondería la fila entera—, y con el acumulado de
 * cada actividad, que es lo que se pregunta después de «¿cuánto avanzaste?».
 */
export async function avancesDelDia(fecha: string): Promise<AvanceDelDia[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_ot_avance_diario')
    .select(COLUMNAS_DIARIO)
    .eq('fecha', fecha)
    .order('area')
    .order('orden_numero')
    .limit(500)

  if (error) throw new Error(`No se pudo leer el avance del día: ${error.message}`)
  return (data ?? []) as unknown as AvanceDelDia[]
}

/**
 * Las hojas que siguen abiertas en el taller: área por área y orden por orden,
 * las que no llegaron al 100 % en una orden que todavía vive.
 *
 * Sirve para la otra mitad de la pantalla, la que ninguna lista de reportes
 * enseña: quién **no** reportó ese día.
 */
export async function hojasAbiertas(): Promise<HojaDeArea[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_ot_avance_areas')
    .select(
      'orden_id, area_id, area_codigo, area, actividades, terminadas, peso_repartido, avance_pct, ultimo_reporte, orden_numero, orden_estado',
    )
    .in('orden_estado', [...ESTADOS_ACTIVOS_OT])
    .lt('avance_pct', 100)
    .order('orden_numero')
    .limit(300)

  if (error) throw new Error(`No se pudieron leer las hojas abiertas: ${error.message}`)
  return (data ?? []) as unknown as HojaDeArea[]
}

/** El área de una actividad, para no escribir en la hoja de otro. */
export async function areaDeActividad(actividadId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('ot_actividades')
    .select('area_id')
    .eq('id', actividadId)
    .maybeSingle()
  return data?.area_id ?? null
}

/** Las áreas del taller, para elegir de quién es la lista que se arma. */
export async function areasDelTaller() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('areas')
    .select('id, codigo, nombre')
    .eq('activo', true)
    .order('orden_secuencia')
  return data ?? []
}

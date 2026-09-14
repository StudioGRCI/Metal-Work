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
  /** Según el cronograma (migración 099). */
  fecha_inicio_plan: string | null
  fecha_fin_plan: string | null
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
        'id, orden_id, area_id, area_codigo, area, orden_secuencia, nombre, detalle, referencia, peso_pct, avance_pct, terminada, ultimo_reporte, reportes, fecha_inicio_plan, fecha_fin_plan',
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

export type ActividadDelCronograma = {
  id: string
  orden_id: string
  orden_numero: string
  orden_estado: string
  abierta_en_taller: boolean | null
  area_id: string
  area: string
  nombre: string
  referencia: string | null
  avance_pct: number
  ultimo_reporte: string | null
  fecha_inicio_plan: string | null
  fecha_fin_plan: string | null
}

/**
 * Lo que el cronograma tiene en marcha o ya dejó atrás (migración 099): las
 * actividades que empezaron —inicio en o antes de hoy— y no llegaron al 100 %,
 * en órdenes vivas o por revisar. Con `areaIds` solo las de esas áreas: el
 * supervisor ve lo suyo y el jefe, todo.
 *
 * `hoy` viene de fuera y es la fecha del taller (hoyLima): la de la base va en
 * UTC y de noche ya está en el día siguiente.
 */
export async function cronogramaAbierto(
  hoy: string,
  areaIds: string[] | null,
): Promise<ActividadDelCronograma[]> {
  const supabase = await createClient()

  let consulta = supabase
    .from('v_ot_actividades')
    .select(
      'id, orden_id, orden_numero, orden_estado, abierta_en_taller, area_id, area, nombre, referencia, avance_pct, ultimo_reporte, fecha_inicio_plan, fecha_fin_plan',
    )
    .lte('fecha_inicio_plan', hoy)
    .eq('terminada', false)
    .in('orden_estado', [...ESTADOS_ACTIVOS_OT, 'BORRADOR'])
    .order('fecha_fin_plan', { ascending: true, nullsFirst: false })
    .limit(200)

  if (areaIds) consulta = consulta.in('area_id', areaIds)

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo leer el cronograma: ${error.message}`)

  // En borrador solo las que abrió el taller: esas ya se trabajan mientras las
  // revisan; las de la oficina todavía no.
  return ((data ?? []) as unknown as ActividadDelCronograma[]).filter(
    (a) => a.orden_estado !== 'BORRADOR' || a.abierta_en_taller,
  )
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

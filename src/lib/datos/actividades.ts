import 'server-only'

import { ESTADOS_ACTIVOS_OT } from '@/lib/dominio/estados'
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

export type ReporteDiario = {
  id: string
  actividad_id: string
  fecha: string
  avance_pct: number
  nota: string | null
  actividad: { nombre: string; area_id: string } | null
  reportado: { nombres: string; apellidos: string } | null
}

export type SubcontratoDeOrden = {
  id: string
  numero: string | null
  tipo_servicio: string | null
  descripcion: string | null
  estado: string | null
  proveedor: string | null
  fecha_entrega: string | null
  atrasada: boolean | null
}

/**
 * La hoja de cada área: sus actividades, cuánto lleva de lo suyo, el diario de
 * los últimos días y lo que está esperando de afuera.
 *
 * Los subcontratos se leen del módulo que ya existe y **sin el monto**: el jefe
 * de producción necesita saber qué está esperando del tercero, no lo que
 * cuesta, que es de quien tiene `costos.ver`. El select explícito es lo que lo
 * garantiza.
 */
export async function actividadesDeOrden(ordenId: string): Promise<{
  actividades: ActividadArea[]
  areas: AvanceDeArea[]
  diario: ReporteDiario[]
  subcontratos: SubcontratoDeOrden[]
}> {
  const supabase = await createClient()

  const [actividades, areas, diario, subcontratos] = await Promise.all([
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
      .from('ot_actividad_avances')
      .select(
        'id, actividad_id, fecha, avance_pct, nota, actividad:ot_actividades(nombre, area_id), reportado:usuarios(nombres, apellidos)',
      )
      .eq('orden_id', ordenId)
      .order('fecha', { ascending: false })
      .limit(40),
    supabase
      .from('os_resumen')
      .select('id, numero, tipo_servicio, descripcion, estado, proveedor, fecha_entrega, atrasada')
      .eq('orden_id', ordenId)
      .order('fecha', { ascending: false })
      .limit(30),
  ])

  if (actividades.error) {
    throw new Error(`No se pudieron leer las actividades: ${actividades.error.message}`)
  }

  return {
    actividades: (actividades.data ?? []) as unknown as ActividadArea[],
    areas: (areas.data ?? []) as unknown as AvanceDeArea[],
    diario: (diario.data ?? []) as unknown as ReporteDiario[],
    subcontratos: (subcontratos.data ?? []) as unknown as SubcontratoDeOrden[],
  }
}

export type AvanceDelDia = {
  id: string
  fecha: string
  avance_pct: number
  nota: string | null
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
  reportado_por_nombre: string | null
  acumulado_pct: number | null
}

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
    .select(
      'id, fecha, avance_pct, nota, actividad_id, actividad, referencia, peso_pct, area_id, area_codigo, area, orden_id, orden_numero, orden_estado, orden_descripcion, reportado_por_nombre, acumulado_pct',
    )
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

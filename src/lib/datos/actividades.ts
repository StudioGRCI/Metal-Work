import 'server-only'

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

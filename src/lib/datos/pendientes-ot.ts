import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Lo que una orden tiene pendiente, en crudo: la pantalla decide a quién le
 * toca cada cosa según su puesto (`queMeToca`). Cinco lecturas chicas de las
 * vistas que ya existen; ninguna trae filas enteras.
 */
export type PendientesOrden = {
  /** Observaciones abiertas, con el área a la que van. */
  observacionesAbiertas: { area_id: string }[]
  planos: number
  planosEntregados: number
  /** Líneas de la lista de materiales. */
  materiales: number
  /** Cada área con actividades: cuánto peso lleva repartido. */
  areas: { area_id: string; area: string; peso_repartido: number; actividades: number }[]
  /** Los reportes de la hoja que no están aprobados: por aprobar u observados. */
  reportes: { area_id: string; revision: string | null; reportado_por: string | null }[]
}

const VACIO: PendientesOrden = {
  observacionesAbiertas: [],
  planos: 0,
  planosEntregados: 0,
  materiales: 0,
  areas: [],
  reportes: [],
}

export async function pendientesDeOrden(ordenId: string): Promise<PendientesOrden> {
  const supabase = await createClient()

  const [obs, cumpl, mat, areas, reportes] = await Promise.all([
    supabase.from('v_ot_observaciones').select('area_id').eq('orden_id', ordenId).eq('abierta', true).limit(100),
    supabase.from('v_cumplimiento_ot').select('planos, planos_entregados').eq('orden_id', ordenId).maybeSingle(),
    supabase.from('ot_materiales').select('id', { count: 'exact', head: true }).eq('orden_id', ordenId),
    supabase.from('v_ot_avance_areas').select('area_id, area, peso_repartido, actividades').eq('orden_id', ordenId),
    supabase
      .from('v_ot_avance_diario')
      .select('area_id, revision, reportado_por')
      .eq('orden_id', ordenId)
      .neq('revision', 'APROBADO')
      .limit(200),
  ])

  // Son avisos, no datos de la orden: si una lectura falla, la pestaña se
  // queda sin su número y la pantalla sigue.
  if (obs.error || cumpl.error || mat.error || areas.error || reportes.error) return VACIO

  return {
    observacionesAbiertas: (obs.data ?? []).map((o) => ({ area_id: o.area_id ?? '' })),
    planos: Number(cumpl.data?.planos ?? 0),
    planosEntregados: Number(cumpl.data?.planos_entregados ?? 0),
    materiales: mat.count ?? 0,
    areas: (areas.data ?? []).map((a) => ({
      area_id: a.area_id ?? '',
      area: a.area ?? '',
      peso_repartido: Number(a.peso_repartido ?? 0),
      actividades: Number(a.actividades ?? 0),
    })),
    reportes: (reportes.data ?? []).map((r) => ({
      area_id: r.area_id ?? '',
      revision: r.revision,
      reportado_por: r.reportado_por,
    })),
  }
}

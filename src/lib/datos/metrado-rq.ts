import 'server-only'

import type { EstadoMetrado } from '@/lib/dominio/metrado-rq'
import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { createClient } from '@/lib/supabase/server'

/**
 * Cómo está un insumo de RQ frente al metrado de Diseño (migración
 * 20261120400000): cuánto metró Diseño para ese código, cuánto pidieron antes
 * los otros RQ del código, cuánto se pasa, de qué planos sale y, si se pasa, el
 * sustento de quien pidió y el visto de Diseño.
 */
export type MetradoDelInsumo = {
  linea_id: string
  requerimiento_id: string
  item: number
  estado: EstadoMetrado
  /** Lo que Diseño metró de ese material para el código; vacío si no está en el metrado. */
  metrado: number | null
  pedido_antes: number
  exceso: number
  /** Los planos vigentes del código donde sale ese material («P-01 R2, P-04 R0»). */
  planos: string | null
  sustento: string | null
  sustentado_por: string | null
  sustentado_en: string | null
  decision: 'AUTORIZADO' | 'RECHAZADO' | null
  nota_decision: string | null
  decidido_por: string | null
  decidido_en: string | null
}

const ESTADOS: readonly EstadoMetrado[] = ['NO_APLICA', 'EN_METRADO', 'SIN_SUSTENTO', 'POR_AUTORIZAR', 'AUTORIZADO', 'RECHAZADO', 'REVISADO']

/**
 * El metrado de cada insumo de los RQ, por el id del insumo. Lo leen quien ve
 * los requerimientos y Diseño; a los demás la base les dice que no. Si no se
 * pudo leer, lanza: la tarjeta no puede decir «en regla» sin saberlo.
 */
export async function metradoDeRequerimientos(ids: string[]): Promise<Map<string, MetradoDelInsumo>> {
  const porLinea = new Map<string, MetradoDelInsumo>()
  if (ids.length === 0) return porLinea
  const supabase = await createClient()
  // Una fila por insumo: con 300 RQ pasa de mil, y Supabase corta en mil sin avisar.
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('metrado_de_requerimientos', { p_requerimientos: ids }),
    ['linea_id'],
  )
  if (error) throw new Error(`No se pudo leer el metrado de los requerimientos: ${error.message}`)
  for (const m of data) {
    if (!m.linea_id || !m.requerimiento_id || m.item == null) continue
    const estado = ESTADOS.includes(m.estado as EstadoMetrado) ? (m.estado as EstadoMetrado) : 'NO_APLICA'
    porLinea.set(m.linea_id, {
      linea_id: m.linea_id,
      requerimiento_id: m.requerimiento_id,
      item: m.item,
      estado,
      metrado: m.metrado == null ? null : Number(m.metrado),
      pedido_antes: Number(m.pedido_antes ?? 0),
      exceso: Number(m.exceso ?? 0),
      planos: m.planos,
      sustento: m.sustento,
      sustentado_por: m.sustentado_por,
      sustentado_en: m.sustentado_en,
      decision: m.decision === 'AUTORIZADO' || m.decision === 'RECHAZADO' ? m.decision : null,
      nota_decision: m.nota_decision,
      decidido_por: m.decidido_por,
      decidido_en: m.decidido_en,
    })
  }
  return porLinea
}

/** Los RQ con algún insumo sustentado que espera el visto de quien autoriza (Diseño). */
export async function requerimientosPorAutorizar(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('requerimientos_por_autorizar')
  if (error) throw new Error(`No se pudieron leer los requerimientos por autorizar: ${error.message}`)
  return (data ?? []).flatMap((f) => (f.requerimiento_id ? [f.requerimiento_id] : []))
}

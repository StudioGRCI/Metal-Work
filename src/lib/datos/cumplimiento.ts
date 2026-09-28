import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Vistas } from '@/types/database'

/**
 * El cumplimiento de tiempos por área de una orden: el MW-FOR-ING-8.
 *
 * Es la hoja que Diseño arma por cada OT —un plano por grupo de piezas, con su
 * peso— y donde Maestranza y Producción anotan fechas y vistos. Acá se lee de
 * las tres vistas que la base arma con el porcentaje ya calculado: la pantalla
 * no vuelve a sumar nada, porque la regla de cuánto vale un visto vive allá.
 */
export type PiezaCumplimiento = Vistas<'v_cumplimiento_piezas'>
export type PlanoCumplimiento = Vistas<'v_cumplimiento_planos'> & { etapa_id: string | null; lista: PiezaCumplimiento[] }
export type ResumenCumplimiento = Vistas<'v_cumplimiento_ot'>

export async function cumplimientoDeOrden(ordenId: string): Promise<{
  resumen: ResumenCumplimiento | null
  planos: PlanoCumplimiento[]
}> {
  const supabase = await createClient()

  const [planos, piezas, resumen, vinculos] = await Promise.all([
    supabase
      .from('v_cumplimiento_planos')
      .select(
        'plano_id, orden_id, orden_secuencia, numero_plano, nombre, peso_pct, fecha_entrega, observacion, piezas, piezas_entregadas, piezas_armadas, avance_pct, mtz_desde, mtz_hasta, prd_desde, prd_hasta',
      )
      .eq('orden_id', ordenId)
      .order('orden_secuencia')
      .order('numero_plano'),
    supabase
      .from('v_cumplimiento_piezas')
      .select(
        'id, plano_id, orden_id, orden_secuencia, numero_pieza, nombre, cantidad, es_ensamble, observacion, mtz_inicio, mtz_habilitado, mtz_culminacion, mtz_entregado, mtz_observacion, prd_recepcion, prd_recibido, prd_inicio, prd_armado, prd_observacion, avance_pct, creado_en, actualizado_en',
      )
      .eq('orden_id', ordenId)
      .order('orden_secuencia')
      .order('numero_pieza'),
    supabase
      .from('v_cumplimiento_ot')
      .select(
        'orden_id, numero, planos, planos_entregados, piezas, piezas_entregadas, piezas_armadas, peso_total, avance_pct, primer_plano, ultimo_plano',
      )
      .eq('orden_id', ordenId)
      .maybeSingle(),
    supabase.from('ot_planos').select('id, etapa_id').eq('orden_id', ordenId),
  ])

  if (planos.error) throw new Error(`No se pudieron leer los planos: ${planos.error.message}`)
  if (piezas.error) throw new Error(`No se pudieron leer las piezas: ${piezas.error.message}`)
  if (resumen.error) throw new Error(`No se pudo leer el cumplimiento: ${resumen.error.message}`)
  if (vinculos.error) throw new Error(`No se pudo leer la etapa de los planos: ${vinculos.error.message}`)

  const porPlano = new Map<string, PiezaCumplimiento[]>()
  const etapaPorPlano = new Map((vinculos.data ?? []).map(p => [p.id, p.etapa_id]))
  for (const pieza of (piezas.data ?? []) as PiezaCumplimiento[]) {
    if (!pieza.plano_id) continue
    const lista = porPlano.get(pieza.plano_id) ?? []
    lista.push(pieza)
    porPlano.set(pieza.plano_id, lista)
  }

  return {
    resumen: (resumen.data ?? null) as ResumenCumplimiento | null,
    planos: ((planos.data ?? []) as Vistas<'v_cumplimiento_planos'>[]).map((p) => ({
      ...p,
      etapa_id: p.plano_id ? (etapaPorPlano.get(p.plano_id) ?? null) : null,
      lista: p.plano_id ? (porPlano.get(p.plano_id) ?? []) : [],
    })),
  }
}

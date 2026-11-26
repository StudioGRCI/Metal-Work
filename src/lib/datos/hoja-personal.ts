import 'server-only'

import { rangoDelMes } from '@/lib/datos/rrhh'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que la hoja de una persona junta de un mes y no tiene ya su propia
 * consulta: sus tardanzas una por una y lo que se le pagó. Las observaciones y
 * los permisos salen de `listarObservaciones` y `listarPermisos`, los mismos de
 * sus pantallas. Cada parte la pide la página solo si quien mira tiene el
 * permiso con que hoy se muestra (plan 13, entrega 13.1).
 */

/** Un ingreso que pasó la tolerancia. Sin soles: el descuento es del mes, no de cada marca. */
export type TardanzaDeLaHoja = {
  id: string
  fecha: string
  hora: string
  minutos: number
  anulado_en: string | null
  motivo_anulacion: string | null
}

/**
 * Las tardanzas de la persona en el mes (`YYYY-MM`), anuladas incluidas, y
 * cuántos días marcó su ingreso. Se lee de `asistencias` con su política
 * (`puede_ver_trabajadores`); la columna `descuento` no se pide.
 */
export async function tardanzasDeLaPersona(trabajadorId: string, mes: string): Promise<{ tardanzas: TardanzaDeLaHoja[]; diasConIngreso: number }> {
  const supabase = await createClient()
  const { desde, hasta } = rangoDelMes(mes)
  const { data, error } = await supabase
    .from('asistencias')
    .select('id, fecha, hora, tardanza_minutos, es_tardanza, anulado_en, motivo_anulacion')
    .eq('trabajador_id', trabajadorId)
    .eq('tipo', 'INGRESO')
    .gte('fecha', desde)
    .lt('fecha', hasta)
    .order('fecha')
    .order('hora')
  if (error) throw new Error(`No se pudieron leer las marcas de la persona: ${error.message}`)
  const filas = data ?? []
  const dias = new Set(filas.filter((f) => !f.anulado_en).map((f) => f.fecha))
  return {
    diasConIngreso: dias.size,
    tardanzas: filas
      .filter((f) => f.es_tardanza)
      .map((f) => ({
        id: f.id,
        fecha: f.fecha,
        hora: f.hora,
        minutos: f.tardanza_minutos,
        anulado_en: f.anulado_en,
        motivo_anulacion: f.motivo_anulacion,
      })),
  }
}

/** Un pago a la persona: su parte de una planilla diaria (taller) o un pago de la oficina. */
export type PagoDeLaHoja =
  | {
      clase: 'PLANILLA_DIARIA'
      id: string
      /** El día en que RR. HH. armó la planilla diaria. */
      fecha: string
      planilla_id: string
      numero: string
      horas_ordinarias: number
      horas_extras: number
      horas_permiso: number
      monto_descuentos: number
      total: number
      /** El día en que Tesorería la pagó, si ya la pagó. */
      pagado_el: string | null
      boleta_entregada: boolean
      anulado_en: string | null
      motivo_anulacion: string | null
    }
  | {
      clase: 'OFICINA'
      id: string
      /** El último día del tramo que paga. */
      fecha: string
      desde: string
      hasta: string
      monto: number
      aportes: number
      descuentos: number
      nota: string | null
      anulado_en: string | null
      motivo_anulacion: string | null
    }

type FilaPersonaPlanilla = {
  id: string
  horas_ordinarias: number | string
  horas_extras: number | string
  horas_permiso: number | string | null
  monto_descuentos: number | string | null
  total: number | string
  boleta_entregada_en: string | null
  planilla_id: string
  pago: { fecha_pago: string; anulado_en: string | null } | null
}

/**
 * Lo que se le pagó a la persona en el mes (`YYYY-MM`): su parte de cada
 * planilla diaria de ese mes y cada pago de la oficina que toca algún día del
 * mes, anulados incluidos. Solo para quien lleva el personal: son soles, y
 * Gerencia y Administración no los ven.
 */
export async function pagosDeLaPersona(trabajadorId: string, mes: string): Promise<PagoDeLaHoja[]> {
  const supabase = await createClient()
  const { desde, hasta } = rangoDelMes(mes)
  // Primero las planillas diarias del mes y después la parte de la persona en
  // ellas: filtrar por la fecha de la planilla dentro del embebido pide `!inner`
  // con su llave nombrada, que el banco local no lee.
  const [delMes, oficina] = await Promise.all([
    supabase.from('planillas_diarias').select('id, numero, fecha, anulado_en, motivo_anulacion').gte('fecha', desde).lt('fecha', hasta),
    supabase
      .from('oficina_pagos')
      .select('id, desde, hasta, monto, aportes, nota, anulado_en, motivo_anulacion, descuentos:descuentos_del_pago!descuentos_del_pago_oficina_pago_id_fkey(monto)')
      .eq('trabajador_id', trabajadorId)
      .lt('desde', hasta)
      .gte('hasta', desde),
  ])
  if (delMes.error) throw new Error(`No se pudieron leer las planillas diarias del mes: ${delMes.error.message}`)
  const planillas = new Map((delMes.data ?? []).map((p) => [p.id, p]))
  const diarias =
    planillas.size === 0
      ? { data: [], error: null }
      : await supabase
          .from('planilla_diaria_personas')
          .select(
            'id, planilla_id, horas_ordinarias, horas_extras, horas_permiso, monto_descuentos, total, boleta_entregada_en,' +
              ' pago:planilla_diaria_pagos!planilla_diaria_personas_pago_id_fkey(fecha_pago, anulado_en)',
          )
          .eq('trabajador_id', trabajadorId)
          .in('planilla_id', [...planillas.keys()])
  if (diarias.error) throw new Error(`No se pudieron leer las planillas diarias de la persona: ${diarias.error.message}`)
  if (oficina.error) throw new Error(`No se pudieron leer los pagos de la oficina de la persona: ${oficina.error.message}`)

  const pagos: PagoDeLaHoja[] = []
  for (const f of (diarias.data ?? []) as unknown as FilaPersonaPlanilla[]) {
    const planilla = planillas.get(f.planilla_id)
    if (!planilla) continue
    pagos.push({
      clase: 'PLANILLA_DIARIA',
      id: f.id,
      fecha: planilla.fecha,
      planilla_id: planilla.id,
      numero: planilla.numero,
      horas_ordinarias: Number(f.horas_ordinarias),
      horas_extras: Number(f.horas_extras),
      horas_permiso: Number(f.horas_permiso ?? 0),
      monto_descuentos: Number(f.monto_descuentos ?? 0),
      total: Number(f.total),
      pagado_el: f.pago && !f.pago.anulado_en ? f.pago.fecha_pago : null,
      boleta_entregada: f.boleta_entregada_en !== null,
      anulado_en: planilla.anulado_en,
      motivo_anulacion: planilla.motivo_anulacion,
    })
  }
  for (const p of oficina.data ?? []) {
    pagos.push({
      clase: 'OFICINA',
      id: p.id,
      fecha: p.hasta,
      desde: p.desde,
      hasta: p.hasta,
      monto: Number(p.monto),
      aportes: Number(p.aportes),
      descuentos: (p.descuentos ?? []).reduce((n, d) => n + Number(d.monto), 0),
      nota: p.nota,
      anulado_en: p.anulado_en,
      motivo_anulacion: p.motivo_anulacion,
    })
  }
  return pagos
}

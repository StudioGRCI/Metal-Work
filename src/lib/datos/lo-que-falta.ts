import 'server-only'

import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import type { OcQueTraba, ReglaDeAprobacion } from '@/lib/dominio/lo-que-falta'
import { createClient } from '@/lib/supabase/server'

/** Desde cuándo espera una OC la aprobación de Gerencia, y cuántos días van (con la fecha de Lima). */
export type EsperaDeGerencia = { aprobacion: string | null; desde: string | null; dias: number | null }

/**
 * Las OC por aprobar de las facturas por pagar: desde cuándo se pidió su
 * aprobación (`aprobacion_pedida_en`, la pone `evaluar_aprobacion_compra`) y
 * cuántos días lleva, contados por la base (plan 0.2). Quien abre Cuentas por
 * pagar lee las OC (`compras.ver`); si no las puede leer o la base no cuenta
 * los días, la fila dice igual qué falta y de quién, sin los días.
 */
export async function esperaDeGerencia(ids: string[]): Promise<Map<string, EsperaDeGerencia>> {
  const mapa = new Map<string, EsperaDeGerencia>()
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return mapa
  const supabase = await createClient()
  const { data, error } = await supabase.from('ordenes_compra_materiales').select('id, aprobacion, aprobacion_pedida_en').in('id', unicos)
  if (error) {
    console.error(`No se pudo leer desde cuándo esperan a Gerencia: ${error.message}`)
    return mapa
  }
  const filas = data ?? []
  const dias = await diasEnEspera(filas.map((f) => f.aprobacion_pedida_en)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    return filas.map(() => null)
  })
  filas.forEach((f, i) => mapa.set(f.id, { aprobacion: f.aprobacion, desde: f.aprobacion_pedida_en, dias: dias[i] ?? null }))
  return mapa
}

/**
 * Qué OC traba el pago de cada factura, dicho por la base con la misma regla que
 * rechaza el pago (`ocs_que_traban_las_facturas`, migración 20261126560000): la
 * de la factura, la de la columna vieja o la que la anexó. Con los días de la
 * que espera a Gerencia. `'error'` si no se pudo leer, para que la pantalla lo
 * diga en vez de ofrecer un pago que la base va a rechazar.
 */
export async function ocsQueTrabanLasFacturas(ids: string[]): Promise<Map<string, OcQueTraba> | 'error'> {
  const mapa = new Map<string, OcQueTraba>()
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return mapa
  const supabase = await createClient()
  const filas: { adquisicion_id: string | null; orden_compra_id: string | null; nombre: string | null; aprobacion: string | null; pedida_en: string | null }[] = []
  for (let i = 0; i < unicos.length; i += 500) {
    const { data, error } = await supabase.rpc('ocs_que_traban_las_facturas', { p_ids: unicos.slice(i, i + 500) })
    if (error) {
      console.error(`No se pudo leer qué traba el pago de las facturas: ${error.message}`)
      return 'error'
    }
    filas.push(...(data ?? []))
  }
  const dias = await diasEnEspera(filas.map((f) => (f.aprobacion === 'POR_APROBAR' ? f.pedida_en : null))).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    return filas.map(() => null)
  })
  filas.forEach((f, i) => {
    if (f.adquisicion_id) {
      mapa.set(f.adquisicion_id, { id: f.orden_compra_id, nombre: f.nombre ?? 'OC', aprobacion: f.aprobacion, desde: f.aprobacion === 'POR_APROBAR' ? f.pedida_en : null, dias: dias[i] ?? null })
    }
  })
  return mapa
}

/**
 * La regla vigente que hace esperar a Gerencia (`regla_aprobacion_compras`), tal
 * como está: esta pantalla la muestra, no la cambia. `null` si quien mira no la
 * lee (su política pide `compras.ver`); `'error'` si la lectura falló, para que
 * la pantalla lo diga en vez de callar la regla.
 */
export async function reglaDeAprobacion(): Promise<ReglaDeAprobacion | 'error' | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('regla_aprobacion_compras').select('activa, monto_desde, rol:roles(nombre)').maybeSingle()
  if (error) {
    console.error(`No se pudo leer la regla de aprobación de compras: ${error.message}`)
    return 'error'
  }
  if (!data) return null
  return { activa: Boolean(data.activa), montoDesde: Number(data.monto_desde ?? 0), puesto: data.rol?.nombre ?? null }
}

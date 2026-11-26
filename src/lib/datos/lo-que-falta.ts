import 'server-only'

import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import type { ReglaDeAprobacion } from '@/lib/dominio/lo-que-falta'
import { createClient } from '@/lib/supabase/server'

/** Desde cuándo espera una OC la aprobación de Gerencia, y cuántos días van (con la fecha de Lima). */
export type EsperaDeGerencia = { desde: string | null; dias: number | null }

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
  const { data, error } = await supabase.from('ordenes_compra_materiales').select('id, aprobacion_pedida_en').in('id', unicos)
  if (error) {
    console.error(`No se pudo leer desde cuándo esperan a Gerencia: ${error.message}`)
    return mapa
  }
  const filas = data ?? []
  const dias = await diasEnEspera(filas.map((f) => f.aprobacion_pedida_en)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    return filas.map(() => null)
  })
  filas.forEach((f, i) => mapa.set(f.id, { desde: f.aprobacion_pedida_en, dias: dias[i] ?? null }))
  return mapa
}

/**
 * La regla vigente que hace esperar a Gerencia (`regla_aprobacion_compras`), tal
 * como está: esta pantalla la muestra, no la cambia. `null` si no se puede leer.
 */
export async function reglaDeAprobacion(): Promise<ReglaDeAprobacion | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('regla_aprobacion_compras').select('activa, monto_desde, rol:roles(nombre)').maybeSingle()
  if (error || !data) {
    if (error) console.error(`No se pudo leer la regla de aprobación de compras: ${error.message}`)
    return null
  }
  return { activa: Boolean(data.activa), montoDesde: Number(data.monto_desde ?? 0), puesto: data.rol?.nombre ?? null }
}

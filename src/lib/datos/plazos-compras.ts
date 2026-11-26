import 'server-only'

import type { LoQueFalta, PlazoDeCompra, PlazoDeServicio } from '@/lib/dominio/plazos'
import { createClient } from '@/lib/supabase/server'

/**
 * Cada OC y cada OS contra la fecha que prometió el proveedor (migración
 * 20261126200000): cuándo llegó, cuándo quedó completa, los días de atraso por
 * fecha de Lima y, de la OC que llegó a medias, lo que falta. La base decide
 * quién lo lee —quien lee el listado— y cuenta los días; aquí no se calcula nada.
 *
 * Si la base no contesta, lanza: la pantalla decide si sigue sin los plazos.
 */

// El tope de las dos funciones.
const POR_TANDA = 500

function tandas(ids: readonly string[]) {
  const unicos = [...new Set(ids)]
  const lista: string[][] = []
  for (let i = 0; i < unicos.length; i += POR_TANDA) lista.push(unicos.slice(i, i + POR_TANDA))
  return lista
}

function loQueFalta(valor: unknown): LoQueFalta[] | null {
  if (!Array.isArray(valor)) return null
  return valor.map((x: Record<string, unknown>) => ({
    material: String(x.material ?? 'Material sin catálogo'),
    unidad: x.unidad == null ? null : String(x.unidad),
    pedido: Number(x.pedido ?? 0),
    falta: Number(x.falta ?? 0),
  }))
}

/** El plazo de esas OC, por id. La que quien mira no ve no sale. */
export async function plazosDeCompras(ids: readonly string[]): Promise<Map<string, PlazoDeCompra>> {
  const porId = new Map<string, PlazoDeCompra>()
  if (ids.length === 0) return porId
  const supabase = await createClient()
  const respuestas = await Promise.all(tandas(ids).map((t) => supabase.rpc('plazos_de_compras', { p_ids: t })))
  for (const { data, error } of respuestas) {
    if (error) throw new Error(`No se pudo leer el plazo de las órdenes de compra: ${error.message}`)
    for (const f of data ?? []) {
      if (!f.documento) continue
      porId.set(f.documento, {
        esperada: f.esperada,
        llego_en: f.llego_en,
        completa_en: f.completa_en,
        dias_atraso: f.dias_atraso == null ? null : Number(f.dias_atraso),
        atrasada: f.atrasada === true,
        por_llegar: loQueFalta(f.por_llegar),
      })
    }
  }
  return porId
}

/** El plazo de esas OS, por id. */
export async function plazosDeServicios(ids: readonly string[]): Promise<Map<string, PlazoDeServicio>> {
  const porId = new Map<string, PlazoDeServicio>()
  if (ids.length === 0) return porId
  const supabase = await createClient()
  const respuestas = await Promise.all(tandas(ids).map((t) => supabase.rpc('plazos_de_servicios', { p_ids: t })))
  for (const { data, error } of respuestas) {
    if (error) throw new Error(`No se pudo leer el plazo de las órdenes de servicio: ${error.message}`)
    for (const f of data ?? []) {
      if (!f.documento) continue
      porId.set(f.documento, {
        esperada: f.esperada,
        llego_en: null,
        completa_en: f.completa_en,
        dias_atraso: f.dias_atraso == null ? null : Number(f.dias_atraso),
        atrasada: f.atrasada === true,
        por_llegar: null,
      })
    }
  }
  return porId
}

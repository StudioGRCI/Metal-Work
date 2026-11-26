import 'server-only'

import type { LoQueFalta, PlazoDeCompra, PlazoDeServicio } from '@/lib/dominio/plazos'
import { todasLasFilas } from '@/lib/datos/todas-las-filas'
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

/**
 * De esas OC u OS, las que pasaron la fecha del documento y aceptan el motivo del atraso aunque no
 * pasen la corregida (20261126945000). La base solo se las dice a quien anota. Si no contesta, el
 * botón sale solo en las atrasadas contra la fecha corregida, como antes: no se cae la lista.
 */
async function aceptanMotivo(supabase: Awaited<ReturnType<typeof createClient>>, tipo: 'OC' | 'OS', ids: readonly string[]) {
  const aceptan = new Set<string>()
  const respuestas = await Promise.all(tandas(ids).map((t) => supabase.rpc('compras_que_aceptan_motivo', { p_tipo: tipo, p_ids: t })))
  for (const { data, error } of respuestas) {
    if (error) {
      console.error('Plazos: no se pudo leer qué compras aceptan el motivo del atraso.', error.message)
      continue
    }
    for (const f of data ?? []) if (f.documento) aceptan.add(f.documento)
  }
  return aceptan
}

/** El plazo de esas OC, por id. La que quien mira no ve no sale. */
export async function plazosDeCompras(ids: readonly string[]): Promise<Map<string, PlazoDeCompra>> {
  const porId = new Map<string, PlazoDeCompra>()
  if (ids.length === 0) return porId
  const supabase = await createClient()
  const [respuestas, aceptan] = await Promise.all([
    Promise.all(tandas(ids).map((t) => supabase.rpc('plazos_de_compras', { p_ids: t }))),
    aceptanMotivo(supabase, 'OC', ids),
  ])
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
        por_validar: f.por_validar === true,
        acepta_motivo: aceptan.has(f.documento),
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
  const [respuestas, aceptan] = await Promise.all([
    Promise.all(tandas(ids).map((t) => supabase.rpc('plazos_de_servicios', { p_ids: t }))),
    aceptanMotivo(supabase, 'OS', ids),
  ])
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
        por_validar: false,
        acepta_motivo: aceptan.has(f.documento),
      })
    }
  }
  return porId
}

/**
 * La fecha corregida de cada OC u OS que la tiene: la última que Logística
 * anotó en el seguimiento (migración 20261126462000), por id del documento. La
 * que nunca se corrigió no sale, y vale la del documento. Es la misma regla de
 * `fecha_prometida_de_compra`, que no se ejecuta desde la sesión: aquí se lee
 * con el RLS de quien mira, que ve el seguimiento de la compra que ve. Así el
 * conductor, Almacén, Atención de RQ y Gerencia esperan la compra el mismo día
 * que Logística (DKS, 2026-11-26).
 *
 * Si la base no contesta, lanza: mostrar la fecha vieja como si fuera la buena
 * es justo lo que esto arregla.
 */
export type FechaCorregida = {
  /** La que vale hoy: la última corregida. */
  fecha: string
  /** La que salió en el documento: la de antes de la primera corrección. */
  antes: string | null
}

export async function fechasCorregidas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: { oc?: readonly string[]; os?: readonly string[] },
): Promise<Map<string, FechaCorregida>> {
  const porId = new Map<string, FechaCorregida>()
  const pedidos = [
    ...tandasDe(ids.oc ?? []).map((t) => ['orden_compra_id', t] as const),
    ...tandasDe(ids.os ?? []).map((t) => ['orden_servicio_id', t] as const),
  ]
  if (pedidos.length === 0) return porId
  const respuestas = await Promise.all(
    pedidos.map(([columna, t]) =>
      // Todas: Supabase corta en mil sin avisar. La que vale es la última: el mismo orden que
      // `fecha_prometida_de_compra`, con el id al final para que el orden sea total.
      todasLasFilas(
        () =>
          supabase
            .from('seguimiento_de_compras')
            .select('orden_compra_id, orden_servicio_id, fecha_anterior, fecha_nueva')
            .eq('tipo', 'FECHA_ESPERADA')
            .in(columna, t),
        ['registrado_en.desc', 'creado_en.desc', 'id.desc'],
      ),
    ),
  )
  for (const { data, error } of respuestas) {
    if (error) throw new Error(`No se pudo leer la fecha corregida de las compras: ${error.message}`)
    for (const f of data ?? []) {
      const documento = f.orden_compra_id ?? f.orden_servicio_id
      if (!documento || !f.fecha_nueva) continue
      // Vienen de la última a la primera: la primera fija la que vale; cada una de antes, la del documento.
      const ya = porId.get(documento)
      porId.set(documento, { fecha: ya?.fecha ?? f.fecha_nueva, antes: f.fecha_anterior ?? ya?.antes ?? null })
    }
  }
  return porId
}

// En la URL de PostgREST: 150 ids caben holgados.
function tandasDe(ids: readonly string[]) {
  const unicos = [...new Set(ids.filter(Boolean))]
  const lista: string[][] = []
  for (let i = 0; i < unicos.length; i += 150) lista.push(unicos.slice(i, i + 150))
  return lista
}

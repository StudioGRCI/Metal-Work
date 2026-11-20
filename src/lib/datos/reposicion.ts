import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { createClient } from '@/lib/supabase/server'

/**
 * Un material de la lista de reposición (`reposicion_de_stock`, migración
 * 20261120420000): lo que hay, lo que ya viene en otras OC, su stock de
 * seguridad, cuánto salió en 90 días y cuánto comprar. Sin precios.
 */
export type MaterialParaReponer = {
  material_id: string
  codigo: string
  descripcion: string
  unidad: string | null
  almacen: string | null
  categoria: string | null
  existencia: number
  libre: number
  /** Lo que viene en OC aprobadas (o que no la necesitan) y todavía no entró al kardex. */
  en_camino: number
  /** En qué OC viene, nombradas. */
  en_camino_ocs: string | null
  /** Lo que piden otras OC que todavía esperan a Gerencia: también cuenta para no comprarlo dos veces. */
  por_aprobar: number
  por_aprobar_ocs: string | null
  stock_minimo: number | null
  compra_por_mayor: number | null
  salio_90_dias: number
  /** Cuánto comprar: 0 si lo que hay y lo que viene alcanza el mínimo. */
  comprar: number
}

const numero = (v: unknown) => Number(v ?? 0)
const oNulo = (v: unknown) => (v == null ? null : Number(v))

/** La lista de reposición. Si no se pudo leer, lanza: una lista vacía diría «nada que reponer». */
export async function reposicionDeStock(): Promise<MaterialParaReponer[]> {
  const supabase = await createClient()
  // Un material por fila: con el catálogo entero pasa de mil, y Supabase corta en mil sin avisar.
  const { data, error } = await todasLasFilas(() => supabase.rpc('reposicion_de_stock'), ['material_id'])
  if (error) throw new Error(`No se pudo leer la reposición de stock: ${error.message}`)
  return data.flatMap((f) =>
    f.material_id
      ? [
          {
            material_id: f.material_id,
            codigo: f.codigo ?? '',
            descripcion: f.descripcion ?? '',
            unidad: f.unidad,
            almacen: f.almacen,
            categoria: f.categoria,
            existencia: numero(f.existencia),
            libre: numero(f.libre),
            en_camino: numero(f.en_camino),
            en_camino_ocs: f.en_camino_ocs,
            por_aprobar: numero(f.por_aprobar),
            por_aprobar_ocs: f.por_aprobar_ocs,
            stock_minimo: oNulo(f.stock_minimo),
            compra_por_mayor: oNulo(f.compra_por_mayor),
            salio_90_dias: numero(f.salio_90_dias),
            comprar: numero(f.comprar),
          },
        ]
      : [],
  )
}

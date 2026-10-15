import 'server-only'

import { type Almacen, esAlmacen } from '@/lib/dominio/almacen'
import { createClient } from '@/lib/supabase/server'

/** Cuánto de un accesorio entró para un código interno y todavía no salió. */
export type StockDeCodigo = { codigo: string; cantidad: number }

/** Un material con kardex, como lo reporta Almacén: cuánto hay y dónde, sin precios. */
export type MaterialEnStock = {
  material_id: string
  codigo: string
  descripcion: string
  unidad: string
  /** A cuál de los cuatro almacenes pertenece; vacío mientras Almacén no lo clasifica. */
  almacen: Almacen | null
  categoria: string
  existencia: number
  /** El mínimo que fijó Almacén; vacío si no fijó ninguno. */
  stock_minimo: number | null
  /** Solo los accesorios: lo que es de cada código interno. Lo demás está libre. */
  por_codigo: StockDeCodigo[]
}

/**
 * El stock de cada material con kardex (migración 20261016950000). Lo lee la
 * base con el mismo saldo que el kardex de Almacén, así que dicen lo mismo; a
 * Supervisión se lo da `almacen.stock`, sin abrirle el kardex.
 */
export async function stockEnAlmacen(): Promise<MaterialEnStock[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('stock_en_almacen')
  if (error) throw new Error(`No se pudo leer el stock de Almacén: ${error.message}`)
  return (data ?? [])
    .flatMap((m) =>
      m.material_id
        ? [
            {
              material_id: m.material_id,
              codigo: m.codigo ?? '',
              descripcion: m.descripcion ?? 'Material',
              unidad: m.unidad ?? '',
              almacen: esAlmacen(m.almacen) ? m.almacen : null,
              categoria: m.categoria ?? '',
              existencia: Number(m.existencia ?? 0),
              stock_minimo: m.stock_minimo == null ? null : Number(m.stock_minimo),
              por_codigo: ((m.por_codigo as StockDeCodigo[] | null) ?? []).map((c) => ({ codigo: c.codigo, cantidad: Number(c.cantidad) })),
            },
          ]
        : [],
    )
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'))
}

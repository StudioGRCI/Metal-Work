import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { type Almacen, esAlmacen } from '@/lib/dominio/almacen'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que ya es de un código interno: lo que Almacén separó para sus RQ abiertos
 * y todavía no entregó, y los accesorios que entraron para esa unidad. Los
 * números de RQ solo llegan a quien puede ver los requerimientos.
 */
export type StockDeCodigo = {
  codigo: string
  cantidad: number
  /** Cuánto de eso ya separaron sus RQ abiertos: a otro RQ del mismo código no le sirve. */
  de_requerimientos: number
  requerimientos: string[]
}

/** Un material con kardex, como lo reporta Almacén: cuánto hay, cuánto está libre y de quién es lo demás, sin precios. */
export type MaterialEnStock = {
  material_id: string
  codigo: string
  descripcion: string
  unidad: string
  /** A cuál de los cuatro almacenes pertenece; vacío mientras Almacén no lo clasifica. */
  almacen: Almacen | null
  categoria: string
  /** Lo que dice el kardex: todo lo que hay en el almacén. */
  existencia: number
  /** El mínimo que fijó Almacén; vacío si no fijó ninguno. */
  stock_minimo: number | null
  /** Lo que apartaron los pedidos de OT del circuito anterior. */
  reservado_ot: number
  /** Lo que ya es de algún código interno; puede pasar la existencia si se separó de más. */
  separado: number
  /** Lo que se puede usar para un pedido nuevo. Nunca baja de cero. */
  libre: number
  por_codigo: StockDeCodigo[]
}

/**
 * El stock de cada material con kardex, con lo libre y lo de cada código
 * interno (migración 20261020195000). Lo lee la base con el mismo saldo que el
 * kardex de Almacén; a Supervisión, Requerimientos y Administración se lo da
 * `almacen.stock`, sin abrirles el kardex. Con `materiales`, solo esos.
 */
export async function stockEnAlmacen(materiales?: string[]): Promise<MaterialEnStock[]> {
  if (materiales && materiales.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('stock_libre_en_almacen', materiales ? { p_materiales: materiales } : {}),
    ['material_id'],
  )
  if (error) throw new Error(`No se pudo leer el stock de Almacén: ${error.message}`)
  return data
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
              reservado_ot: Number(m.reservado_ot ?? 0),
              separado: Number(m.separado ?? 0),
              libre: Number(m.libre ?? 0),
              por_codigo: ((m.por_codigo as StockDeCodigo[] | null) ?? []).map((c) => ({
                codigo: c.codigo,
                cantidad: Number(c.cantidad),
                de_requerimientos: Number(c.de_requerimientos ?? 0),
                requerimientos: c.requerimientos ?? [],
              })),
            },
          ]
        : [],
    )
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'))
}

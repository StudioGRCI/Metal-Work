import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { type Almacen, esAlmacen, redondearCantidad, topeDeCantidad } from '@/lib/dominio/almacen'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

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
  /** Los accesorios que entraron para esa unidad y siguen ahí: solo salen hacia ella. */
  del_kardex: number
  requerimientos: string[]
  /** Lo separado por cada línea de RQ, para saber cuánto es de cada uno. Vacío si no se ven los RQ. */
  lineas: { linea: string; numero: string; cantidad: number }[]
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
  /** Lo que puede salir sin un pedido de OT: lo que hay menos lo apartado para ellos. */
  disponible: number
  /** Cuánto se separó por encima de lo que hay: se separó dos veces lo mismo o salió por otro lado. */
  de_mas: number
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
  return aMateriales(data)
}

/**
 * Solo los materiales que tienen algo separado para un código o apartado para
 * un pedido de OT: lo que la salida del kardex necesita para avisar antes de
 * sacar lo de otro. A los demás no les falta nada: todo lo que hay está libre.
 * Los pedidos de OT vienen de aquí y no del kardex, porque la vista del kardex
 * no se los cuenta a quien no ve las OT, y Almacén no las ve. Filtrado en la
 * base, cabe en una tanda y la función corre una vez; pedida entera,
 * `todasLasFilas` la volvía a correr por cada mil materiales.
 */
export async function separadoEnAlmacen(): Promise<MaterialEnStock[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('stock_libre_en_almacen', {}).or('separado.gt.0,reservado_ot.gt.0'),
    ['material_id'],
  )
  if (error) throw new Error(`No se pudo leer lo separado en Almacén: ${error.message}`)
  return aMateriales(data)
}

type FilaDeStock = Database['public']['Functions']['stock_libre_en_almacen']['Returns'][number]

/**
 * Las cuentas con lo que da la base se hacen aquí, redondeadas a sus tres
 * decimales, y la pantalla las pinta: restadas en el navegador daban «Se separó
 * 0 M más de lo que hay» con 0.1 + 0.2 separados de 0.3.
 */
function aMateriales(data: FilaDeStock[]): MaterialEnStock[] {
  return data
    .flatMap((m) => {
      const existencia = Number(m.existencia ?? 0)
      const reservado_ot = Number(m.reservado_ot ?? 0)
      const separado = Number(m.separado ?? 0)
      return m.material_id
        ? [
            {
              material_id: m.material_id,
              codigo: m.codigo ?? '',
              descripcion: m.descripcion ?? 'Material',
              unidad: m.unidad ?? '',
              almacen: esAlmacen(m.almacen) ? m.almacen : null,
              categoria: m.categoria ?? '',
              existencia,
              stock_minimo: m.stock_minimo == null ? null : Number(m.stock_minimo),
              reservado_ot,
              separado,
              libre: Number(m.libre ?? 0),
              disponible: Math.max(topeDeCantidad(existencia - reservado_ot), 0),
              de_mas: Math.max(redondearCantidad(separado + reservado_ot - existencia), 0),
              por_codigo: ((m.por_codigo as StockDeCodigo[] | null) ?? []).map((c) => ({
                codigo: c.codigo,
                cantidad: Number(c.cantidad),
                de_requerimientos: Number(c.de_requerimientos ?? 0),
                del_kardex: Number(c.del_kardex ?? 0),
                requerimientos: c.requerimientos ?? [],
                lineas: (c.lineas ?? []).map((l) => ({ linea: l.linea, numero: l.numero, cantidad: Number(l.cantidad) })),
              })),
            },
          ]
        : []
    })
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'))
}

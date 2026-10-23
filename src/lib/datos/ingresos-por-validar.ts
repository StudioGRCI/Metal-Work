import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type LineaPorValidar = {
  id: string
  materialId: string
  codigo: string
  descripcion: string
  unidad: string | null
  cantidad: number
  ordenId: string | null
  ordenNumero: string | null
}

/** Una entrega del conductor: la OC que dejó en almacén y sus líneas por validar. */
export type EntregaPorValidar = {
  compraId: string
  /**
   * La OC nombrada por la base: su número, u «OC sin número (ref. del proveedor
   * …)» (migración 20261023130000). Es también el documento que queda en el
   * kardex si Almacén deja la guía en blanco.
   */
  referencia: string
  proveedor: string
  directa: boolean
  dejadoEn: string
  dejadoPor: string | null
  recogidoEn: string | null
  lineas: LineaPorValidar[]
}

/**
 * Lo que el conductor dejó en almacén y Almacén todavía no valida, agrupado
 * por compra y la más antigua primero. La base lo entrega por función: las
 * compras se leen por el área de su requerimiento y una OC directa no tiene.
 */
export async function ingresosPorValidar(): Promise<EntregaPorValidar[]> {
  const db = await createClient()
  const { data, error } = await db.rpc('ingresos_por_validar')
  // Sin la función todavía en la base (la pantalla salió antes que la
  // migración del conductor) no hay nada que validar; cualquier otro error sí
  // se muestra.
  if (error?.code === 'PGRST202' || error?.code === '42883') return []
  if (error) throw new Error(`No se pudieron cargar los ingresos por validar: ${error.message}`)

  const porCompra = new Map<string, EntregaPorValidar>()
  for (const f of data ?? []) {
    if (!f.id || !f.orden_compra_id || !f.material_id) continue
    const entrega = porCompra.get(f.orden_compra_id) ?? {
      compraId: f.orden_compra_id,
      referencia: f.referencia ?? 'OC',
      proveedor: f.proveedor ?? '',
      directa: Boolean(f.compra_directa),
      dejadoEn: f.dejado_en ?? '',
      dejadoPor: f.dejado_por_nombre,
      recogidoEn: f.recogido_en,
      lineas: [],
    }
    porCompra.set(f.orden_compra_id, entrega)
    entrega.lineas.push({
      id: f.id,
      materialId: f.material_id,
      codigo: f.material_codigo ?? '',
      descripcion: f.material ?? 'Material',
      unidad: f.unidad_medida,
      cantidad: Number(f.cantidad),
      ordenId: f.orden_id,
      ordenNumero: f.orden_numero,
    })
  }
  return [...porCompra.values()]
}

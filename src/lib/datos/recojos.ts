import 'server-only'

import { createClient } from '@/lib/supabase/server'

/** Lo que el conductor recoge de una compra: sin precios, solo qué y cuánto. */
export type LineaRecojo = { material_codigo: string; material: string; unidad: string | null; cantidad: number }

export type Recojo = {
  id: string
  referencia: string
  proveedor: string
  proveedor_documento: string | null
  proveedor_direccion: string | null
  proveedor_telefono: string | null
  proveedor_contacto: string | null
  fecha_estimada: string | null
  /** POR_RECOGER, EN_CAMINO o EN_ALMACEN: ver `ESTADO_RECOJO`. */
  estado: string
  recogido_en: string | null
  recogido_por: string | null
  dejado_en: string | null
  dejado_por: string | null
  documento_entrega: string | null
  /** Almacén ya validó todo lo que trajo. */
  ingresado: boolean
  lineas: LineaRecojo[]
}

/** Una línea de la compra que Almacén valida: lo comprado, lo ya recibido y lo que falta. */
export type LineaPorValidar = {
  id: string
  material_codigo: string
  material: string
  unidad: string | null
  orden: string | null
  comprado: number
  recibido: number
  pendiente: number
}

export type IngresoPorValidar = {
  id: string
  referencia: string
  proveedor: string
  ordenes: string[]
  dejado_en: string | null
  dejado_por: string | null
  recogido_por: string | null
  documento_entrega: string | null
  lineas: LineaPorValidar[]
}

/**
 * Las compras que el conductor tiene que recoger, las que lleva en camino y las
 * que dejó en almacén la última semana. La base solo las da a quien recoge.
 */
export async function recojosDeCompras(): Promise<Recojo[]> {
  const db = await createClient()
  const { data, error } = await db.rpc('recojos_de_compras')
  if (error) throw new Error(`No se pudieron cargar los recojos: ${error.message}`)
  return (data ?? []).filter((r) => r.id).map((r) => ({
    id: r.id ?? '',
    referencia: r.referencia ?? '',
    proveedor: r.proveedor ?? '',
    proveedor_documento: r.proveedor_documento,
    proveedor_direccion: r.proveedor_direccion,
    proveedor_telefono: r.proveedor_telefono,
    proveedor_contacto: r.proveedor_contacto,
    fecha_estimada: r.fecha_estimada,
    estado: r.estado ?? 'POR_RECOGER',
    recogido_en: r.recogido_en,
    recogido_por: r.recogido_por,
    dejado_en: r.dejado_en,
    dejado_por: r.dejado_por,
    documento_entrega: r.documento_entrega,
    ingresado: Boolean(r.ingresado),
    lineas: (r.lineas ?? []) as unknown as LineaRecojo[],
  }))
}

/** Lo que el conductor (o Logística) dejó en almacén y Almacén todavía no ingresó al kardex. */
export async function ingresosPorValidar(): Promise<IngresoPorValidar[]> {
  const db = await createClient()
  const { data, error } = await db.rpc('ingresos_por_validar')
  if (error) throw new Error(`No se pudieron cargar los ingresos por validar: ${error.message}`)
  return (data ?? []).filter((r) => r.id).map((r) => ({
    id: r.id ?? '',
    referencia: r.referencia ?? '',
    proveedor: r.proveedor ?? '',
    ordenes: r.ordenes ?? [],
    dejado_en: r.dejado_en,
    dejado_por: r.dejado_por,
    recogido_por: r.recogido_por,
    documento_entrega: r.documento_entrega,
    lineas: (r.lineas ?? []) as unknown as LineaPorValidar[],
  }))
}

import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Un conteo físico del kardex (plan 2, entrega 2.3): cuánto contó Almacén, cuánto
 * decía el sistema en ese momento, la diferencia que quedó como ajuste, quién
 * contó y cuándo, y por qué. Sin precios.
 */
export type ConteoFisico = {
  id: string
  materialId: string
  codigo: string
  material: string
  unidad: string | null
  /** Lo que Almacén contó en el estante. */
  contado: number
  /** Lo que decía el kardex antes del conteo: lo contado menos el ajuste. */
  sistema: number
  /** Lo contado menos lo que decía el sistema: positivo sobró, negativo faltó. */
  diferencia: number
  motivo: string
  contoPor: string | null
  en: string
}

/**
 * Los últimos conteos físicos, el más nuevo primero; con `material`, solo los de
 * ese material. Los lee quien ve el kardex (`almacen.ver`, la política de
 * `conteos_inventario`).
 */
export async function conteosFisicos(opciones: { material?: string; limite?: number } = {}): Promise<ConteoFisico[]> {
  const db = await createClient()
  let consulta = db
    .from('conteos_inventario')
    .select(
      'id, material_id, cantidad_fisica, ajuste, motivo, registrado_en, material:materiales(codigo, descripcion, unidad:unidades_medida(codigo)), contador:usuarios!conteos_inventario_registrado_por_fkey(nombres, apellidos)',
    )
  if (opciones.material) consulta = consulta.eq('material_id', opciones.material)
  const { data, error } = await consulta.order('registrado_en', { ascending: false }).limit(opciones.limite ?? 30)
  if (error) throw new Error(`No se pudieron leer los conteos físicos: ${error.message}`)
  return (data ?? []).map((c) => {
    const contado = Number(c.cantidad_fisica)
    const diferencia = Number(c.ajuste)
    return {
      id: c.id,
      materialId: c.material_id,
      codigo: c.material?.codigo ?? '',
      material: c.material?.descripcion ?? 'Material',
      unidad: c.material?.unidad?.codigo ?? null,
      contado,
      // A tres decimales: 5.3 − 2.1 no es 3.1999999999999997.
      sistema: Math.round((contado - diferencia) * 1000) / 1000,
      diferencia,
      motivo: c.motivo,
      contoPor: [c.contador?.nombres, c.contador?.apellidos].filter(Boolean).join(' ') || null,
      en: c.registrado_en,
    }
  })
}

import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type MaterialDeOrden = {
  id: string
  orden_id: string
  plano_id: string | null
  numero_plano: string | null
  plano_nombre: string | null
  etapa_id: string | null
  etapa: string | null
  area: string | null
  material_id: string
  material_codigo: string
  material: string
  especificacion_tecnica: string | null
  unidad: string | null
  cantidad: number
  observacion: string | null
}

/** La lista de materiales que Diseño escribió para la orden. */
export async function listaDeMateriales(ordenId: string): Promise<MaterialDeOrden[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_ot_materiales')
    .select(
      'id, orden_id, plano_id, numero_plano, plano_nombre, etapa_id, etapa, area, material_id, material_codigo, material, especificacion_tecnica, unidad, cantidad, observacion',
    )
    .eq('orden_id', ordenId)
    .order('numero_plano', { nullsFirst: false })
    .order('material_codigo')
    .limit(500)

  if (error) throw new Error(`No se pudo leer la lista de materiales: ${error.message}`)
  return (data ?? []) as unknown as MaterialDeOrden[]
}

/** Lo que la pestaña carga de una vez: la lista y el catálogo para armarla. */
export async function materialesParaPantalla(ordenId: string) {
  const [materiales, catalogo] = await Promise.all([
    listaDeMateriales(ordenId),
    catalogoDeMateriales(ordenId),
  ])
  return { materiales, catalogo }
}

export type OpcionMaterial = {
  id: string
  codigo: string
  descripcion: string
  unidad: string | null
  especificacion: string | null
}

export type CatalogoMateriales = {
  materiales: OpcionMaterial[]
  planos: { id: string; numero_plano: string; nombre: string }[]
  etapas: { id: string; nombre: string; area: string | null }[]
}

/**
 * Lo que la pestaña necesita para armar la lista: el catálogo de materiales
 * —el chico de Diseño, sin stock ni almacén—, los planos y las etapas de esta
 * orden.
 */
export async function catalogoDeMateriales(ordenId: string): Promise<CatalogoMateriales> {
  const supabase = await createClient()

  const [materiales, planos, etapas] = await Promise.all([
    supabase
      .from('materiales')
      .select('id, codigo, descripcion, especificacion_tecnica, unidad:unidades_medida(codigo)')
      .eq('activo', true)
      .order('descripcion')
      .limit(1000),
    supabase
      .from('ot_planos')
      .select('id, numero_plano, nombre')
      .eq('orden_id', ordenId)
      .order('orden_secuencia'),
    supabase
      .from('ot_etapas')
      .select('id, orden_secuencia, etapa:etapas_catalogo(nombre, area:areas(nombre))')
      .eq('orden_id', ordenId)
      .order('orden_secuencia'),
  ])

  return {
    materiales: (materiales.data ?? []).map((m) => {
      const unidad = m.unidad as { codigo: string } | null
      return {
        id: m.id,
        codigo: m.codigo,
        descripcion: m.descripcion,
        especificacion: m.especificacion_tecnica,
        unidad: unidad?.codigo ?? null,
      }
    }),
    planos: planos.data ?? [],
    etapas: (etapas.data ?? []).map((e) => {
      const etapa = e.etapa as { nombre: string; area: { nombre: string } | null } | null
      return {
        id: e.id,
        nombre: etapa?.nombre ?? `Etapa ${e.orden_secuencia}`,
        area: etapa?.area?.nombre ?? null,
      }
    }),
  }
}

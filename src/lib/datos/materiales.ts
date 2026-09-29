import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type MaterialDelCatalogo = {
  id: string
  codigo: string
  codigo_almacen_origen: string | null
  unidad_pendiente: boolean
  descripcion: string
  especificacion_tecnica: string | null
  activo: boolean
  categoria: { id: string; nombre: string } | null
  unidad: { id: string; codigo: string; nombre: string } | null
}

const TAMANO_PAGINA = 50

/**
 * Catálogo de Diseño y Almacén, incluida la codificación original del Excel.
 */
export async function listarCatalogoMateriales(
  filtros: { busqueda?: string; inactivos?: boolean; pagina?: number } = {},
): Promise<{ materiales: MaterialDelCatalogo[]; total: number; tamanoPagina: number }> {
  const supabase = await createClient()

  const pagina = Math.max(1, Math.floor(filtros.pagina ?? 1))

  let consulta = supabase
    .from('materiales')
    .select(
      'id, codigo, codigo_almacen_origen, unidad_pendiente, descripcion, especificacion_tecnica, activo, categoria:categorias_material(id, nombre), unidad:unidades_medida(id, codigo, nombre)',
      { count: 'exact' },
    )
    .order('descripcion')
    .range((pagina - 1) * TAMANO_PAGINA, pagina * TAMANO_PAGINA - 1)

  if (!filtros.inactivos) consulta = consulta.eq('activo', true)

  const texto = filtros.busqueda?.trim()
  if (texto) consulta = consulta.or(`descripcion.ilike.%${texto}%,codigo.ilike.%${texto}%`)

  const { data, count, error } = await consulta
  if (error) throw new Error(`No se pudo leer el catálogo de materiales: ${error.message}`)
  return { materiales: (data ?? []) as unknown as MaterialDelCatalogo[], total: count ?? 0, tamanoPagina: TAMANO_PAGINA }
}

/** Las categorías y unidades para dar de alta un material. */
export async function catalogosDeMateriales() {
  const supabase = await createClient()

  const [categorias, unidades] = await Promise.all([
    supabase
      .from('categorias_material')
      .select('id, codigo, nombre')
      .eq('activo', true)
      .order('orden_visual')
      .order('nombre'),
    supabase.from('unidades_medida').select('id, codigo, nombre').eq('activo', true).order('codigo'),
  ])

  if (categorias.error || unidades.error) {
    throw new Error('No se pudieron cargar las categorías o unidades de materiales.')
  }

  return {
    categorias: categorias.data ?? [],
    unidades: unidades.data ?? [],
  }
}

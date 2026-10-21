import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import { paginaQueExiste } from '@/lib/dominio/paginas'

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
): Promise<{ materiales: MaterialDelCatalogo[]; total: number; tamanoPagina: number; pagina: number }> {
  const supabase = await createClient()

  const pagina = Math.max(1, Math.floor(filtros.pagina ?? 1))

  let consulta = supabase
    .from('materiales')
    .select(
      'id, codigo, codigo_almacen_origen, unidad_pendiente, descripcion, especificacion_tecnica, activo, categoria:categorias_material(id, nombre), unidad:unidades_medida(id, codigo, nombre)',
      { count: 'exact' },
    )
    .order('descripcion')
    // Desempate: hay materiales con la misma descripción (once esmeriles en
    // producción), y sin él cada página los ordenaba distinto; uno salía en dos
    // páginas y otro en ninguna (2026-10-20).
    .order('codigo')
    .order('id')
    .range((pagina - 1) * TAMANO_PAGINA, pagina * TAMANO_PAGINA - 1)

  if (!filtros.inactivos) consulta = consulta.eq('activo', true)

  for (const filtro of filtrosDeBusqueda(['descripcion', 'codigo'], filtros.busqueda)) consulta = consulta.or(filtro)

  const { data, count, error } = await consulta
  // Una página que ya no existe se cambia por la última que sí hay.
  const otra = await paginaQueExiste(pagina, TAMANO_PAGINA, { error, count, filas: data?.length ?? 0 }, async () => (await listarCatalogoMateriales({ ...filtros, pagina: 1 })).total)
  if (otra) return listarCatalogoMateriales({ ...filtros, pagina: otra })
  if (error) throw new Error(`No se pudo leer el catálogo de materiales: ${error.message}`)
  return { materiales: (data ?? []) as unknown as MaterialDelCatalogo[], total: count ?? 0, tamanoPagina: TAMANO_PAGINA, pagina }
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

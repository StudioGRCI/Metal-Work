import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type MaterialDelCatalogo = {
  id: string
  codigo: string
  descripcion: string
  especificacion_tecnica: string | null
  activo: boolean
  categoria: { id: string; nombre: string } | null
  unidad: { id: string; codigo: string; nombre: string } | null
}

/**
 * El catálogo chico de materiales: lo que Diseño elige al desglosar una orden.
 * Sin stock, sin costo, sin codificación de almacén: nombre, unidad y
 * especificación, que es lo que hace falta para decir qué lleva la unidad.
 */
export async function listarCatalogoMateriales(
  filtros: { busqueda?: string; inactivos?: boolean } = {},
): Promise<MaterialDelCatalogo[]> {
  const supabase = await createClient()

  let consulta = supabase
    .from('materiales')
    .select(
      'id, codigo, descripcion, especificacion_tecnica, activo, categoria:categorias_material(id, nombre), unidad:unidades_medida(id, codigo, nombre)',
    )
    .order('descripcion')
    .limit(500)

  if (!filtros.inactivos) consulta = consulta.eq('activo', true)

  const texto = filtros.busqueda?.trim()
  if (texto) consulta = consulta.or(`descripcion.ilike.%${texto}%,codigo.ilike.%${texto}%`)

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo leer el catálogo de materiales: ${error.message}`)
  return (data ?? []) as unknown as MaterialDelCatalogo[]
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

  return {
    categorias: categorias.data ?? [],
    unidades: unidades.data ?? [],
  }
}

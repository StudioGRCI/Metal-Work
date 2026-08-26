import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type MaterialCatalogo = {
  id: string
  codigo: string
  codigo_almacen: string | null
  descripcion: string
  criticidad: 'A' | 'B' | 'C' | null
  ubicacion: string | null
  costo_reposicion: number | null
  controla_lote: boolean
  controla_serie: boolean
  controla_caducidad: boolean
  es_critico: boolean
  activo: boolean
  categoria: { nombre: string } | null
  unidad: { codigo: string } | null
}

/** El maestro de materiales con su código de almacén y su criticidad. */
export async function listarMateriales(filtros: { busqueda?: string; sinCodigo?: boolean } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('materiales')
    .select(
      'id, codigo, codigo_almacen, descripcion, criticidad, ubicacion, costo_reposicion, controla_lote, controla_serie, controla_caducidad, es_critico, activo, categoria:categorias_material(nombre), unidad:unidades_medida!materiales_unidad_medida_id_fkey(codigo)',
    )
    .eq('activo', true)
    .order('descripcion')
    .limit(300)

  if (filtros.busqueda) {
    const b = filtros.busqueda.trim()
    consulta = consulta.or(`descripcion.ilike.%${b}%,codigo.ilike.%${b}%,codigo_almacen.ilike.%${b}%`)
  }
  if (filtros.sinCodigo) consulta = consulta.is('codigo_almacen', null)

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo leer el maestro de materiales: ${error.message}`)
  return (data ?? []) as unknown as MaterialCatalogo[]
}

export type CatalogoCodificacion = {
  familias: { codigo: string; nombre: string; agrupa: string | null }[]
  subfamilias: { familia_codigo: string; codigo: string; nombre: string }[]
  materiales: { codigo: string; nombre: string }[]
  tipos: { subfamilia_codigo: string; codigo: string; nombre: string }[]
}

/** Los cuatro catálogos del proyecto de codificación, para armar el código. */
export async function catalogoCodificacion(): Promise<CatalogoCodificacion> {
  const supabase = await createClient()

  const [familias, subfamilias, materiales, tipos] = await Promise.all([
    supabase.from('codificacion_familias').select('codigo, nombre, agrupa').eq('activo', true).order('orden_visual'),
    supabase.from('codificacion_subfamilias').select('familia_codigo, codigo, nombre').order('codigo'),
    supabase.from('codificacion_materiales').select('codigo, nombre').order('codigo'),
    supabase.from('codificacion_tipos').select('subfamilia_codigo, codigo, nombre').order('codigo'),
  ])

  const primero = [familias, subfamilias, materiales, tipos].find((r) => r.error)
  if (primero?.error) throw new Error(`No se pudo leer la codificación: ${primero.error.message}`)

  return {
    familias: familias.data ?? [],
    subfamilias: subfamilias.data ?? [],
    materiales: materiales.data ?? [],
    tipos: tipos.data ?? [],
  } as CatalogoCodificacion
}

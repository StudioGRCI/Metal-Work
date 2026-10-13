import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type LineaRequerimiento = {
  item: number
  descripcion: string
  cantidad: number
  unidad: string
  categoria: string
}

/** Un requerimiento en el listado: número, quién lo necesita, para qué y qué se pide. */
export type RequerimientoListado = {
  id: string
  numero: string
  area: string
  codigo_interno: string
  justificacion: string
  fecha_requerida: string | null
  estado: string
  motivo_anulacion: string | null
  creado_en: string
  lineas: LineaRequerimiento[]
}

export type OpcionCatalogo = { id: string; codigo: string; nombre: string }

export async function cargarRequerimientos(): Promise<RequerimientoListado[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('requerimientos')
    .select(
      'id, numero, codigo_interno, justificacion, fecha_requerida, estado, motivo_anulacion, creado_en, area:areas(nombre), lineas:requerimiento_lineas(item, descripcion, cantidad, unidad:unidades_medida(codigo), categoria:categorias_material(nombre))',
    )
    .order('creado_en', { ascending: false })
    .limit(300)
  if (error) throw new Error(`No se pudieron leer los requerimientos: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id,
    numero: r.numero,
    area: r.area?.nombre ?? '—',
    codigo_interno: r.codigo_interno,
    justificacion: r.justificacion,
    fecha_requerida: r.fecha_requerida,
    estado: r.estado,
    motivo_anulacion: r.motivo_anulacion,
    creado_en: r.creado_en,
    lineas: (r.lineas ?? [])
      .map((l) => ({
        item: l.item,
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad),
        unidad: l.unidad?.codigo ?? '',
        categoria: l.categoria?.nombre ?? '',
      }))
      .sort((a, b) => a.item - b.item),
  }))
}

/** Lo que el formulario del requerimiento ofrece para elegir: áreas, unidades y categorías. */
export async function catalogosDelRequerimiento() {
  const supabase = await createClient()
  const [areas, unidades, categorias] = await Promise.all([
    supabase.from('areas').select('id, codigo, nombre').eq('activo', true).order('nombre'),
    supabase.from('unidades_medida').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase
      .from('categorias_material')
      .select('id, codigo, nombre')
      .eq('activo', true)
      .is('categoria_padre_id', null)
      .neq('codigo', 'ALM_POR_CLASIFICAR')
      .order('nombre'),
  ])
  if (areas.error || unidades.error || categorias.error) {
    throw new Error('No se pudieron leer las áreas, unidades o categorías para el requerimiento.')
  }
  // El catálogo de Almacén (ALM_…) es el que usa el kardex. Las categorías
  // sueltas de la semilla inicial repiten las mismas familias con otro nombre:
  // si las de Almacén existen, se ofrecen solo esas para no clasificar doble.
  const todas = categorias.data ?? []
  const deAlmacen = todas.filter((c) => c.codigo.startsWith('ALM_'))
  return {
    areas: areas.data ?? [],
    unidades: unidades.data ?? [],
    categorias: deAlmacen.length > 0 ? deAlmacen : todas,
  }
}

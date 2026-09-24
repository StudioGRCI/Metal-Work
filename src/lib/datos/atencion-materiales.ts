import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas, Vistas } from '@/types/database'

export type LineaAtencionMaterial = Vistas<'v_atencion_materiales'>
export type CompraMaterialPendiente = Vistas<'v_orden_compra_material_pendiente'>
export type ExistenciaMaterial = Vistas<'v_existencias_materiales'>
export type ResponsableMaterial = Pick<Tablas<'usuarios'>, 'id' | 'nombres' | 'apellidos' | 'area_id'>
export type AreaMaterial = Pick<Tablas<'areas'>, 'id' | 'codigo' | 'nombre'>

export async function cargarAtencionMateriales(permisos: {
  verRequerimientos: boolean
  verExistencias: boolean
  recibir: boolean
  despachar: boolean
}) {
  const supabase = await createClient()
  const [atencion, existencias, compras, areas] = await Promise.all([
    permisos.verRequerimientos
      ? supabase
          .from('v_atencion_materiales')
          .select('requerimiento_id, detalle_id, orden_id, numero_ot, area_destino, ot_material_id, numero_plano, plano, material_id, material_codigo, material, unidad, cantidad_solicitada, cantidad_comprada, cantidad_recibida, cantidad_despachada, estado, responsables, solicitado_por, creado_en')
          .order('creado_en', { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
    permisos.verExistencias
      ? supabase
          .from('v_existencias_materiales')
          .select('material_id, codigo, descripcion, unidad, existencia')
          .order('descripcion')
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    permisos.recibir
      ? supabase
          .from('v_orden_compra_material_pendiente')
          .select('id, requerimiento_id, requerimiento_detalle_id, proveedor, referencia, fecha_estimada, cantidad_comprada, cantidad_recibida, cantidad_pendiente')
          .gt('cantidad_pendiente', 0)
          .order('fecha_estimada', { nullsFirst: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
    permisos.despachar
      ? supabase.from('areas').select('id, codigo, nombre').in('codigo', ['MTZ', 'PRD', 'ACB']).eq('activo', true)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (atencion.error) throw new Error(`No se pudo cargar el avance de materiales: ${atencion.error.message}`)
  if (existencias.error) throw new Error(`No se pudieron cargar las existencias: ${existencias.error.message}`)
  if (compras.error) throw new Error(`No se pudieron cargar las compras pendientes: ${compras.error.message}`)
  if (areas.error) throw new Error(`No se pudieron cargar las áreas receptoras: ${areas.error.message}`)

  const idsArea = (areas.data ?? []).map((area) => area.id)
  const personas = permisos.despachar && idsArea.length > 0
    ? await supabase
        .from('usuarios')
        .select('id, nombres, apellidos, area_id')
        .in('area_id', idsArea)
        .eq('activo', true)
        .order('nombres')
        .limit(300)
    : { data: [], error: null }

  if (personas.error) throw new Error(`No se pudieron cargar las personas que reciben materiales: ${personas.error.message}`)

  return {
    lineas: atencion.data ?? [],
    existencias: existencias.data ?? [],
    compras: compras.data ?? [],
    areas: areas.data ?? [],
    responsables: personas.data ?? [],
  }
}

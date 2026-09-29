import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas, Vistas } from '@/types/database'

export type LineaAtencionMaterial = Vistas<'v_atencion_materiales'> & {
  aprobacion_diseno: string
  decision_almacen: string
}
export type CompraMaterialPendiente = Vistas<'v_orden_compra_material_pendiente'> & {
  entregado_almacen_en: string | null
  precio_unitario: number | null
}
export type ExistenciaMaterial = Vistas<'v_existencias_materiales'>
export type MaterialParaConteo = { id: string; descripcion: string; codigo: string; unidad: string | null }
export type ResponsableMaterial = Pick<Tablas<'usuarios'>, 'id' | 'nombres' | 'apellidos' | 'area_id'>
export type AreaMaterial = Pick<Tablas<'areas'>, 'id' | 'codigo' | 'nombre'>

export async function cargarAtencionMateriales(permisos: {
  verRequerimientos: boolean
  verExistencias: boolean
  verCompras: boolean
  crearCompra: boolean
  recibir: boolean
  despachar: boolean
}) {
  const supabase = await createClient()
  const [atencion, existencias, compras, areas, catalogo] = await Promise.all([
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
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    permisos.verCompras || permisos.recibir || permisos.crearCompra
      ? supabase
          .from('v_orden_compra_material_pendiente')
          .select('id, requerimiento_id, requerimiento_detalle_id, proveedor, referencia, fecha_estimada, cantidad_comprada, cantidad_recibida, cantidad_pendiente, orden_compra_id')
          .order('fecha_estimada', { nullsFirst: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
    permisos.despachar
      ? supabase.from('areas').select('id, codigo, nombre').in('codigo', ['MTZ', 'PRD', 'ACB']).eq('activo', true)
      : Promise.resolve({ data: [], error: null }),
    permisos.verExistencias
      ? supabase.from('materiales').select('id, descripcion, codigo, unidad:unidades_medida(codigo)')
          .eq('activo', true).order('descripcion').limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (atencion.error) throw new Error(`No se pudo cargar el avance de materiales: ${atencion.error.message}`)
  if (existencias.error) throw new Error(`No se pudieron cargar las existencias: ${existencias.error.message}`)
  if (compras.error) throw new Error(`No se pudieron cargar las compras pendientes: ${compras.error.message}`)
  if (areas.error) throw new Error(`No se pudieron cargar las áreas receptoras: ${areas.error.message}`)
  if (catalogo.error) throw new Error(`No se pudo cargar el catálogo para el conteo: ${catalogo.error.message}`)

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

  const idsDetalle = (atencion.data ?? []).map((linea) => linea.detalle_id).filter((id): id is string => Boolean(id))
  const decisiones = idsDetalle.length > 0
    ? await supabase.from('requerimiento_material_detalles')
        .select('id, aprobacion_diseno, decision_almacen').in('id', idsDetalle)
    : { data: [], error: null }
  if (decisiones.error) throw new Error(`No se pudieron leer las revisiones de materiales: ${decisiones.error.message}`)
  const porDetalle = new Map((decisiones.data ?? []).map((d) => [d.id, d]))
  if (idsDetalle.some((id) => !porDetalle.has(id))) {
    throw new Error('Faltan revisiones de materiales. Recarga o consulta con Administración.')
  }
  const idsCompra = (compras.data ?? []).map((compra) => compra.orden_compra_id).filter((id): id is string => Boolean(id))
  const idsLineaCompra = (compras.data ?? []).map((compra) => compra.id).filter((id): id is string => Boolean(id))
  const [entregas, precios] = await Promise.all([
    idsCompra.length > 0
      ? supabase.from('ordenes_compra_materiales').select('id, entregado_almacen_en').in('id', idsCompra)
      : Promise.resolve({ data: [], error: null }),
    idsLineaCompra.length > 0
      ? supabase.from('orden_compra_material_detalles').select('id, precio_unitario').in('id', idsLineaCompra)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (entregas.error || precios.error) throw new Error('No se pudieron leer la entrega o los precios de compra.')
  const entregaPorCompra = new Map((entregas.data ?? []).map((entrega) => [entrega.id, entrega.entregado_almacen_en]))
  const precioPorLinea = new Map((precios.data ?? []).map((precio) => [precio.id, precio.precio_unitario]))
  return {
    lineas: (atencion.data ?? []).map((linea) => ({
      ...linea,
      aprobacion_diseno: porDetalle.get(linea.detalle_id ?? '')?.aprobacion_diseno ?? 'PROPUESTO',
      decision_almacen: porDetalle.get(linea.detalle_id ?? '')?.decision_almacen ?? 'PENDIENTE',
    })),
    existencias: existencias.data ?? [],
    catalogoAlmacen: (catalogo.data ?? []).map((m) => ({
      id: m.id, descripcion: m.descripcion, codigo: m.codigo,
      unidad: Array.isArray(m.unidad) ? m.unidad[0]?.codigo ?? null : m.unidad?.codigo ?? null,
    })),
    compras: (compras.data ?? []).map((compra) => ({
      ...compra,
      entregado_almacen_en: entregaPorCompra.get(compra.orden_compra_id ?? '') ?? null,
      precio_unitario: precioPorLinea.get(compra.id ?? '') ?? null,
    })),
    areas: areas.data ?? [],
    responsables: personas.data ?? [],
  }
}

import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Enums } from '@/types/database'

export type TipoMovimiento = Enums<'tipo_movimiento_almacen'>
export type EstadoMovimiento = Enums<'estado_movimiento_almacen'>

export async function listarMovimientos(filtros: { tipo?: string; estado?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('movimientos_almacen')
    .select('id, numero, tipo, estado, fecha, total_valorizado, documento_referencia, motivo, almacen:almacenes!movimientos_almacen_almacen_id_fkey(nombre), orden:ordenes_trabajo(id, numero), detalle:movimiento_detalle(count)')

  if (filtros.tipo) consulta = consulta.eq('tipo', filtros.tipo as TipoMovimiento)
  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado as EstadoMovimiento)

  const { data, error } = await consulta
    .order('fecha', { ascending: false })
    .order('numero', { ascending: false })
    .limit(150)

  if (error) throw new Error(`No se pudieron listar los movimientos: ${error.message}`)
  return data ?? []
}

export async function obtenerMovimiento(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('movimientos_almacen')
    .select('*, almacen:almacenes!movimientos_almacen_almacen_id_fkey(id, nombre), destino:almacenes!movimientos_almacen_almacen_destino_id_fkey(nombre), orden:ordenes_trabajo(id, numero, descripcion), proveedor:proveedores(razon_social), responsable:usuarios!movimientos_almacen_responsable_id_fkey(nombres, apellidos)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar el movimiento: ${error.message}`)
  return data
}

export async function lineasDeMovimiento(movimientoId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('movimiento_detalle')
    .select('id, cantidad, costo_unitario, costo_total, observaciones, material:materiales!inner(id, codigo, descripcion, costo_promedio, unidad:unidades_medida!inner(codigo))')
    .eq('movimiento_id', movimientoId)
    .order('creado_en')

  if (error) throw new Error(`No se pudieron cargar las líneas: ${error.message}`)
  return data ?? []
}

/** Materiales, almacenes y órdenes abiertas para los formularios de almacén. */
export async function catalogosAlmacen() {
  const supabase = await createClient()

  const [materiales, almacenes, ordenes, proveedores] = await Promise.all([
    supabase
      .from('materiales')
      .select('id, codigo, descripcion, costo_promedio, unidad:unidades_medida!inner(codigo)')
      .eq('activo', true)
      .order('descripcion')
      .limit(500),
    supabase.from('almacenes').select('id, nombre, sede_id').eq('activo', true).order('nombre'),
    supabase
      .from('ot_resumen')
      .select('id, numero, cliente, placa')
      .in('estado', ['APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA', 'CONTROL_CALIDAD'])
      .order('numero'),
    supabase.from('proveedores').select('id, razon_social').eq('activo', true).order('razon_social'),
  ])

  return {
    materiales: materiales.data ?? [],
    almacenes: almacenes.data ?? [],
    ordenes: (ordenes.data ?? [])
      .filter((o) => o.id && o.numero)
      .map((o) => ({ id: o.id as string, numero: o.numero as string, cliente: o.cliente, placa: o.placa })),
    proveedores: proveedores.data ?? [],
  }
}

export async function listarRequerimientos(filtros: { estado?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('requerimientos')
    .select('id, numero, fecha, fecha_requerida, estado, prioridad, observaciones, orden:ordenes_trabajo(id, numero, descripcion), solicitante:usuarios!requerimientos_solicitante_id_fkey(nombres, apellidos), detalle:requerimiento_detalle(count)')

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado as Enums<'estado_requerimiento'>)

  const { data, error } = await consulta.order('fecha', { ascending: false }).limit(150)
  if (error) throw new Error(`No se pudieron listar los requerimientos: ${error.message}`)

  return data ?? []
}

export async function obtenerRequerimiento(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('requerimientos')
    .select('*, orden:ordenes_trabajo(id, numero, descripcion), almacen:almacenes(nombre), solicitante:usuarios!requerimientos_solicitante_id_fkey(nombres, apellidos), aprobador:usuarios!requerimientos_aprobador_id_fkey(nombres, apellidos)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar el requerimiento: ${error.message}`)
  return data
}

export async function lineasDeRequerimiento(requerimientoId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('requerimiento_detalle')
    .select('id, cantidad_solicitada, cantidad_aprobada, cantidad_atendida, cantidad_reservada, especificacion, material:materiales!inner(id, codigo, descripcion, unidad:unidades_medida!inner(codigo))')
    .eq('requerimiento_id', requerimientoId)
    .order('creado_en')

  if (error) throw new Error(`No se pudieron cargar las líneas: ${error.message}`)
  return data ?? []
}

export async function listarOrdenesCompra(filtros: { estado?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('ordenes_compra')
    .select('id, numero, fecha, fecha_entrega_esperada, estado, moneda, total, proveedor:proveedores!inner(razon_social), detalle:orden_compra_detalle(count)')

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado as Enums<'estado_orden_compra'>)

  const { data, error } = await consulta.order('fecha', { ascending: false }).limit(150)
  if (error) throw new Error(`No se pudieron listar las órdenes de compra: ${error.message}`)

  return data ?? []
}

export async function listarProveedores() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('proveedores')
    .select('id, numero_documento, razon_social, contacto_nombre, telefono, correo, condicion_pago, calificacion, activo')
    .eq('activo', true)
    .order('razon_social')

  if (error) throw new Error(`No se pudieron listar los proveedores: ${error.message}`)
  return data ?? []
}

import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Enums, Tablas } from '@/types/database'

export type Cliente = Tablas<'clientes'>
export type Unidad = Tablas<'unidades'>

const POR_PAGINA = 25

export async function listarClientes(filtros: { busqueda?: string; pagina?: number } = {}) {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * POR_PAGINA

  let consulta = supabase
    .from('clientes')
    .select('id, tipo_documento, numero_documento, razon_social, nombre_comercial, telefono, correo, distrito, provincia, activo, unidades(count), ordenes_trabajo(count)', { count: 'exact' })
    .eq('activo', true)

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(`razon_social.ilike.%${t}%,nombre_comercial.ilike.%${t}%,numero_documento.ilike.%${t}%`)
  }

  const { data, error, count } = await consulta
    .order('razon_social')
    .range(desde, desde + POR_PAGINA - 1)

  if (error) throw new Error(`No se pudieron listar los clientes: ${error.message}`)

  return {
    clientes: data ?? [],
    total: count ?? 0,
    pagina,
    paginas: Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA)),
  }
}

export async function obtenerCliente(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select('*, vendedor:usuarios!clientes_vendedor_id_fkey(id, nombres, apellidos)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar el cliente: ${error.message}`)
  return data
}

export async function listarUnidades(filtros: { clienteId?: string; busqueda?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('unidades')
    .select('id, placa, tipo_vehiculo, marca, modelo, anio, numero_chasis, capacidad_m3, capacidad_toneladas, activo, cliente:clientes!inner(id, razon_social), tipo_carroceria:tipos_carroceria(nombre)')
    .eq('activo', true)

  if (filtros.clienteId) consulta = consulta.eq('cliente_id', filtros.clienteId)

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(`placa.ilike.%${t}%,marca.ilike.%${t}%,modelo.ilike.%${t}%,numero_chasis.ilike.%${t}%`)
  }

  const { data, error } = await consulta.order('placa').limit(300)
  if (error) throw new Error(`No se pudieron listar las unidades: ${error.message}`)

  return data ?? []
}

export async function contactosDeCliente(clienteId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('contactos_cliente')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('es_principal', { ascending: false })

  return data ?? []
}

export async function ordenesDeCliente(clienteId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('ot_resumen')
    .select('id, numero, estado, descripcion, placa, avance_porcentaje, fecha_registro')
    .eq('cliente_id', clienteId)
    .order('fecha_registro', { ascending: false })
    .limit(50)

  return data ?? []
}

// ---------------------------------------------------------------- cotizaciones

export type EstadoCotizacion = Enums<'estado_cotizacion'>

export async function listarCotizaciones(filtros: { estado?: string; busqueda?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('cotizaciones')
    .select('id, numero, fecha_emision, fecha_vencimiento, estado, moneda, total, cliente:clientes!inner(razon_social), unidad:unidades!cotizaciones_unidad_id_fkey(placa), tipo_carroceria:tipos_carroceria(nombre)')

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado as EstadoCotizacion)

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.ilike('numero', `%${t}%`)
  }

  const { data, error } = await consulta
    .order('fecha_emision', { ascending: false })
    .order('numero', { ascending: false })
    .limit(200)

  if (error) throw new Error(`No se pudieron listar las cotizaciones: ${error.message}`)
  return data ?? []
}

export async function obtenerCotizacion(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizaciones')
    .select('*, cliente:clientes!inner(id, razon_social, numero_documento), unidad:unidades!cotizaciones_unidad_id_fkey(id, placa, marca, modelo), tipo_carroceria:tipos_carroceria(id, nombre), vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombres, apellidos)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar la cotización: ${error.message}`)
  return data
}

export async function partidasDeCotizacion(cotizacionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizacion_partidas')
    .select('*')
    .eq('cotizacion_id', cotizacionId)
    .order('orden_secuencia')

  if (error) throw new Error(`No se pudieron cargar las partidas: ${error.message}`)
  return data ?? []
}

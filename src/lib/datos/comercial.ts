import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas } from '@/types/database'

export type Cliente = Tablas<'clientes'>
export type Unidad = Tablas<'unidades'>

export const CLIENTES_POR_PAGINA = 25

export async function listarClientes(filtros: { busqueda?: string; pagina?: number } = {}) {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * CLIENTES_POR_PAGINA

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
    .range(desde, desde + CLIENTES_POR_PAGINA - 1)

  if (error) throw new Error(`No se pudieron listar los clientes: ${error.message}`)

  return {
    clientes: data ?? [],
    total: count ?? 0,
    pagina,
    paginas: Math.max(1, Math.ceil((count ?? 0) / CLIENTES_POR_PAGINA)),
  }
}

export async function obtenerCliente(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select('*, vendedor:usuarios!clientes_vendedor_id_fkey(id, puesto)')
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

import 'server-only'

import { conAvanceDelCodigo } from '@/lib/datos/ordenes'
import { createClient } from '@/lib/supabase/server'
import type { Tablas } from '@/types/database'
import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import { paginaQueExiste } from '@/lib/dominio/paginas'

export type Cliente = Tablas<'clientes'>
export type Unidad = Tablas<'unidades'>

export const CLIENTES_POR_PAGINA = 25

export async function listarClientes(filtros: { busqueda?: string; pagina?: number; incluirInactivos?: boolean } = {}) {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * CLIENTES_POR_PAGINA

  let consulta = supabase
    .from('clientes')
    .select('id, tipo_documento, numero_documento, razon_social, nombre_comercial, telefono, correo, distrito, provincia, activo, unidades(count), ordenes_trabajo(count)', { count: 'exact' })
    .order('razon_social')
    // Desempate entre razones sociales iguales: sin él, al pasar de página uno
    // podía salir dos veces y otro ninguna, como pasó en Materiales.
    .order('id')

  if (!filtros.incluirInactivos) consulta = consulta.eq('activo', true)

  for (const filtro of filtrosDeBusqueda(['razon_social', 'nombre_comercial', 'numero_documento'], filtros.busqueda)) consulta = consulta.or(filtro)

  const { data, error, count } = await consulta
    .range(desde, desde + CLIENTES_POR_PAGINA - 1)

  // Una página que ya no existe se cambia por la última que sí hay.
  const otra = await paginaQueExiste(pagina, CLIENTES_POR_PAGINA, { error, count, filas: data?.length ?? 0 }, async () => (await listarClientes({ ...filtros, pagina: 1 })).total)
  if (otra) return listarClientes({ ...filtros, pagina: otra })
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

export async function listarUnidades(filtros: { clienteId?: string; busqueda?: string; incluirInactivas?: boolean } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('unidades')
    // Sin `!inner`: una unidad que registró el taller no tiene cliente, y a quien
    // entra con `produccion.ver` el RLS le esconde el cliente; con `!inner` las dos
    // desaparecían de la lista (la misma trampa que en `ordenes.ts`).
    .select('id, cliente_id, placa, codigo_interno, numero_fmi, tipo_vehiculo, marca, modelo, anio, numero_chasis, numero_motor, color, capacidad_m3, capacidad_toneladas, observaciones, activo, cliente:clientes(id, razon_social), tipo_carroceria:tipos_carroceria(nombre)')

  if (!filtros.incluirInactivas) consulta = consulta.eq('activo', true)

  if (filtros.clienteId) consulta = consulta.eq('cliente_id', filtros.clienteId)

  for (const filtro of filtrosDeBusqueda(['placa', 'codigo_interno', 'numero_fmi', 'marca', 'modelo', 'numero_chasis'], filtros.busqueda)) consulta = consulta.or(filtro)

  const { data, error } = await consulta.order('placa').limit(300)
  if (error) throw new Error(`No se pudieron listar las unidades: ${error.message}`)

  return data ?? []
}

export async function contactosDeCliente(clienteId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('contactos_cliente')
    .select('id, nombre, cargo, telefono, correo, es_principal')
    .eq('cliente_id', clienteId)
    .order('es_principal', { ascending: false })

  if (error) throw new Error(`No se pudieron cargar los contactos del cliente: ${error.message}`)
  return data ?? []
}

const ORDENES_DE_CLIENTE = 50

/**
 * Las órdenes más recientes del cliente, con cuántas tiene en total: la ficha
 * muestra las últimas y dice si hay más, en vez de dar las cincuenta por todas.
 */
export async function ordenesDeCliente(clienteId: string) {
  const supabase = await createClient()

  const { data, error, count } = await supabase
    .from('ot_resumen')
    .select('id, numero, estado, descripcion, placa, avance_porcentaje, fecha_registro', { count: 'exact' })
    .eq('cliente_id', clienteId)
    .order('fecha_registro', { ascending: false })
    .limit(ORDENES_DE_CLIENTE)

  if (error) throw new Error(`No se pudieron cargar las órdenes del cliente: ${error.message}`)
  const ordenes = await conAvanceDelCodigo(data ?? [])
  return { ordenes, total: count ?? ordenes.length }
}

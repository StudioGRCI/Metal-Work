import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas } from '@/types/database'

export type Proveedor = Pick<
  Tablas<'proveedores'>,
  | 'id'
  | 'tipo_documento'
  | 'numero_documento'
  | 'razon_social'
  | 'nombre_comercial'
  | 'rubro'
  | 'contacto'
  | 'telefono'
  | 'correo'
  | 'direccion'
  | 'condicion_pago'
  | 'dias_credito'
  | 'observaciones'
  | 'activo'
>

/** Lo que el formulario de la orden de compra necesita para elegir y llenar el pago. */
export type ProveedorParaCompra = Pick<
  Tablas<'proveedores'>,
  'id' | 'razon_social' | 'numero_documento' | 'condicion_pago' | 'dias_credito'
>

export const PROVEEDORES_POR_PAGINA = 25

const COLUMNAS =
  'id, tipo_documento, numero_documento, razon_social, nombre_comercial, rubro, contacto, telefono, correo, direccion, condicion_pago, dias_credito, observaciones, activo'

export async function listarProveedores(filtros: { busqueda?: string; pagina?: number; incluirInactivos?: boolean } = {}) {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * PROVEEDORES_POR_PAGINA

  let consulta = supabase.from('proveedores').select(COLUMNAS, { count: 'exact' }).order('razon_social')

  if (!filtros.incluirInactivos) consulta = consulta.eq('activo', true)

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(
      `razon_social.ilike.%${t}%,nombre_comercial.ilike.%${t}%,numero_documento.ilike.%${t}%,rubro.ilike.%${t}%`,
    )
  }

  const { data, error, count } = await consulta.range(desde, desde + PROVEEDORES_POR_PAGINA - 1)
  if (error) throw new Error(`No se pudieron listar los proveedores: ${error.message}`)

  return {
    proveedores: (data ?? []) as Proveedor[],
    total: count ?? 0,
    pagina,
    paginas: Math.max(1, Math.ceil((count ?? 0) / PROVEEDORES_POR_PAGINA)),
  }
}

/**
 * Los proveedores activos, para el desplegable de la orden de compra. Un
 * proveedor dado de baja no aparece: la base tampoco deja comprarle.
 */
export async function proveedoresParaCompra(): Promise<ProveedorParaCompra[]> {
  const supabase = await createClient()
  const lista: ProveedorParaCompra[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase
      .from('proveedores')
      .select('id, razon_social, numero_documento, condicion_pago, dias_credito')
      .eq('activo', true)
      .order('razon_social')
      .order('id')
      .range(desde, desde + 999)
    if (error) throw new Error(`No se pudo cargar el padrón de proveedores: ${error.message}`)
    lista.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return lista
}

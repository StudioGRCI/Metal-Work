import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas } from '@/types/database'
import { filtroDePalabra, palabrasDeBusqueda } from '@/lib/dominio/busqueda'

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
  | 'direccion_recojo'
  | 'condicion_pago'
  | 'dias_credito'
  | 'observaciones'
  | 'activo'
> & {
  /** Solo las activas. Llega vacío para quien no tiene `proveedores.ver_cuentas`: lo esconde el RLS. */
  cuentas: CuentaProveedor[]
}

export type CuentaProveedor = Pick<Tablas<'proveedor_cuentas'>, 'id' | 'banco' | 'numero_cuenta' | 'titular' | 'moneda'>

/** Lo que el formulario de la orden de compra necesita para elegir y llenar el pago. */
export type ProveedorParaCompra = Pick<
  Tablas<'proveedores'>,
  'id' | 'razon_social' | 'numero_documento' | 'condicion_pago' | 'dias_credito'
>

export const PROVEEDORES_POR_PAGINA = 25

const COLUMNAS =
  'id, tipo_documento, numero_documento, razon_social, nombre_comercial, rubro, contacto, telefono, correo, direccion, direccion_recojo, condicion_pago, dias_credito, observaciones, activo, cuentas:proveedor_cuentas(id, banco, numero_cuenta, titular, moneda, activo)'

export async function listarProveedores(filtros: { busqueda?: string; pagina?: number; incluirInactivos?: boolean } = {}) {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * PROVEEDORES_POR_PAGINA

  let consulta = supabase.from('proveedores').select(COLUMNAS, { count: 'exact' }).order('razon_social')

  if (!filtros.incluirInactivos) consulta = consulta.eq('activo', true)

  for (const palabra of palabrasDeBusqueda(filtros.busqueda)) {
    consulta = consulta.or(filtroDePalabra(['razon_social', 'nombre_comercial', 'numero_documento', 'rubro'], palabra))
  }

  const { data, error, count } = await consulta.range(desde, desde + PROVEEDORES_POR_PAGINA - 1)
  if (error) throw new Error(`No se pudieron listar los proveedores: ${error.message}`)

  return {
    proveedores: (data ?? []).map(({ cuentas, ...p }) => ({
      ...p,
      cuentas: (cuentas ?? [])
        .filter((c) => c.activo)
        .map(({ id, banco, numero_cuenta, titular, moneda }) => ({ id, banco, numero_cuenta, titular, moneda })),
    })) as Proveedor[],
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

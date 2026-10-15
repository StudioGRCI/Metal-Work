import 'server-only'

import { COLUMNAS_DETRACCION, cargarTiposDetraccion, detraccionDeFila } from '@/lib/datos/logistica'
import type { DetraccionDeServicio } from '@/lib/dominio/detraccion'
import { BUCKET_FACTURAS_VENTA, BUCKET_PAGOS_SERVICIO } from '@/lib/dominio/finanzas'
import { createClient } from '@/lib/supabase/server'
import type { Database, Tablas, Vistas } from '@/types/database'

type Funciones<T extends keyof Database['public']['Functions']> = Database['public']['Functions'][T]

/**
 * La OT pasa por Contabilidad (migración 20261015120000): Administración envía
 * la cotización aprobada con su OT, Contabilidad anexa la factura y la envía a
 * Tesorería, donde entra a las cuentas por cobrar. Tesorería paga además las
 * órdenes de servicio aprobadas.
 */

type FacturaFila = Pick<
  Tablas<'facturas_venta'>,
  | 'id' | 'cotizacion_pdf_id' | 'numero' | 'fecha_emision' | 'fecha_vencimiento' | 'moneda' | 'total' | 'concepto'
  | 'estado' | 'ruta_storage' | 'nombre_archivo' | 'enviada_en' | 'anulada_en' | 'motivo_anulacion' | 'creado_en'
>
export type FacturaVenta = FacturaFila & { url: string | null }

type FilaBandeja = Funciones<'facturacion_bandeja'>['Returns'][number]
export type CotizacionPorFacturar = FilaBandeja & { url: string | null; facturas: FacturaVenta[] }

/** Enlaces firmados de un bucket, por ruta. Sin enlace la fila igual se muestra: se ve qué hay aunque no se abra. */
export async function enlaces(bucket: string, rutas: (string | null)[], segundos = 600): Promise<Map<string, string>> {
  const unicas = [...new Set(rutas.filter((r): r is string => Boolean(r)))]
  const mapa = new Map<string, string>()
  if (unicas.length === 0) return mapa
  const supabase = await createClient()
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unicas, segundos)
  for (const e of data ?? []) if (e.path && e.signedUrl) mapa.set(e.path, e.signedUrl)
  return mapa
}

/**
 * Lo que Contabilidad tiene por facturar: cada cotización que le envió
 * Administración, con el cliente, la OT, el archivo aprobado y las facturas
 * que ya le anexó. Primero las que no tienen ninguna factura vigente.
 */
export async function bandejaDeFacturacion(): Promise<CotizacionPorFacturar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('facturacion_bandeja')
  if (error) throw new Error(`No se pudo leer lo que hay por facturar: ${error.message}`)
  const filas = data ?? []
  if (filas.length === 0) return []

  const ids = filas.flatMap((f) => (f.cotizacion_id ? [f.cotizacion_id] : []))
  const { data: facturas, error: errorFacturas } = await supabase
    .from('facturas_venta')
    .select('id, cotizacion_pdf_id, numero, fecha_emision, fecha_vencimiento, moneda, total, concepto, estado, ruta_storage, nombre_archivo, enviada_en, anulada_en, motivo_anulacion, creado_en')
    .in('cotizacion_pdf_id', ids)
    .order('creado_en', { ascending: true })
  if (errorFacturas) throw new Error(`No se pudieron leer las facturas: ${errorFacturas.message}`)

  // La cotización en Word se baja con su nombre; el PDF se abre en el navegador.
  const pdfs = filas.filter((f) => (f.archivo_mime ?? 'application/pdf') === 'application/pdf')
  const [urlsCotizacion, urlsFactura] = await Promise.all([
    enlaces('cotizaciones-pdf', pdfs.map((f) => f.archivo_ruta)),
    enlaces(BUCKET_FACTURAS_VENTA, (facturas ?? []).map((f) => f.ruta_storage)),
  ])
  await Promise.all(
    filas
      .filter((f) => f.archivo_ruta && (f.archivo_mime ?? 'application/pdf') !== 'application/pdf')
      .map(async (f) => {
        const { data: firmado } = await supabase.storage
          .from('cotizaciones-pdf')
          .createSignedUrl(f.archivo_ruta as string, 600, { download: f.archivo_nombre ?? true })
        if (firmado?.signedUrl) urlsCotizacion.set(f.archivo_ruta as string, firmado.signedUrl)
      }),
  )

  const lista = filas.map((f) => ({
    ...f,
    url: (f.archivo_ruta && urlsCotizacion.get(f.archivo_ruta)) ?? null,
    facturas: (facturas ?? [])
      .filter((x) => x.cotizacion_pdf_id === f.cotizacion_id)
      .map((x) => ({ ...x, url: urlsFactura.get(x.ruta_storage) ?? null })),
  }))
  const sinFactura = (c: CotizacionPorFacturar) => !c.facturas.some((x) => x.estado !== 'ANULADA')
  return lista.sort((a, b) => Number(sinFactura(b)) - Number(sinFactura(a)))
}

type FacturaDeCotizacion = Pick<Tablas<'facturas_venta'>, 'cotizacion_pdf_id' | 'numero' | 'estado' | 'total' | 'moneda'>

/**
 * Por cotización, si Administración ya la envió a Contabilidad y qué facturas
 * salieron. El RLS decide qué ve cada uno: Ventas ve el envío pero no las
 * facturas; Administración, las que ya llegaron a Tesorería.
 */
export async function envioYFacturasDe(cotizacionIds: string[]) {
  const vacio = { envios: new Map<string, string>(), facturas: new Map<string, FacturaDeCotizacion[]>() }
  if (cotizacionIds.length === 0) return vacio
  const supabase = await createClient()
  const [envios, facturas] = await Promise.all([
    supabase.from('cotizaciones_envios_contabilidad').select('cotizacion_pdf_id, enviado_en').in('cotizacion_pdf_id', cotizacionIds),
    supabase.from('facturas_venta').select('cotizacion_pdf_id, numero, estado, total, moneda').in('cotizacion_pdf_id', cotizacionIds).order('creado_en'),
  ])
  if (envios.error) throw new Error(`No se pudo leer el envío a Contabilidad: ${envios.error.message}`)
  if (facturas.error) throw new Error(`No se pudieron leer las facturas: ${facturas.error.message}`)
  for (const e of envios.data ?? []) vacio.envios.set(e.cotizacion_pdf_id, e.enviado_en)
  for (const f of facturas.data ?? []) {
    vacio.facturas.set(f.cotizacion_pdf_id, [...(vacio.facturas.get(f.cotizacion_pdf_id) ?? []), f])
  }
  return vacio
}

type CuentaCobrarFila = Pick<
  Vistas<'v_cuentas_cobrar_ot'>,
  | 'id' | 'orden_id' | 'numero_ot' | 'numero_documento' | 'fecha_emision' | 'fecha_vencimiento' | 'moneda' | 'total'
  | 'cobrado' | 'saldo' | 'factura_venta_id' | 'cliente' | 'cotizacion_numero' | 'concepto' | 'factura_ruta' | 'creado_en'
>
export type CuentaPorCobrar = CuentaCobrarFila & {
  url: string | null
  cobros: Pick<Tablas<'cobros_ot'>, 'id' | 'fecha' | 'monto' | 'referencia'>[]
}

/** Las facturas que Contabilidad envió a Tesorería (y las que se anotaron a mano antes), con sus cobros y el PDF. */
export async function cuentasPorCobrar(): Promise<CuentaPorCobrar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_cuentas_cobrar_ot')
    .select('id, orden_id, numero_ot, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, cobrado, saldo, factura_venta_id, cliente, cotizacion_numero, concepto, factura_ruta, creado_en')
    .order('fecha_vencimiento')
    .limit(300)
  if (error) throw new Error(`No se pudieron leer las cuentas por cobrar: ${error.message}`)
  const filas = data ?? []
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const [cobros, urls] = await Promise.all([
    ids.length
      ? supabase.from('cobros_ot').select('id, cuenta_id, fecha, monto, referencia').in('cuenta_id', ids).order('fecha')
      : Promise.resolve({ data: [], error: null }),
    enlaces(BUCKET_FACTURAS_VENTA, filas.map((f) => f.factura_ruta)),
  ])
  if (cobros.error) throw new Error(`No se pudieron leer los cobros: ${cobros.error.message}`)
  return filas.map((f) => ({
    ...f,
    url: (f.factura_ruta && urls.get(f.factura_ruta)) ?? null,
    cobros: (cobros.data ?? []).filter((c) => c.cuenta_id === f.id).map(({ id, fecha, monto, referencia }) => ({ id, fecha, monto, referencia })),
  }))
}

type ServicioFila = Funciones<'servicios_por_pagar'>['Returns'][number]
type PagoServicioFila = Pick<
  Tablas<'pagos_orden_servicio'>,
  | 'id' | 'orden_servicio_id' | 'fecha_pago' | 'moneda' | 'monto' | 'cancela' | 'operacion' | 'comprobante_proveedor'
  | 'archivo_ruta' | 'archivo_mime' | 'anulado_en' | 'motivo_anulacion'
>
export type ServicioPorPagar = ServicioFila & {
  pagos: (PagoServicioFila & { url: string | null })[]
  cuentas: Pick<Tablas<'proveedor_cuentas'>, 'id' | 'banco' | 'numero_cuenta' | 'titular' | 'moneda'>[]
  codigo_interno: string | null
  detraccion: DetraccionDeServicio
}

/**
 * Las órdenes de servicio aprobadas por Gerencia, con lo pagado, los comprobantes,
 * las cuentas del proveedor y la detracción que Logística o Contabilidad le
 * fijaron (migración 20261015141000): esa parte va al Banco de la Nación.
 */
export async function serviciosPorPagar(verCuentas: boolean): Promise<ServicioPorPagar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('servicios_por_pagar')
  if (error) throw new Error(`No se pudieron leer los servicios por pagar: ${error.message}`)
  const filas = data ?? []
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const proveedores = [...new Set(filas.flatMap((f) => (f.proveedor_id ? [f.proveedor_id] : [])))]
  const [pagos, cuentas, detracciones, tipos] = await Promise.all([
    ids.length
      ? supabase
          .from('pagos_orden_servicio')
          .select('id, orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion, comprobante_proveedor, archivo_ruta, archivo_mime, anulado_en, motivo_anulacion')
          .in('orden_servicio_id', ids)
          .order('fecha_pago')
      : Promise.resolve({ data: [], error: null }),
    verCuentas && proveedores.length
      ? supabase.from('proveedor_cuentas').select('id, proveedor_id, banco, numero_cuenta, titular, moneda').in('proveedor_id', proveedores).eq('activo', true)
      : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from('ordenes_servicio').select(COLUMNAS_DETRACCION).in('id', ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? cargarTiposDetraccion() : Promise.resolve([]),
  ])
  if (pagos.error) throw new Error(`No se pudieron leer los pagos de servicio: ${pagos.error.message}`)
  if (cuentas.error) throw new Error(`No se pudieron leer las cuentas de los proveedores: ${cuentas.error.message}`)
  if (detracciones.error) throw new Error(`No se pudo leer la detracción de los servicios: ${detracciones.error.message}`)
  const detraccionDe = new Map((detracciones.data ?? []).map((d) => [d.id, d]))
  const urls = await enlaces(BUCKET_PAGOS_SERVICIO, (pagos.data ?? []).map((p) => p.archivo_ruta))
  return filas.map((f) => ({
    ...f,
    pagos: (pagos.data ?? []).filter((p) => p.orden_servicio_id === f.id).map((p) => ({ ...p, url: urls.get(p.archivo_ruta) ?? null })),
    cuentas: (cuentas.data ?? []).filter((c) => c.proveedor_id === f.proveedor_id).map(({ id, banco, numero_cuenta, titular, moneda }) => ({ id, banco, numero_cuenta, titular, moneda })),
    codigo_interno: (f.id && detraccionDe.get(f.id)?.codigo_interno) || null,
    detraccion: detraccionDeFila(f.id ? detraccionDe.get(f.id) : undefined, tipos),
  }))
}

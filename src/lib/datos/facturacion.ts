import 'server-only'

import { COLUMNAS_DETRACCION, cargarTiposDetraccion, detraccionDeFila } from '@/lib/datos/logistica'
import type { DetraccionDeServicio } from '@/lib/dominio/detraccion'
import { BUCKET_COBROS_VENTA, BUCKET_FACTURAS_VENTA, BUCKET_PAGOS_SERVICIO } from '@/lib/dominio/finanzas'
import type { CodigoMoneda } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import type { Database, Tablas, Vistas } from '@/types/database'

type Funciones<T extends keyof Database['public']['Functions']> = Database['public']['Functions'][T]

/**
 * La factura de venta y su cobro cuelgan del código interno (migración
 * 20261015124000): Contabilidad ve cada cotización aprobada y registra su
 * factura con el PDF; la factura entra sola a cuentas por cobrar y Tesorería
 * registra cada cobro con su voucher. Tesorería paga además las órdenes de
 * servicio aprobadas (migración 20261015120000).
 */

type FilaCobro = Pick<
  Tablas<'cobros_factura_venta'>,
  'id' | 'factura_id' | 'fecha' | 'monto' | 'cancela' | 'operacion' | 'archivo_ruta' | 'archivo_mime' | 'anulado_en' | 'motivo_anulacion'
>
export type CobroFactura = FilaCobro & { url: string | null }

type FilaFactura = Pick<
  Vistas<'v_facturas_venta'>,
  | 'id' | 'codigo_interno' | 'cotizacion_pdf_id' | 'cotizacion_numero' | 'cliente' | 'numero' | 'fecha_emision'
  | 'fecha_vencimiento' | 'moneda' | 'total' | 'concepto' | 'ruta_storage' | 'anulada_en' | 'motivo_anulacion'
  | 'cobrado' | 'cancelada' | 'saldo' | 'creado_en'
>
export type FacturaVenta = FilaFactura & { url: string | null; cobros: CobroFactura[] }

type FilaCotizacion = Funciones<'cotizaciones_para_facturar'>['Returns'][number]
export type CotizacionAprobada = FilaCotizacion & { url: string | null }
/** En la bandeja de Contabilidad, `facturas` deja de ser la cuenta y trae las facturas mismas. */
export type CotizacionParaFacturar = Omit<CotizacionAprobada, 'facturas'> & { facturas: FacturaVenta[] }

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
 * Cada cotización aprobada y vigente, con su código interno (nulo mientras
 * Administración no cargue la OT), el cliente, el total y el enlace al archivo
 * aprobado. La cotización en Word se baja con su nombre; el PDF se abre.
 */
export async function cotizacionesAprobadas(codigo?: string): Promise<CotizacionAprobada[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cotizaciones_para_facturar')
  if (error) throw new Error(`No se pudieron leer las cotizaciones aprobadas: ${error.message}`)
  // Con `codigo`, solo las de ese código interno: no se firman enlaces de las demás.
  const filas = (data ?? []).filter((f) => codigo === undefined || f.codigo_interno === codigo)
  const esPdf = (f: FilaCotizacion) => (f.archivo_mime ?? 'application/pdf') === 'application/pdf'
  const urls = await enlaces('cotizaciones-pdf', filas.filter(esPdf).map((f) => f.archivo_ruta))
  await Promise.all(
    filas
      .filter((f) => f.archivo_ruta && !esPdf(f))
      .map(async (f) => {
        const { data: firmado } = await supabase.storage
          .from('cotizaciones-pdf')
          .createSignedUrl(f.archivo_ruta as string, 600, { download: f.archivo_nombre ?? true })
        if (firmado?.signedUrl) urls.set(f.archivo_ruta as string, firmado.signedUrl)
      }),
  )
  return filas.map((f) => ({ ...f, url: (f.archivo_ruta && urls.get(f.archivo_ruta)) ?? null }))
}

const COLUMNAS_FACTURA =
  'id, codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision, fecha_vencimiento, moneda, total, concepto, ruta_storage, anulada_en, motivo_anulacion, cobrado, cancelada, saldo, creado_en'

/**
 * Las facturas de venta con sus cobros y los enlaces a la factura y a cada
 * voucher. Con `cotizaciones`, solo las de esas cotizaciones (anuladas
 * incluidas); sin él, las vigentes, de la que vence antes a la que vence después.
 */
export async function facturasDeVenta(cotizaciones?: string[]): Promise<FacturaVenta[]> {
  if (cotizaciones && cotizaciones.length === 0) return []
  const supabase = await createClient()
  const consulta = cotizaciones
    ? supabase.from('v_facturas_venta').select(COLUMNAS_FACTURA).in('cotizacion_pdf_id', cotizaciones).order('creado_en')
    : supabase.from('v_facturas_venta').select(COLUMNAS_FACTURA).is('anulada_en', null).order('fecha_vencimiento').limit(300)
  const { data, error } = await consulta
  if (error) throw new Error(`No se pudieron leer las facturas de venta: ${error.message}`)
  return conCobros(data ?? [])
}

/** Las facturas de un código interno, anuladas incluidas, de la más vieja a la más nueva: Gerencia en Códigos internos. */
export async function facturasDelCodigo(codigo: string): Promise<FacturaVenta[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('v_facturas_venta').select(COLUMNAS_FACTURA).eq('codigo_interno', codigo).order('creado_en')
  if (error) throw new Error(`No se pudieron leer las facturas del código: ${error.message}`)
  return conCobros(data ?? [])
}

/** Le pega a cada factura sus cobros y los enlaces a la factura y a cada voucher. */
async function conCobros(filas: FilaFactura[]): Promise<FacturaVenta[]> {
  const supabase = await createClient()
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const cobros = ids.length
    ? await supabase
        .from('cobros_factura_venta')
        .select('id, factura_id, fecha, monto, cancela, operacion, archivo_ruta, archivo_mime, anulado_en, motivo_anulacion')
        .in('factura_id', ids)
        .order('fecha')
        .order('creado_en')
    : { data: [], error: null }
  if (cobros.error) throw new Error(`No se pudieron leer los cobros: ${cobros.error.message}`)
  const [urlsFactura, urlsVoucher] = await Promise.all([
    enlaces(BUCKET_FACTURAS_VENTA, filas.map((f) => f.ruta_storage)),
    enlaces(BUCKET_COBROS_VENTA, (cobros.data ?? []).map((c) => c.archivo_ruta)),
  ])
  return filas.map((f) => ({
    ...f,
    url: (f.ruta_storage && urlsFactura.get(f.ruta_storage)) ?? null,
    cobros: (cobros.data ?? [])
      .filter((c) => c.factura_id === f.id)
      .map((c) => ({ ...c, url: urlsVoucher.get(c.archivo_ruta) ?? null })),
  }))
}

/**
 * Lo que Contabilidad tiene por facturar: cada cotización aprobada con sus
 * facturas. Primero las que tienen código interno y ninguna factura vigente;
 * al final, las que esperan que Administración cargue la OT.
 */
export async function bandejaDeFacturacion(): Promise<CotizacionParaFacturar[]> {
  const cotizaciones = await cotizacionesAprobadas()
  const facturas = await facturasDeVenta(cotizaciones.flatMap((c) => (c.cotizacion_id ? [c.cotizacion_id] : [])))
  const lista = cotizaciones.map((c) => ({ ...c, facturas: facturas.filter((f) => f.cotizacion_pdf_id === c.cotizacion_id) }))
  const turno = (c: CotizacionParaFacturar) =>
    !c.codigo_interno ? 2 : c.facturas.some((f) => !f.anulada_en) ? 1 : 0
  return lista.sort((a, b) => turno(a) - turno(b))
}

/** Lo facturado de un código, en cada moneda: la línea de arriba en Códigos internos. Sin las anuladas. */
export type FacturadoDelCodigo = { facturas: number; total: Record<CodigoMoneda, number>; cobrado: Record<CodigoMoneda, number>; saldo: Record<CodigoMoneda, number> }

export async function facturadoDelCodigo(codigo: string): Promise<FacturadoDelCodigo> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_facturas_venta')
    .select('moneda, total, cobrado, saldo')
    .eq('codigo_interno', codigo)
    .is('anulada_en', null)
  if (error) throw new Error(`No se pudo leer lo facturado del código: ${error.message}`)
  const cero = () => ({ PEN: 0, USD: 0 })
  const r: FacturadoDelCodigo = { facturas: 0, total: cero(), cobrado: cero(), saldo: cero() }
  for (const f of data ?? []) {
    const m: CodigoMoneda = f.moneda === 'USD' ? 'USD' : 'PEN'
    r.facturas += 1
    r.total[m] += Number(f.total ?? 0)
    r.cobrado[m] += Number(f.cobrado ?? 0)
    r.saldo[m] += Number(f.saldo ?? 0)
  }
  return r
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
    detraccion: detraccionDeFila(f.id ? detraccionDe.get(f.id) : undefined, tipos),
  }))
}

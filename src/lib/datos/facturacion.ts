import 'server-only'

import { cambioDeLosServicios, COLUMNAS_DETRACCION, cargarTiposDetraccion, detraccionDeFila, documentosDeServicios, type DocumentoDeServicio } from '@/lib/datos/logistica'
import { bajarComo } from '@/lib/descarga'
import type { DetraccionDeServicio, SaldoDeServicio } from '@/lib/dominio/detraccion'
import { BUCKET_COBROS_VENTA, BUCKET_FACTURAS_VENTA, BUCKET_PAGOS_SERVICIO, comoVaLaFactura, totalConIgv, type ComoVaLaFactura } from '@/lib/dominio/finanzas'
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
/**
 * `paso_a_otro_comprador`: la venta se cerró porque su OT pasó a otro comprador (las OT, el
 * número solo para quien lee las órdenes); ya no lleva OT y queda cobrar o anular su factura
 * (migración 20261126988000). Nulo: no se cerró.
 */
export type CotizacionAprobada = FilaCotizacion & { url: string | null; paso_a_otro_comprador: (string | null)[] | null }
/**
 * En la bandeja de Contabilidad, `facturas` deja de ser la cuenta y trae las facturas mismas.
 * `unidades_a_otro_comprador`: de una cotización de varias unidades, cuántas pasaron a otro
 * comprador mientras otra sigue siendo de esta venta. El total no descuenta nada (la cotización
 * guarda un solo monto): Facturación lo avisa y Contabilidad decide (migración 20261126998600).
 */
export type CotizacionParaFacturar = Omit<CotizacionAprobada, 'facturas'> & {
  facturas: FacturaVenta[]
  unidades_a_otro_comprador: { pasaron: number; unidades: number } | null
}

export const SIN_ENLACES =
  'No se pudieron preparar los enlaces temporales de los documentos. Recarga la página para volver a intentar.'

/**
 * Si el almacenamiento dijo que ese archivo no está (o que esta cuenta no lo
 * ve, que responde igual). Ese caso deja la fila sin enlace; cualquier otro
 * error es que el almacenamiento no respondió, y se avisa.
 */
export const archivoNoEncontrado = (error: { message: string }) => /not.?found|does not exist/i.test(error.message)

/**
 * Enlaces firmados de un bucket, por ruta. Un archivo que falta o que esta
 * cuenta no ve deja su fila sin enlace: se ve qué hay aunque no se abra. Si el
 * almacenamiento no responde, lanza: antes el botón del PDF desaparecía de
 * todas las filas sin ninguna explicación.
 */
export async function enlaces(bucket: string, rutas: (string | null)[], segundos = 600): Promise<Map<string, string>> {
  const unicas = [...new Set(rutas.filter((r): r is string => Boolean(r)))]
  const mapa = new Map<string, string>()
  if (unicas.length === 0) return mapa
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unicas, segundos)
  if (error) throw new Error(SIN_ENLACES)
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
  // Solo puede estar cerrada la que no tiene código: la base mira esas.
  const [urls, cerradas] = await Promise.all([
    enlaces('cotizaciones-pdf', filas.filter(esPdf).map((f) => f.archivo_ruta)),
    ventasCerradas(filas.flatMap((f) => (f.cotizacion_id && !f.codigo_interno ? [f.cotizacion_id] : []))),
  ])
  await Promise.all(
    filas
      .filter((f) => f.archivo_ruta && !esPdf(f))
      .map(async (f) => {
        const { data: firmado, error } = await supabase.storage.from('cotizaciones-pdf').createSignedUrl(f.archivo_ruta as string, 600)
        if (error && !archivoNoEncontrado(error)) throw new Error(SIN_ENLACES)
        if (firmado?.signedUrl) urls.set(f.archivo_ruta as string, bajarComo(firmado.signedUrl, f.archivo_nombre ?? true))
      }),
  )
  return filas.map((f) => ({
    ...f,
    url: (f.archivo_ruta && urls.get(f.archivo_ruta)) ?? null,
    paso_a_otro_comprador: (f.cotizacion_id && cerradas.get(f.cotizacion_id)) || null,
  }))
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
  if (cotizaciones) {
    const filas = await enTandas(cotizaciones, async (tanda) => {
      const r = await supabase.from('v_facturas_venta').select(COLUMNAS_FACTURA).in('cotizacion_pdf_id', tanda).order('creado_en')
      if (r.error) throw new Error(`No se pudieron leer las facturas de venta: ${r.error.message}`)
      return r.data ?? []
    })
    return conCobros(filas)
  }
  // Lo que falta cobrar va entero, filtrado en la base; lo ya cobrado, solo lo
  // último. Antes iban juntas, de la que vence antes a la que vence después y
  // con tope de 300: con el tiempo las cobradas viejas llenaban la lista y las
  // facturas nuevas por cobrar, y su total, desaparecían sin aviso.
  const [pendientes, cobradas] = await Promise.all([
    supabase.from('v_facturas_venta').select(COLUMNAS_FACTURA).is('anulada_en', null)
      .eq('cancelada', false).gt('saldo', 0).order('fecha_vencimiento'),
    supabase.from('v_facturas_venta').select(COLUMNAS_FACTURA).is('anulada_en', null)
      .or('cancelada.eq.true,saldo.lte.0').order('ultimo_cobro', { ascending: false, nullsFirst: false })
      .order('fecha_emision', { ascending: false }).limit(COBRADAS_A_LA_VISTA),
  ])
  const error = pendientes.error ?? cobradas.error
  if (error) throw new Error(`No se pudieron leer las facturas de venta: ${error.message}`)
  return conCobros([...(pendientes.data ?? []), ...(cobradas.data ?? [])])
}

/** Cuántas facturas ya cobradas se muestran, de la del último cobro más reciente a la más vieja. */
export const COBRADAS_A_LA_VISTA = 60

/** De a tandas, para no alargar la URL con cientos de identificadores. */
async function enTandas<T>(ids: string[], leer: (tanda: string[]) => Promise<T[]>): Promise<T[]> {
  const filas: T[] = []
  for (let i = 0; i < ids.length; i += 150) filas.push(...(await leer(ids.slice(i, i + 150))))
  return filas
}

/**
 * Lo que falta cobrar de las facturas de cada código, por moneda, sin las anuladas: para quien
 * responde las salidas de vehículos sin leer las cotizaciones aprobadas (Costos). Cuenta todas
 * las facturas del código, no solo las que la lista de Cuentas por cobrar trae a la vista.
 */
export async function saldoDeFacturasPorCodigo(
  codigos: string[],
): Promise<Record<string, { saldo: Record<CodigoMoneda, number>; facturas: number; conSaldo: number }>> {
  const unicos = [...new Set(codigos)]
  if (unicos.length === 0) return {}
  const supabase = await createClient()
  const filas = await enTandas(unicos, async (tanda) => {
    const r = await supabase.from('v_facturas_venta').select('codigo_interno, moneda, saldo, cancelada')
      .in('codigo_interno', tanda).is('anulada_en', null)
    if (r.error) throw new Error(`No se pudieron leer las facturas de los códigos: ${r.error.message}`)
    return r.data ?? []
  })
  const porCodigo: Record<string, { saldo: Record<CodigoMoneda, number>; facturas: number; conSaldo: number }> = {}
  for (const f of filas) {
    if (!f.codigo_interno) continue
    const fila = (porCodigo[f.codigo_interno] ??= { saldo: { PEN: 0, USD: 0 }, facturas: 0, conSaldo: 0 })
    fila.facturas += 1
    // Por cobrar es lo mismo que en la lista: no cancelada y con saldo.
    if (!f.cancelada && Number(f.saldo) > 0.005) {
      fila.saldo[f.moneda === 'USD' ? 'USD' : 'PEN'] += Number(f.saldo)
      fila.conSaldo += 1
    }
  }
  return porCodigo
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
  const cobros = {
    data: await enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('cobros_factura_venta')
        .select('id, factura_id, fecha, monto, cancela, operacion, archivo_ruta, archivo_mime, anulado_en, motivo_anulacion')
        .in('factura_id', tanda)
        .order('fecha')
        .order('creado_en')
      if (r.error) throw new Error(`No se pudieron leer los cobros: ${r.error.message}`)
      return r.data ?? []
    }),
  }
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
 * al final, las que esperan que Administración cargue la OT. La pantalla de
 * Facturación las vuelve a ordenar con los días que llevan esperando (Plan 10.1).
 */
export async function bandejaDeFacturacion(): Promise<CotizacionParaFacturar[]> {
  const cotizaciones = await cotizacionesAprobadas()
  const ids = cotizaciones.flatMap((c) => (c.cotizacion_id ? [c.cotizacion_id] : []))
  const [facturas, pasaron] = await Promise.all([facturasDeVenta(ids), unidadesAOtroComprador(ids)])
  const lista = cotizaciones.map((c) => ({
    ...c,
    facturas: facturas.filter((f) => f.cotizacion_pdf_id === c.cotizacion_id),
    unidades_a_otro_comprador: (c.cotizacion_id && pasaron.get(c.cotizacion_id)) || null,
  }))
  const turno = (c: CotizacionParaFacturar) =>
    !c.codigo_interno ? 2 : c.facturas.some((f) => !f.anulada_en) ? 1 : 0
  return lista.sort((a, b) => turno(a) - turno(b))
}

/** De las cotizaciones dadas, las que se cerraron porque su OT pasó a otro comprador, con sus OT. */
async function ventasCerradas(ids: string[]): Promise<Map<string, (string | null)[]>> {
  const cerradas = new Map<string, (string | null)[]>()
  if (ids.length === 0) return cerradas
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ventas_cerradas_por_otro_comprador', { p_ids: ids })
  if (error) throw error
  for (const v of data ?? []) if (v.cotizacion_id) cerradas.set(v.cotizacion_id, v.ordenes ?? [])
  return cerradas
}

/**
 * De las cotizaciones dadas, las de varias unidades de las que alguna pasó a otro comprador y
 * otra sigue siendo de esta venta: cuántas pasaron y de cuántas. Si no se puede leer, lanza: sin
 * ese aviso Contabilidad facturaría el total entero sin saber que una unidad ya no es de esa venta.
 */
async function unidadesAOtroComprador(ids: string[]): Promise<Map<string, { pasaron: number; unidades: number }>> {
  const mapa = new Map<string, { pasaron: number; unidades: number }>()
  if (ids.length === 0) return mapa
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('unidades_que_pasaron_a_otro_comprador', { p_ids: ids })
  if (error) throw new Error(`No se pudo leer qué unidades pasaron a otro comprador: ${error.message}`)
  for (const u of data ?? []) {
    if (u.cotizacion_id && u.pasaron && u.unidades) mapa.set(u.cotizacion_id, { pasaron: u.pasaron, unidades: u.unidades })
  }
  return mapa
}

/**
 * Lo facturado de un código contra lo vendido, cotización por cotización, con la regla de la bandeja de
 * Contabilidad (`comoVaLaFactura`). `null`: no se comparó (sin permiso para leer lo vendido, o alguna
 * cotización sin monto); quien lo muestra lo dice en vez de darlo por hecho.
 */
export type FacturadoContraVendido = {
  /** Con IGV, de las cotizaciones aprobadas del código. */
  vendido: Record<CodigoMoneda, number>
  /** Lo que falta facturar de las que van por facturar o en parte, en su moneda. */
  falta: Record<CodigoMoneda, number>
  /** En qué va cada cotización. */
  como: ComoVaLaFactura[]
  /** Alguna sin confirmar si su monto incluye IGV: lo vendido se toma con IGV, como en la bandeja, y puede faltar el 18 %. */
  igvSinConfirmar: boolean
}

/** Desde cuándo espera su factura cada cotización y cuántos días van, por fecha de Lima. */
export type EsperaDeFacturacion = { desde: string | null; dias: number | null }

/**
 * Desde que la OT de cada cotización tiene código interno, que es cuando se
 * puede facturar (DKS, Plan 10), y los días que van contados por la base con
 * la fecha de Lima (migración 20261126470000). Lo lee quien lee las
 * cotizaciones aprobadas. Si la base no contesta, lanza: la pantalla sigue sin
 * los días y lo dice.
 */
export async function esperaDeFacturacion(ids: string[]): Promise<Map<string, EsperaDeFacturacion>> {
  const mapa = new Map<string, EsperaDeFacturacion>()
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return mapa
  const supabase = await createClient()
  // De a 500, el tope de la función.
  for (let i = 0; i < unicos.length; i += 500) {
    const { data, error } = await supabase.rpc('facturacion_en_espera', { p_ids: unicos.slice(i, i + 500) })
    if (error) throw new Error(`No se pudieron contar los días que esperan su factura: ${error.message}`)
    for (const f of data ?? []) {
      if (f.cotizacion) mapa.set(f.cotizacion, { desde: f.desde, dias: f.dias == null ? null : Number(f.dias) })
    }
  }
  return mapa
}

/** Lo facturado de un código, en cada moneda, sin las anuladas, y cómo va contra lo vendido. */
export type FacturadoDelCodigo = {
  facturas: number
  total: Record<CodigoMoneda, number>
  cobrado: Record<CodigoMoneda, number>
  saldo: Record<CodigoMoneda, number>
  contraVendido: FacturadoContraVendido | null
  /** Por qué no se comparó, si no se comparó. */
  sinComparar: 'SIN_PERMISO' | 'SIN_MONTO' | 'NO_SE_PUDO' | 'SIN_COTIZACION' | null
}

/**
 * `leeLoVendido`: quien tiene la puerta de `codigo_interno_lo_vendido` (`contabilidad.facturar` o
 * `cotizaciones.ver_aprobadas`). Lo vendido se lee por código en la base, sin el tope de 300 de la bandeja.
 */
export async function facturadoDelCodigo(codigo: string, leeLoVendido: boolean): Promise<FacturadoDelCodigo> {
  const supabase = await createClient()
  const [{ data, error }, ventas] = await Promise.all([
    supabase.from('v_facturas_venta').select('moneda, total, cobrado, saldo').eq('codigo_interno', codigo).is('anulada_en', null),
    leeLoVendido ? supabase.rpc('codigo_interno_lo_vendido', { p_codigo: codigo }) : Promise.resolve(null),
  ])
  if (error) throw new Error(`No se pudo leer lo facturado del código: ${error.message}`)
  const cero = () => ({ PEN: 0, USD: 0 })
  let contraVendido: FacturadoContraVendido | null = null
  let sinComparar: FacturadoDelCodigo['sinComparar'] = leeLoVendido ? null : 'SIN_PERMISO'
  // Si lo vendido no se pudo leer, lo facturado igual sale: dice que no se comparó, no tumba la pantalla.
  if (ventas?.error) sinComparar = 'NO_SE_PUDO'
  else if (ventas) {
    const filas = ventas.data ?? []
    if (filas.some((v) => v.monto_venta === null)) sinComparar = 'SIN_MONTO'
    else if (filas.length > 0) {
      contraVendido = { vendido: cero(), falta: cero(), como: [], igvSinConfirmar: filas.some((v) => v.incluye_igv === null) }
      for (const v of filas) {
        const m: CodigoMoneda = v.moneda === 'USD' ? 'USD' : 'PEN'
        const total = totalConIgv(Number(v.monto_venta), v.incluye_igv) ?? 0
        const como = comoVaLaFactura({
          monto: Number(v.monto_venta),
          incluyeIgv: v.incluye_igv,
          facturas: v.facturas ?? 0,
          facturadoEnSuMoneda: Number(v.facturado_en_su_moneda),
          enOtraMoneda: v.en_otra_moneda ?? false,
        })
        contraVendido.vendido[m] += total
        if (como === 'POR_FACTURAR' || como === 'EN_PARTE') contraVendido.falta[m] += Math.round((total - Number(v.facturado_en_su_moneda)) * 100) / 100
        contraVendido.como.push(como)
      }
    } else sinComparar = 'SIN_COTIZACION'
  }
  const r: FacturadoDelCodigo = { facturas: 0, total: cero(), cobrado: cero(), saldo: cero(), contraVendido, sinComparar }
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
  | 'archivo_ruta' | 'archivo_mime' | 'anulado_en' | 'motivo_anulacion' | 'destino'
>
export type ServicioPorPagar = ServicioFila & {
  pagos: (PagoServicioFila & { url: string | null })[]
  saldo: SaldoDeServicio
  cuentas: Pick<Tablas<'proveedor_cuentas'>, 'id' | 'banco' | 'numero_cuenta' | 'titular' | 'moneda'>[]
  detraccion: DetraccionDeServicio
  /** La factura, la boleta o el recibo del proveedor, y el contrato (migración 20261020210000). */
  documentos: DocumentoDeServicio[]
}

/**
 * Las órdenes de servicio aprobadas por Gerencia, con lo pagado, los comprobantes,
 * las cuentas del proveedor y la detracción que Logística o Contabilidad le
 * fijaron (migración 20261015141000): esa parte va al Banco de la Nación. Lo que
 * se debe de cada una lo da la base, con IGV (migración 20261026100000).
 */
export async function serviciosPorPagar(verCuentas: boolean): Promise<ServicioPorPagar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('servicios_por_pagar')
  if (error) throw new Error(`No se pudieron leer los servicios por pagar: ${error.message}`)
  const filas = data ?? []
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const proveedores = [...new Set(filas.flatMap((f) => (f.proveedor_id ? [f.proveedor_id] : [])))]
  const [pagos, cuentas, detracciones, tipos, documentos, saldos] = await Promise.all([
    ids.length
      ? supabase
          .from('pagos_orden_servicio')
          .select('id, orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion, comprobante_proveedor, archivo_ruta, archivo_mime, anulado_en, motivo_anulacion, destino')
          .in('orden_servicio_id', ids)
          .order('fecha_pago')
      : Promise.resolve({ data: [], error: null }),
    verCuentas && proveedores.length
      ? supabase.from('proveedor_cuentas').select('id, proveedor_id, banco, numero_cuenta, titular, moneda').in('proveedor_id', proveedores).eq('activo', true)
      : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from('ordenes_servicio').select(COLUMNAS_DETRACCION).in('id', ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? cargarTiposDetraccion() : Promise.resolve([]),
    documentosDeServicios(ids),
    saldosDeServicios(ids),
  ])
  if (pagos.error) throw new Error(`No se pudieron leer los pagos de servicio: ${pagos.error.message}`)
  if (cuentas.error) throw new Error(`No se pudieron leer las cuentas de los proveedores: ${cuentas.error.message}`)
  if (detracciones.error) throw new Error(`No se pudo leer la detracción de los servicios: ${detracciones.error.message}`)
  const detraccionDe = new Map((detracciones.data ?? []).map((d) => [d.id, d]))
  // Con qué cambio va de verdad cada OS, como lo dice la base: Tesorería deposita con esa cifra.
  const [cambios, urls] = await Promise.all([
    cambioDeLosServicios((detracciones.data ?? []).filter((d) => d.moneda !== 'PEN').map((d) => d.id)),
    enlaces(BUCKET_PAGOS_SERVICIO, (pagos.data ?? []).map((p) => p.archivo_ruta)),
  ])
  return filas.map((f) => ({
    ...f,
    pagos: (pagos.data ?? []).filter((p) => p.orden_servicio_id === f.id).map((p) => ({ ...p, url: urls.get(p.archivo_ruta) ?? null })),
    cuentas: (cuentas.data ?? []).filter((c) => c.proveedor_id === f.proveedor_id).map(({ id, banco, numero_cuenta, titular, moneda }) => ({ id, banco, numero_cuenta, titular, moneda })),
    detraccion: detraccionDeFila(f.id ? detraccionDe.get(f.id) : undefined, tipos, f.id ? cambios.get(f.id) : undefined),
    documentos: (f.id && documentos.get(f.id)) || [],
    saldo: (f.id && saldos.get(f.id)) || SIN_SALDO,
  }))
}

const SIN_SALDO: SaldoDeServicio = {
  total: 0, detraccion: 0, detraccionEnMoneda: 0, alProveedor: 0, pagadoProveedor: 0, pagadoDetraccion: 0, saldoProveedor: 0, saldoDetraccion: 0,
}

/** Lo que se debe de cada orden de servicio, por su id (migración 20261026100000). */
export async function saldosDeServicios(ids: string[]): Promise<Map<string, SaldoDeServicio>> {
  if (ids.length === 0) return new Map()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('saldos_de_servicios', { p_ids: ids })
  if (error) throw new Error(`No se pudo leer lo que falta pagar de los servicios: ${error.message}`)
  return new Map(
    (data ?? []).flatMap((f) =>
      f.orden_servicio_id
        ? [[
            f.orden_servicio_id,
            {
              total: Number(f.total ?? 0),
              detraccion: Number(f.detraccion ?? 0),
              detraccionEnMoneda: Number(f.detraccion_en_moneda ?? 0),
              alProveedor: Number(f.al_proveedor ?? 0),
              pagadoProveedor: Number(f.pagado_proveedor ?? 0),
              pagadoDetraccion: Number(f.pagado_detraccion ?? 0),
              saldoProveedor: Number(f.saldo_proveedor ?? 0),
              saldoDetraccion: Number(f.saldo_detraccion ?? 0),
            } satisfies SaldoDeServicio,
          ] as const]
        : [],
    ),
  )
}

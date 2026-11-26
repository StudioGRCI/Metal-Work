/**
 * Lo que comparten las pantallas de Facturación (Contabilidad) y de Tesorería.
 * Puro, sin consultas: lo usan el servidor y el navegador. Las mismas cifras
 * las exige la base (migraciones 20261015120000 a 20261015124000).
 */

import { moneda, parteDe, porcentaje } from '@/lib/format'

type Tono = 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info' | 'acento'

/** El bucket privado de las facturas de venta: la ruta es `{factura}/{archivo}.pdf`. */
export const BUCKET_FACTURAS_VENTA = 'facturas-venta'

/** El bucket privado de los vouchers de cobro de las facturas de venta: la ruta es `{factura}/{archivo}`. */
export const BUCKET_COBROS_VENTA = 'cobros-venta'

/** El bucket privado de los comprobantes de pago de servicio: la ruta es `{orden de servicio}/{archivo}`. */
export const BUCKET_PAGOS_SERVICIO = 'pagos-servicio'

/** El bucket privado de los vouchers con que Tesorería paga las facturas de compra: la ruta es `{factura}/{archivo}`. */
export const BUCKET_PAGOS_FACTURAS = 'pagos-facturas'

/** El bucket privado de los vouchers con que Tesorería paga las OC con boleta: la ruta es `{OC}/{archivo}` (migración 20261020210000). */
export const BUCKET_PAGOS_COMPRAS = 'pagos-compras'

/** La nota de crédito del proveedor (Contabilidad) y la constancia de lo que devolvió de ella (Tesorería), migración 20261022190000. */
export const BUCKET_NOTAS_CREDITO = 'notas-credito'

/** El bucket privado de la factura, el contrato y demás documentos de la OS: la ruta es `{orden de servicio}/{archivo}`. */
export const BUCKET_DOCUMENTOS_SERVICIO = 'documentos-servicio'

/** Lo que puede pesar una factura o un comprobante. */
export const MAXIMO_MB_FINANZAS = 10

/** Lo que acepta el bucket de pagos de servicio, con la extensión que lleva la ruta. */
export const TIPOS_COMPROBANTE_PAGO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * En qué va una factura de venta (migración 20261015124000): anulada por
 * Contabilidad, cobrada (un cobro la canceló), con cobros a cuenta o por cobrar.
 */
export function estadoFacturaVenta(f: {
  anulada_en: string | null
  cancelada: boolean | null
  cobrado: number | null
}): { etiqueta: string; tono: Tono } {
  if (f.anulada_en) return { etiqueta: 'Anulada', tono: 'peligro' }
  if (f.cancelada) return { etiqueta: 'Cobrada', tono: 'exito' }
  if (Number(f.cobrado ?? 0) > 0) return { etiqueta: 'Cobro a cuenta', tono: 'info' }
  return { etiqueta: 'Por cobrar', tono: 'aviso' }
}

/**
 * El aviso de Adquisiciones: si el total de la factura calza con el de sus OC
 * (`adquisiciones_control`, migración 20261015122000). Solo avisa; no frena nada.
 */
export const CONTROL_FACTURA_COMPRA: Record<string, { etiqueta: string; tono: Tono }> = {
  CALZA: { etiqueta: 'Calza con sus OC', tono: 'exito' },
  NO_CALZA: { etiqueta: 'No calza con sus OC', tono: 'aviso' },
  SIN_OC: { etiqueta: 'Sin OC', tono: 'neutro' },
  OTRA_MONEDA: { etiqueta: 'OC en otra moneda', tono: 'neutro' },
  SIN_PRECIO: { etiqueta: 'OC sin precio', tono: 'aviso' },
  // Cubre solo una parte de sus OC: las demás partes van en otras facturas (migración 20261016701000).
  PARCIAL: { etiqueta: 'Factura parcial', tono: 'info' },
}

/** Lo que trae `adquisiciones_control` de una factura, lo justo para explicarlo. */
type ControlParaTexto = {
  control: string
  total_oc: number | null
  diferencia: number | null
  ordenes: { parcial: boolean; facturado_otras: number; otras_facturas: { numero_documento: string }[] }[]
}

/**
 * La línea que explica el control de una factura frente a lo que faltaba
 * facturar de sus OC. Una OC puede ir en varias facturas: lo que ya cubren las
 * otras no se le cuenta a esta. Nulo si no hay nada que explicar.
 */
export function detalleDelControl(c: ControlParaTexto, dinero: (monto: number) => string): string | null {
  if (c.total_oc === null || c.diferencia === null) return null
  const otras = [...new Set(c.ordenes.flatMap((o) => o.otras_facturas.map((f) => f.numero_documento)))]
  const yaFacturado = c.ordenes.some((o) => o.facturado_otras > 0)
  if (c.control === 'PARCIAL') {
    return `Cubre una parte: de sus OC faltaba facturar ${dinero(c.total_oc)} y quedan ${dinero(Math.abs(c.diferencia))} para otra factura.`
  }
  if (c.control === 'CALZA') return otras.length > 0 ? `Completa sus OC junto con ${otras.join(', ')}.` : null
  if (c.control !== 'NO_CALZA') return null
  const sobra = c.diferencia > 0
  const base = yaFacturado
    ? `De sus OC faltaba facturar ${dinero(c.total_oc)}${otras.length > 0 ? ` (ya van en ${otras.join(', ')})` : ''}`
    : `Sus OC suman ${dinero(c.total_oc)}`
  const marcarParcial = !sobra && !c.ordenes.some((o) => o.parcial) ? ' Si cubre solo una parte, corrígela y márcala como parcial.' : ''
  // La diferencia también como parte de lo que faltaba (DKS, 27/10/2026: porcentaje y costo).
  const parte = parteDe(Math.abs(c.diferencia), c.total_oc)
  return `${base}: ${sobra ? 'sobran' : 'faltan'} ${dinero(Math.abs(c.diferencia))}${parte === null ? '' : ` (${porcentaje(parte)})`}.${marcarParcial}`
}

/**
 * E001-00000626 → E001-626, como lo guarda la base (`normalizar_numero_factura`).
 * Nulo si no tiene la forma de un número de SUNAT.
 */
export function normalizarNumeroFactura(texto: string): string | null {
  const m = texto.replace(/\s/g, '').toUpperCase().match(/^([A-Z][A-Z0-9]{3})-0*([1-9][0-9]{0,7})$/)
  return m ? `${m[1]}-${Number(m[2])}` : null
}

/**
 * El total de la cotización con IGV: si Ventas confirmó que el monto no lo
 * incluye, se le suma el 18 %. Nulo si la cotización no tiene monto.
 */
export function totalConIgv(monto: number | null, incluyeIgv: boolean | null): number | null {
  if (monto === null) return null
  return incluyeIgv === false ? Math.round(Number(monto) * 118) / 100 : Number(monto)
}

export type ComoVaLaFactura = 'POR_FACTURAR' | 'OTRA_MONEDA' | 'EN_PARTE' | 'FACTURADA'

/**
 * En qué va la factura de una cotización aprobada, la regla de la bandeja de
 * Contabilidad y de la cabecera del código. Facturada en otra moneda no se
 * compara: no se puede decir qué parte cubre. Sin monto, no se sabe si falta:
 * se da por facturada, como siempre dijo la bandeja; quien necesita saberlo lo
 * mira aparte (`totalConIgv` en nulo).
 */
export function comoVaLaFactura(c: {
  monto: number | null
  incluyeIgv: boolean | null
  /** Las vigentes. */
  facturas: number
  facturadoEnSuMoneda: number
  enOtraMoneda: boolean
}): ComoVaLaFactura {
  if (c.facturas === 0) return 'POR_FACTURAR'
  if (c.enOtraMoneda) return 'OTRA_MONEDA'
  const total = totalConIgv(c.monto, c.incluyeIgv)
  if (total !== null && c.facturadoEnSuMoneda < total - 0.005) return 'EN_PARTE'
  return 'FACTURADA'
}

/**
 * Una unidad de una cotización aprobada (migración 20261126998000): la
 * cotización de varias unidades lleva una OT, un código interno y sus facturas
 * por cada una. La de una sola unidad es su unidad 1.
 */
export type UnidadDeCotizacion = {
  numero: number
  /** Cuántas unidades tiene la cotización. */
  de: number
  /** El código interno de su OT; nulo mientras Administración no la cargue. */
  codigo: string | null
  /** Desde cuándo su OT tiene código, que es cuando se puede facturar, y los días que van (fecha de Lima). */
  desde: string | null
  dias: number | null
  /** Lo que le toca del total de la cotización, con IGV; nulo si la cotización no tiene monto. */
  parte: number | null
  /** Sus facturas vigentes, contando las de toda la cotización, que le dejan una parte. */
  facturas: number
  /** Lo facturado y lo cobrado de esta unidad en la moneda de la cotización. */
  facturado: number
  cobrado: number
  /** Lo de la otra moneda va aparte: no se suma ni se compara con lo que le toca. */
  facturadoOtraMoneda: number
  cobradoOtraMoneda: number
}

export type ComoVaLaUnidad = ComoVaLaFactura | 'SIN_OT'

/**
 * En qué va la factura de una unidad: la regla de `comoVaLaFactura` contra lo
 * que le toca, que ya viene con IGV. Sin OT no se factura todavía. La misma
 * cuenta que el globo del menú (`facturacion_pendientes`).
 */
export function comoVaLaUnidad(u: Pick<UnidadDeCotizacion, 'codigo' | 'parte' | 'facturas' | 'facturado' | 'facturadoOtraMoneda'>): ComoVaLaUnidad {
  if (!u.codigo) return 'SIN_OT'
  return comoVaLaFactura({
    monto: u.parte,
    incluyeIgv: true,
    facturas: u.facturas,
    facturadoEnSuMoneda: u.facturado,
    enOtraMoneda: u.facturadoOtraMoneda > 0,
  })
}

/** La unidad espera factura: tiene su OT y no tiene factura, o la tiene por una parte de lo que le toca. */
export function esperaFactura(u: Parameters<typeof comoVaLaUnidad>[0]): boolean {
  const como = comoVaLaUnidad(u)
  return como === 'POR_FACTURAR' || como === 'EN_PARTE'
}

/** «Código MW-12», «Códigos MW-12 · MW-13» o «Sin código interno», con las unidades que ya tienen su OT. */
export function rotuloDeCodigos(unidades: Pick<UnidadDeCotizacion, 'codigo'>[]): string {
  const codigos = unidades.flatMap((u) => (u.codigo ? [u.codigo] : []))
  if (codigos.length === 0) return 'Sin código interno'
  return `${codigos.length === 1 ? 'Código' : 'Códigos'} ${codigos.join(' · ')}`
}

/**
 * La línea que va bajo el título de cada bandeja de Tesorería: cuánto espera,
 * en cada moneda, y en cuántos documentos —«S/ 10,280.40 y US$ 1,240.00 en 4
 * facturas»—. Es lo que cambia con los datos; para qué sirve la bandeja va en
 * el botón «i». Nulo si no espera nada: el estado vacío ya lo dice.
 */
export function resumenPorMoneda(
  documentos: { moneda: string | null; monto: number }[],
  [uno, varios]: [string, string],
): string | null {
  if (documentos.length === 0) return null
  const suma = (m: 'PEN' | 'USD') => documentos.filter((d) => (d.moneda === 'USD' ? 'USD' : 'PEN') === m).reduce((n, d) => n + d.monto, 0)
  const montos = (['PEN', 'USD'] as const).filter((m) => suma(m) > 0).map((m) => moneda(suma(m), m))
  const cuantos = `${documentos.length} ${documentos.length === 1 ? uno : varios}`
  return montos.length > 0 ? `${montos.join(' y ')} en ${cuantos}` : cuantos
}

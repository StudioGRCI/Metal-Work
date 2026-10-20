/**
 * Lo que comparten las pantallas de Facturación (Contabilidad) y de Tesorería.
 * Puro, sin consultas: lo usan el servidor y el navegador. Las mismas cifras
 * las exige la base (migraciones 20261015120000 a 20261015124000).
 */

import { moneda } from '@/lib/format'

type Tono = 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info' | 'acento'

/** El bucket privado de las facturas de venta: la ruta es `{factura}/{archivo}.pdf`. */
export const BUCKET_FACTURAS_VENTA = 'facturas-venta'

/** El bucket privado de los vouchers de cobro de las facturas de venta: la ruta es `{factura}/{archivo}`. */
export const BUCKET_COBROS_VENTA = 'cobros-venta'

/** El bucket privado de los comprobantes de pago de servicio: la ruta es `{orden de servicio}/{archivo}`. */
export const BUCKET_PAGOS_SERVICIO = 'pagos-servicio'

/** El bucket privado de los vouchers con que Tesorería paga las facturas de compra: la ruta es `{factura}/{archivo}`. */
export const BUCKET_PAGOS_FACTURAS = 'pagos-facturas'

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
  return `${base}: ${sobra ? 'sobran' : 'faltan'} ${dinero(Math.abs(c.diferencia))}.${marcarParcial}`
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

import type { Tono } from '@/components/ui/etiqueta-estado'
import { moneda } from '@/lib/format'

/**
 * La detracción (SPOT) de una orden de servicio: quien contrata deposita un
 * porcentaje del total con IGV en la cuenta de detracciones del proveedor en el
 * Banco de la Nación, en soles enteros, cuando el total pasa del mínimo de
 * SUNAT. La base hace la cuenta en `ordenes_servicio.detraccion_monto`; aquí se
 * repite solo para mostrarla mientras se llena el formulario. Sin zod: lo
 * importan también los formularios del navegador.
 */
export const NO_SUJETA = 'NO_SUJETA'
export const IGV = 0.18

export type TipoDetraccion = {
  codigo: string
  descripcion: string
  porcentaje: number
  monto_minimo: number
  ejemplos: string
  base_legal: string
}

/** El total con IGV y, si pasa del mínimo, lo que se deposita. */
export function calcularDetraccion(montoSinIgvPen: number | null, porcentaje: number, minimo: number) {
  if (montoSinIgvPen === null || !Number.isFinite(montoSinIgvPen) || montoSinIgvPen < 0) return null
  const total = Math.round(montoSinIgvPen * (1 + IGV) * 100) / 100
  return { total, monto: total > minimo ? Math.round((total * porcentaje) / 100) : null }
}

export type DetraccionDeServicio = {
  afecta: boolean | null
  codigo: string | null
  descripcion: string | null
  porcentaje: number | null
  minimo: number | null
  motivo: string | null
  total_con_igv_pen: number | null
  monto: number | null
}

/** Lo que la OS dice de su detracción, en una línea y su detalle. */
export function resumenDetraccion(d: DetraccionDeServicio): { texto: string; detalle: string | null; tono: Tono } {
  if (d.afecta === null) {
    return { texto: 'Detracción sin definir', detalle: 'Logística tiene que decir si lleva detracción.', tono: 'aviso' }
  }
  if (!d.afecta) return { texto: 'No sujeta a detracción', detalle: d.motivo, tono: 'neutro' }
  const tipo = [d.codigo, d.descripcion].filter(Boolean).join(' · ')
  const porcentaje = `${d.porcentaje ?? 0} %`
  if (d.total_con_igv_pen === null) {
    return { texto: `Detracción ${porcentaje}: falta el tipo de cambio`, detalle: tipo, tono: 'aviso' }
  }
  if (d.monto === null) {
    return {
      texto: `Sin detracción: no pasa de ${moneda(d.minimo ?? 0)}`,
      detalle: `${tipo} · ${porcentaje} · con IGV suma ${moneda(d.total_con_igv_pen)}`,
      tono: 'neutro',
    }
  }
  return {
    texto: `Detracción ${porcentaje}: ${moneda(d.monto)}`,
    detalle: `${tipo} · sobre ${moneda(d.total_con_igv_pen)} con IGV`,
    tono: 'info',
  }
}

/**
 * Lo que se debe de una orden de servicio, como lo da `saldos_de_servicios()`
 * (migración 20261026100000): el total con IGV, la detracción en soles y en la
 * moneda de la orden, lo que va al proveedor (el total menos la detracción) y lo
 * que falta de cada parte. Lo de la detracción, en soles.
 */
export type SaldoDeServicio = {
  total: number
  detraccion: number
  detraccionEnMoneda: number
  alProveedor: number
  pagadoProveedor: number
  pagadoDetraccion: number
  saldoProveedor: number
  saldoDetraccion: number
}

export type DestinoPagoServicio = 'PROVEEDOR' | 'DETRACCION'

/** Lo que falta de la orden entera, en su moneda: al proveedor, más la detracción que falta pasada a esa moneda. */
export function faltaDelServicio(s: SaldoDeServicio): number {
  const detraccion = s.detraccion > 0 ? (s.saldoDetraccion * s.detraccionEnMoneda) / s.detraccion : 0
  return Math.round((s.saldoProveedor + detraccion) * 100) / 100
}

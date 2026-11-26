import type { Tono } from '@/components/ui/etiqueta-estado'
import { fecha, moneda, parteDe, porcentaje as pct, porcentajeCorto } from '@/lib/format'

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
  /**
   * El día cuyo tipo de cambio le toca a la OS en dólares: la fecha de emisión de
   * su factura (20261126947000) o, sin factura, el día en que se emitió la OS
   * (20261126626000). El aviso dice cuál falta.
   */
  dia_del_cambio?: string | null
  /**
   * De dónde sale ese día en la OS en otra moneda: de su factura; del día en que se emitió porque
   * todavía no tiene factura (el monto en soles y la detracción cambian cuando llegue); o de antes,
   * porque su detracción ya estaba depositada, o la OS ya pagada, cuando la factura llegó
   * (`DEPOSITADA_ANTES`: sigue con el día en que se emitió) o cuando se cambió por otra
   * (`DEPOSITADA_CON_OTRA`: sigue con el día de la factura de entonces). `FACTURA_SIN_FECHA`: la
   * factura se adjuntó antes de que se pidiera su fecha. `DEPOSITADA_CON_OTRO_CAMBIO`: el día es el
   * de su factura, pero el cambio de ese día se registró o se corrigió con la detracción ya
   * depositada, y sigue con el de antes. Null o ausente, en soles.
   */
  origen_del_cambio?: OrigenDelCambio | null
  /**
   * El día del cambio registrado del que sale de verdad su monto en soles. Con factura es anterior
   * al de la factura mientras el de ese día no se registre (la factura de hoy llega antes que el
   * cambio de hoy); sin factura es el último que había al emitirla, que puede no ser el de su día.
   * Null o ausente: no se leyó, o no sale de ninguno de los que se leyeron.
   */
  cambio_registrado_el?: string | null
}

export type OrigenDelCambio = 'FACTURA' | 'SIN_FACTURA' | 'FACTURA_SIN_FECHA' | 'DEPOSITADA_ANTES' | 'DEPOSITADA_CON_OTRA' | 'DEPOSITADA_CON_OTRO_CAMBIO'

/** «23/11/2026, la fecha de su factura» o «23/11/2026»: el día del cambio, como se le dice a quien paga. */
export function diaDelCambio(d: Pick<DetraccionDeServicio, 'dia_del_cambio' | 'origen_del_cambio'>): string | null {
  if (!d.dia_del_cambio) return null
  return `${fecha(d.dia_del_cambio)}${d.origen_del_cambio === 'FACTURA' ? ', la fecha de su factura' : ''}`
}

/**
 * La OS va con el cambio de un día anterior al de su factura porque el de ese día todavía no se
 * registró: los dos días, ya escritos. Null si va con el de su factura o no se sabe.
 */
export function cambioDeLaVispera(d: Pick<DetraccionDeServicio, 'dia_del_cambio' | 'origen_del_cambio' | 'cambio_registrado_el'>): { usado: string; factura: string } | null {
  if (d.origen_del_cambio !== 'FACTURA' || !d.dia_del_cambio || !d.cambio_registrado_el) return null
  if (d.cambio_registrado_el === d.dia_del_cambio) return null
  return { usado: fecha(d.cambio_registrado_el), factura: fecha(d.dia_del_cambio) }
}

/**
 * Con qué tipo de cambio se hizo la cuenta de la OS en otra moneda, al final del detalle. Sin su
 * factura el monto es provisional y se dice: Tesorería depositaba una detracción que la factura
 * iba a cambiar sin que nada lo avisara (auditoría de diseño del 2026-11-26).
 */
function conQueCambio(d: DetraccionDeServicio): string {
  if (!d.dia_del_cambio || !d.origen_del_cambio) return ''
  const dia = `con el tipo de cambio del ${fecha(d.dia_del_cambio)}`
  // La OS sin factura se emitió con el último cambio que había: se nombra ese día, no el suyo, y
  // si no se sabe cuál fue no se nombra ninguno (decía «del 26/11» con la cifra del 25/11).
  const alEmitir = !d.cambio_registrado_el
    ? 'con el tipo de cambio con que se emitió'
    : d.cambio_registrado_el === d.dia_del_cambio
      ? `${dia}, el día en que se emitió`
      : `con el tipo de cambio del ${fecha(d.cambio_registrado_el)}, el último registrado cuando se emitió`
  if (d.origen_del_cambio === 'FACTURA') {
    // El cambio del día de la factura todavía no está: va con el último registrado, y se dice cuál.
    const vispera = cambioDeLaVispera(d)
    return vispera ? ` · con el tipo de cambio del ${vispera.usado}, el último registrado hasta el ${vispera.factura}, la fecha de su factura` : ` · ${dia}, la fecha de su factura`
  }
  // Lo que fija el cambio es el depósito de la detracción o el pago que canceló la OS: la que no
  // deposita nada (no pasa del mínimo) solo pudo quedar fija por estar pagada.
  const fija = d.monto === null ? 'la orden ya estaba pagada' : 'su detracción ya estaba depositada'
  if (d.origen_del_cambio === 'DEPOSITADA_ANTES') return ` · ${alEmitir}: ${fija} cuando llegó su factura`
  // La factura de ese día ya no es la vigente: nombrarla como «su factura» apuntaba a una anulada.
  if (d.origen_del_cambio === 'DEPOSITADA_CON_OTRA') return ` · ${dia}: ${fija} cuando se anuló o se cambió su factura`
  if (d.origen_del_cambio === 'DEPOSITADA_CON_OTRO_CAMBIO') {
    return ` · con el tipo de cambio que había cuando ${d.monto === null ? 'se pagó la orden' : 'se depositó su detracción'}, no el que hoy tiene el ${fecha(d.dia_del_cambio)}, la fecha de su factura`
  }
  if (d.origen_del_cambio === 'FACTURA_SIN_FECHA') return ` · ${alEmitir}: su factura se adjuntó sin fecha de emisión`
  return ` · ${alEmitir}: falta su factura`
}

/** Lo que la OS dice de su detracción, en una línea y su detalle. */
export function resumenDetraccion(d: DetraccionDeServicio): { texto: string; detalle: string | null; tono: Tono } {
  if (d.afecta === null) {
    return { texto: 'Detracción sin definir', detalle: 'Logística tiene que decir si lleva detracción.', tono: 'aviso' }
  }
  if (!d.afecta) return { texto: 'No sujeta a detracción', detalle: d.motivo, tono: 'neutro' }
  const tipo = [d.codigo, d.descripcion].filter(Boolean).join(' · ')
  const porcentaje = porcentajeCorto(d.porcentaje)
  if (d.total_con_igv_pen === null) {
    // Tesorería, que lo ve, no registra el cambio: el detalle dice de qué día y quién (DKS,
    // 2026-11-26). La insignia no lleva la fecha: no se parte y salía de la tarjeta en el teléfono.
    const dia = d.dia_del_cambio ? ` del ${diaDelCambio(d)}` : ''
    return {
      texto: `Detracción ${porcentaje}: falta el tipo de cambio`,
      detalle: `${tipo ? `${tipo}. ` : ''}Falta el tipo de cambio${dia}: lo registran Contabilidad o Administración.`,
      tono: 'aviso',
    }
  }
  // El IGV que va dentro del total: lo que se lee en la factura (DKS, 27/10/2026: porcentaje y costo).
  const igv = Math.round((d.total_con_igv_pen - d.total_con_igv_pen / (1 + IGV)) * 100) / 100
  if (d.monto === null) {
    return {
      texto: `Sin detracción: no pasa de ${moneda(d.minimo ?? 0)}`,
      detalle: `${tipo} · ${porcentaje} · con IGV suma ${moneda(d.total_con_igv_pen)} (IGV ${moneda(igv)})${conQueCambio(d)}`,
      tono: 'neutro',
    }
  }
  const alProveedor = Math.round((d.total_con_igv_pen - d.monto) * 100) / 100
  return {
    texto: `Detracción ${porcentaje}: ${moneda(d.monto)}`,
    // En otra moneda se dice con el cambio de qué día: el de su factura es otro que el del día en que se emitió.
    detalle: `${tipo} · sobre ${moneda(d.total_con_igv_pen)} con IGV (IGV ${moneda(igv)}) · al proveedor ${moneda(alProveedor)} · ${pct(parteDe(alProveedor, d.total_con_igv_pen))}${conQueCambio(d)}`,
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

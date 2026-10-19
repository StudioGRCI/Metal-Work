import type { Tono } from '@/components/ui/etiqueta-estado'
import type { CodigoMoneda } from '@/lib/format'

/*
 * La caja diaria de Tesorería (migración 20261017200000): las etiquetas y las
 * sumas que usan la pantalla y sus formularios. Va aquí y no en un archivo
 * 'use client' porque las llaman los dos lados.
 */

export const TIPO_CUENTA: Record<string, string> = { BANCO: 'Banco', EFECTIVO: 'Efectivo' }

/** De dónde viene cada movimiento. Los del sistema los deja su pago o su cobro (migración 20261017220000). */
export const ORIGEN_MOVIMIENTO: Record<string, string> = {
  MANUAL: 'Registrado en la caja',
  TRANSFERENCIA: 'Transferencia',
  PAGO_ADQUISICION: 'Pago de factura de compra',
  PAGO_ORDEN_SERVICIO: 'Pago de orden de servicio',
  PAGO_RECIBO_HONORARIOS: 'Pago de recibo por honorarios',
  PAGO_PLANILLA_DIARIA: 'Pago de planilla diaria',
  COBRO_FACTURA_VENTA: 'Cobro de factura de venta',
}

/**
 * Dónde se anula el movimiento que dejó un pago o un cobro: en la caja no se
 * anula suelto, se anula su pago (y el pago anulado lo saca de la caja).
 */
export const PANTALLA_DEL_ORIGEN: Record<string, { ruta: string; nombre: string }> = {
  PAGO_ADQUISICION: { ruta: '/tesoreria/por-pagar', nombre: 'Cuentas por pagar' },
  PAGO_ORDEN_SERVICIO: { ruta: '/tesoreria/pagos-de-servicio', nombre: 'Pagos de servicio' },
  PAGO_RECIBO_HONORARIOS: { ruta: '/tesoreria/recibos-por-honorarios', nombre: 'Recibos por honorarios' },
  PAGO_PLANILLA_DIARIA: { ruta: '/planilla-diaria', nombre: 'Planilla diaria' },
  COBRO_FACTURA_VENTA: { ruta: '/tesoreria/por-cobrar', nombre: 'Cuentas por cobrar' },
}

/** Una cuenta activa de la caja, para elegir de cuál salió un pago o a cuál entró un cobro. */
export type CuentaParaPagar = {
  id: string
  nombre: string
  tipo: string
  banco: string | null
  moneda: CodigoMoneda
  /** El día de su saldo inicial: un pago de antes ya está en ese saldo y no la mueve. */
  fecha_inicio: string
  /** El último día cerrado: un pago de ese día o de antes ya no entra. */
  cerrada_hasta: string | null
}

/** Lo que se repite cada día en el estado de cuenta, para escribirlo igual siempre. */
export const DESCRIPCIONES_FRECUENTES = [
  'ITF',
  'Comisión de mantenimiento',
  'Envío de estado de cuenta',
  'Reposición de caja chica',
  'Retiro en ventanilla',
  'Planilla',
  'Recibo por honorarios',
  'Letra',
]

export function monedaDeCuenta(m: string | null | undefined): CodigoMoneda {
  return m === 'USD' ? 'USD' : 'PEN'
}

export function nombreMoneda(m: string | null | undefined) {
  return m === 'USD' ? 'dólares' : 'soles'
}

/** «BCP · soles», «Efectivo · soles». */
export function detalleDeCuenta(c: { tipo: string; banco: string | null; moneda: string }) {
  return `${c.tipo === 'BANCO' ? c.banco || 'Banco' : 'Efectivo'} · ${nombreMoneda(c.moneda)}`
}

export type EstadoDelDia = { etiqueta: string; tono: Tono }

/**
 * Cómo está el día de una cuenta: antes de que empiece, cerrado o abierto. Un
 * día abierto es lo normal mientras se trabaja; solo avisa en amarillo el de
 * un día que ya pasó con movimientos sin cerrar.
 */
export function estadoDelDia(
  c: { fecha_inicio: string; cierre_id: string | null; ultimo_cierre: string | null; movimientos: number },
  dia: string,
  hoy: string,
): EstadoDelDia {
  if (dia < c.fecha_inicio) return { etiqueta: 'Todavía no empieza', tono: 'neutro' }
  if (c.cierre_id) return { etiqueta: 'Cerrado', tono: 'exito' }
  if (c.ultimo_cierre && dia <= c.ultimo_cierre) return { etiqueta: 'Cerrado', tono: 'exito' }
  return { etiqueta: 'Abierto', tono: dia < hoy && c.movimientos > 0 ? 'aviso' : 'neutro' }
}

/**
 * El consolidado del día, como el pie de la hoja del Excel: lo que hay en
 * soles, lo que hay en dólares y todo junto en soles con el cambio de compra
 * del día (lo que vale un dólar que la empresa tiene). Sin cambio, el total en
 * soles no se inventa: queda `null` y la pantalla dice que falta.
 */
export function consolidado(
  cuentas: { moneda: string; saldo_final: number | null }[],
  cambioCompra: number | null,
) {
  let soles = 0
  let dolares = 0
  for (const c of cuentas) {
    if (c.saldo_final === null) continue
    if (c.moneda === 'USD') dolares += c.saldo_final
    else soles += c.saldo_final
  }
  const redondear = (n: number) => Math.round(n * 100) / 100
  return {
    soles: redondear(soles),
    dolares: redondear(dolares),
    totalEnSoles: cambioCompra ? redondear(soles + dolares * cambioCompra) : dolares === 0 ? redondear(soles) : null,
  }
}

/**
 * «1,250.50» o «1250,50» → «1250.50»: la gente copia los montos del estado de
 * cuenta. La usan la acción, que manda el monto a la base, y la vista previa
 * del cierre, que calcula la diferencia: si leyeran distinto, la pantalla
 * pediría observaciones por una diferencia que no existe.
 */
export function normalizarMonto(texto: string) {
  const t = texto.replace(/\s/g, '')
  if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return t.replace(/,/g, '')
  if (/^-?\d+,\d{1,2}$/.test(t)) return t.replace(',', '.')
  return t
}

/** Un monto de la caja como lo escribe la gente: dígitos, punto decimal y hasta dos decimales. */
export const MONTO = /^\d{1,9}(?:\.\d{1,2})?$/
/** El saldo puede ser negativo: un sobregiro. */
export const SALDO = /^-?\d{1,9}(?:\.\d{1,2})?$/

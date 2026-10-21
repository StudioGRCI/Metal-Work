import { moneda, type CodigoMoneda } from '@/lib/format'

/*
 * Lo que pasa con una OC con boleta cuando el proveedor devuelve lo pagado
 * (undécima vuelta, migración 20261020210000): la ventana «Registrar
 * devolución» lo dice en vivo, con el monto que se va escribiendo, y la de
 * «Anular la devolución», con el que se anula; la de «Anular el pago», sin ese
 * pago. Es la misma cuenta que hace la
 * base al conciliar: lo neto (lo pagado menos lo devuelto), menos lo que se
 * pasó a mano a una factura, es lo que la factura toma sola, hasta lo que le
 * falta; lo que sobra queda pagado de más. Va aquí y no en el formulario, que es
 * 'use client': la página también la llama.
 */

/** Lo que hace falta de la tarjeta de la OC con boleta para la cuenta. */
export type BoletaParaDevolver = {
  total: number
  /** Lo neto: los pagos vigentes menos lo devuelto. */
  neto: number
  /** Lo que la factura tomó de la boleta, sola o a mano. */
  aplicado: number
  /** Lo pasado a mano: al cambio a su factura en otra moneda, o descontado en otra factura. */
  aMano: number
  /** Lo descontado en otras facturas del proveedor (va también en `aMano`). */
  aOtras: number
  factura: string | null
  /** Lo que les falta a sus facturas de la moneda de la OC. */
  facturaSaldo: number
  deMas: number
  sinTomar: number
  otraMoneda: boolean
  otraFactura: string | null
  /** Un pago vigente la dio por cancelada con menos del total. */
  sinCompletar: boolean
  /** Alguna de sus facturas la cubre entera: lo que sobra es de más; si todas son parciales, espera la que falta. */
  entera: boolean
}

const centimos = (n: number) => Math.round(n * 100) / 100

type Cuenta =
  | { tipo: 'otra'; factura: string; sinTomar: number }
  | { tipo: 'factura'; factura: string; toma: number; falta: number; deMas: number }
  | { tipo: 'sin'; saldo: number }

/**
 * La cuenta de la base con `delta` más de lo neto. Lo pagado de más se marca
 * desde un sol, como en la base. Sin una factura que la cubra entera, lo que
 * sobra no es de más: falta la otra factura.
 */
function cuenta(b: BoletaParaDevolver, delta: number): Cuenta {
  const neto = centimos(b.neto + delta)
  const libre = Math.max(centimos(neto - b.aMano), 0)
  // La factura en otra moneda no toma sola: lo que quede espera que Tesorería se lo pase al cambio.
  const sinTomar = Math.max(centimos(b.sinTomar + delta), 0)
  if (b.factura && (b.otraMoneda || (b.otraFactura !== null && sinTomar > 0))) {
    return { tipo: 'otra', factura: b.otraFactura ?? b.factura, sinTomar }
  }
  if (b.factura) {
    // Lo que la factura toma sola es lo que ya tomó sin contar lo pasado a mano, más lo que le falta.
    const aManoPropio = centimos(b.aMano - b.aOtras)
    const cabe = centimos(b.aplicado - aManoPropio + b.facturaSaldo)
    const toma = Math.min(libre, cabe)
    const sobra = centimos(libre - toma)
    return { tipo: 'factura', factura: b.factura, toma, falta: centimos(cabe - toma), deMas: sobra >= 1 && b.entera ? sobra : 0 }
  }
  return { tipo: 'sin', saldo: b.sinCompletar && neto > 0 ? 0 : Math.max(centimos(b.total - neto), 0) }
}

/** Cómo queda la OC con `delta` más de lo neto: −monto al registrar una devolución, +monto al anularla. */
export function queQuedaTrasLaDevolucion(b: BoletaParaDevolver, delta: number, m: CodigoMoneda): string {
  const r = cuenta(b, delta)
  if (r.tipo === 'otra') {
    return r.sinTomar > 0
      ? `Quedan ${moneda(r.sinTomar, m)} pagados por la boleta sin pasar a su factura ${r.factura}.`
      : `Ya no queda nada pagado por la boleta sin pasar a su factura ${r.factura}.`
  }
  if (r.tipo === 'factura') {
    if (r.falta > 0) {
      return `Su factura ${r.factura} toma ${moneda(r.toma, m)} y le faltan ${moneda(r.falta, m)}, que se pagan en «Facturas por pagar».`
    }
    return r.deMas > 0 ? `Quedan ${moneda(r.deMas, m)} pagados de más.` : 'Ya no queda nada pagado de más.'
  }
  return r.saldo > 0 ? `La OC queda debiendo ${moneda(r.saldo, m)}.` : 'La OC sigue pagada.'
}

/** Lo que una factura tomó de un pago por la boleta, en la moneda de la OC. */
export type TomaParaLaCuenta = { aMano: boolean; deLaCompra: boolean; deLaBoleta: number; factura: string }

/**
 * Lo que dice la ventana «Anular el pago» de una OC con su factura: la misma
 * cuenta sin ese pago, y sin lo que sus facturas tomaban de él. Lo que tomaba
 * al cambio deja a su factura en otra moneda esperando lo que quede. Solo dice
 * lo pagado de más si lo había o lo habrá.
 */
export function queQuedaSinElPago(b: BoletaParaDevolver, monto: number, tomas: TomaParaLaCuenta[], m: CodigoMoneda): string {
  const suma = (cumple: (t: TomaParaLaCuenta) => boolean) => centimos(tomas.filter(cumple).reduce((s, t) => s + t.deLaBoleta, 0))
  const sola = suma((t) => !t.aMano)
  const alCambio = suma((t) => t.aMano && t.deLaCompra)
  const descontado = suma((t) => !t.deLaCompra)
  const r = cuenta(
    {
      ...b,
      aplicado: centimos(b.aplicado - sola - alCambio),
      aMano: centimos(b.aMano - alCambio - descontado),
      aOtras: centimos(b.aOtras - descontado),
      facturaSaldo: centimos(b.facturaSaldo + sola),
      // Lo que tomaban de este pago vuelve a quedar sin tomar, y el pago se va con `delta`.
      sinTomar: centimos(b.sinTomar + sola + alCambio + descontado),
      otraFactura: b.otraFactura ?? (alCambio > 0 ? (tomas.find((t) => t.aMano && t.deLaCompra)?.factura ?? null) : null),
    },
    -monto,
  )
  if (r.tipo === 'otra') {
    return r.sinTomar > 0
      ? `Quedan ${moneda(r.sinTomar, m)} pagados por la boleta sin pasar a su factura ${r.factura}.`
      : `Su factura ${r.factura} se paga en «Facturas por pagar».`
  }
  if (r.tipo === 'factura') {
    if (r.falta > 0) return `Su factura ${r.factura} deja de tomar este pago y le faltan ${moneda(r.falta, m)}: se pagan en «Facturas por pagar».`
    if (r.deMas > 0) return `Quedan ${moneda(r.deMas, m)} pagados de más.`
    if (b.deMas > 0) return 'Ya no queda nada pagado de más.'
    return r.toma > 0 ? `Su factura ${r.factura} sigue pagada con los otros pagos por la boleta.` : ''
  }
  return r.saldo > 0 ? `La OC vuelve a deber ${moneda(r.saldo, m)}.` : 'La OC sigue pagada.'
}

/** Lo más que se puede registrar como devuelto: lo neto, menos lo que se pasó a mano a una factura. */
export function topeDeLaDevolucion(b: Pick<BoletaParaDevolver, 'neto' | 'aMano'>): number {
  return Math.max(centimos(b.neto - b.aMano), 0)
}

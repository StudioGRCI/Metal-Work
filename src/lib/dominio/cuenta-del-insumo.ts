/**
 * Cuánto se pidió de un insumo del RQ, cuánto ya se entregó y dónde está lo que
 * falta, en cifras (plan 2, entrega 2.1). Almacén lo lee en Atención de
 * requerimiento para saber qué falta entregar de cada RQ sin abrir el kardex.
 *
 * Sale de las partes que ya pinta la tarjeta del RQ (`partesDelInsumo`), para
 * que las dos pantallas digan lo mismo:
 *
 * - `separado`: lo que ya está en almacén para este RQ y todavía no se entregó
 *   (lo que Almacén separó de su stock y lo que llegó de su compra).
 * - `porLlegar`: lo que va en una orden de compra viva y todavía no entra.
 * - `porComprar`: lo que falta y no va en ninguna compra viva: sin OC, con la OC
 *   rechazada o anulada, o la OC ya entró entera y compró menos.
 * - `porRevisar`: Almacén todavía no dice si lo tiene.
 *
 * Suman lo que falta: `separado + porLlegar + porComprar + porRevisar = falta`.
 * Va sin alias de importación para probarlo con `node --test`.
 */
export type CuentaDelInsumo = {
  pedido: number
  entregado: number
  falta: number
  separado: number
  porLlegar: number
  porComprar: number
  porRevisar: number
}

/** Las cantidades van a tres decimales: 5.3 − 2.1 no es 3.1999999999999997. */
const redondear = (n: number) => Math.round(n * 1000) / 1000

export function cuentaDelInsumo(
  pedido: number,
  partes: { entregado: number; recoger: number; porLlegar: number; revisar: number },
  /** Lo que falta va en una OC viva que todavía puede traerlo. */
  compraViva: boolean,
): CuentaDelInsumo {
  const total = redondear(Math.max(pedido, 0))
  const entregado = redondear(Math.min(Math.max(partes.entregado, 0), total))
  const falta = redondear(total - entregado)
  const separado = redondear(Math.min(Math.max(partes.recoger, 0), falta))
  const porRevisar = redondear(Math.min(Math.max(partes.revisar, 0), falta - separado))
  const sinLlegar = redondear(Math.min(Math.max(partes.porLlegar, 0), falta - separado - porRevisar))
  return {
    pedido: total,
    entregado,
    falta,
    separado,
    porLlegar: compraViva ? sinLlegar : 0,
    porComprar: compraViva ? 0 : sinLlegar,
    porRevisar,
  }
}

/** Cómo va la entrega, en una frase: «Entregado 4 de 10», «Entregado completo», «Nada entregado». */
export function comoVaLaEntrega(c: CuentaDelInsumo): 'COMPLETA' | 'PARCIAL' | 'NADA' {
  if (c.falta === 0 && c.pedido > 0) return 'COMPLETA'
  return c.entregado > 0 ? 'PARCIAL' : 'NADA'
}

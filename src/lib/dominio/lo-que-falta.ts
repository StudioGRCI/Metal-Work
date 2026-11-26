/*
 * Qué le falta a cada documento por pagar para que el dinero salga, y de quién
 * (plan 11, entrega 11.2): la factura que registra Contabilidad, la aprobación
 * de Gerencia, lo que Logística tiene que completar o, si ya no espera a nadie,
 * el pago con su voucher, que es de Tesorería.
 *
 * Las reglas no se inventan aquí: cada caso es uno que la base ya rechaza o
 * pide (los disparadores y funciones de pago, comentados al lado), dicho antes
 * de que Tesorería intente pagar. La regla que hace esperar a Gerencia es la de
 * `regla_aprobacion_compras` (`evaluar_aprobacion_compra`): con la regla activa,
 * toda OC desde su monto la aprueba el puesto que dice la regla; la factura de
 * una OC por aprobar no se paga (`fn_pago_factura_oc_aprobada`), ni la OC con
 * boleta (`registrar_pago_compra`), ni la OS (`registrar_pago_servicio`).
 *
 * Funciones puras: las usan las pantallas y `lo-que-falta.test.mjs`.
 */

export type QuienLoTiene = 'Contabilidad' | 'Gerencia' | 'Logística' | 'Tesorería'

/** Una cosa que falta: qué es, quién la tiene y, si se sabe, desde cuándo y cuántos días lleva. */
export type LoQueFalta = {
  que: string
  quien: QuienLoTiene
  /** Lo demás espera esto: sin ello la base no deja pagar. */
  traba: boolean
  desde?: string | null
  dias?: number | null
}

type OcDeLaFactura = { nombre: string; aprobacion: string | null; pedidaEn?: string | null; dias?: number | null }

/** Las OC de una factura que Gerencia todavía no aprueba, rechazó o se anularon. */
export function ocsQueTraban<T extends { aprobacion: string | null }>(ordenes: readonly T[]): T[] {
  return ordenes.filter((o) => o.aprobacion !== null && o.aprobacion !== 'APROBADA' && o.aprobacion !== 'NO_REQUERIDA')
}

const juntar = (nombres: string[]) => (nombres.length <= 1 ? (nombres[0] ?? '') : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`)

/** La factura de compra registrada (Facturas por pagar). */
export function faltaDeLaFactura(f: {
  saldo: number
  /** La OC con boleta se dio por pagada fuera: Contabilidad dice si se pagó (`fn_pago_factura_en_espera`). */
  enEspera: boolean
  ordenes: readonly OcDeLaFactura[]
  /** Espera lo pagado por la boleta de su OC, en otra moneda (`fn_factura_sin_pago_directo`). */
  esperaLaBoleta: boolean
}): LoQueFalta[] {
  if (f.saldo <= 0) return []
  if (f.enEspera) return [{ que: 'que diga si la OC con boleta ya se pagó fuera del sistema', quien: 'Contabilidad', traba: true }]
  const traban = ocsQueTraban(f.ordenes)
  const rechazada = traban.find((o) => o.aprobacion === 'RECHAZADA' || o.aprobacion === 'ANULADA')
  if (rechazada) {
    return [{
      que: `ver con el proveedor qué pasa con la factura: la ${rechazada.nombre} está ${rechazada.aprobacion === 'ANULADA' ? 'anulada' : 'rechazada'} y no se paga`,
      quien: 'Contabilidad',
      traba: true,
    }]
  }
  if (traban.length > 0) {
    // Los días, los de la que espera desde antes.
    const primera = [...traban].sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))[0]
    return [{
      que: `la aprobación de la ${juntar(traban.map((o) => o.nombre))}`,
      quien: 'Gerencia',
      traba: true,
      desde: primera.pedidaEn ?? null,
      dias: primera.dias ?? null,
    }]
  }
  if (f.esperaLaBoleta) return [{ que: 'pasar a esta factura lo pagado por la boleta, al cambio', quien: 'Tesorería', traba: true }]
  return [{ que: 'el pago, con su voucher', quien: 'Tesorería', traba: false }]
}

/** La OC con boleta, que Tesorería paga directo («OC con boleta por pagar»). */
export function faltaDeLaBoleta(b: {
  saldo: number
  cancelada: boolean
  /** Contabilidad tiene su comprobante en borrador o Logística anexó la factura (`comprobante_en_camino`). */
  comprobanteEnCamino: boolean
  /** Ya tiene factura registrada: se paga por ella. */
  conFactura: boolean
  /** Logística anexó una factura de otras OC que no alcanza para esta. */
  anexoPorRevisar: boolean
  sinPrecio: boolean
  sinBoleta: boolean
  devuelta: boolean
  deMas: number
  otraMoneda: boolean
}): LoQueFalta[] {
  const falta: LoQueFalta[] = []
  if (b.deMas > 0) falta.push({ que: 'registrar la devolución de lo pagado de más, o descontarlo de otra factura', quien: 'Tesorería', traba: false })
  if (b.otraMoneda) falta.push({ que: 'pasar lo pagado a su factura en otra moneda, al cambio', quien: 'Tesorería', traba: false })
  if (b.cancelada || b.devuelta) return falta
  if (b.anexoPorRevisar) return [...falta, { que: 'revisar la factura que anexó: es de otras OC y no alcanza para esta', quien: 'Logística', traba: true }]
  if (b.comprobanteEnCamino) return [...falta, { que: 'registrar su comprobante: se paga por él, en Facturas por pagar', quien: 'Contabilidad', traba: true }]
  if (b.conFactura) return falta
  if (b.sinPrecio) return [...falta, { que: 'el precio de las líneas que no lo tienen', quien: 'Logística', traba: true }]
  if (b.sinBoleta) falta.push({ que: 'la boleta del proveedor: la adjunta en la OC cuando el proveedor la entregue', quien: 'Logística', traba: false })
  if (b.saldo > 0) falta.push({ que: 'el pago, con su voucher', quien: 'Tesorería', traba: false })
  return falta
}

/** La boleta de una parte de la OC que llega en partes. */
export function faltaDeLaParte(x: { saldo: number }): LoQueFalta[] {
  return x.saldo > 0 ? [{ que: 'el pago, con su voucher', quien: 'Tesorería', traba: false }] : []
}

/** La compra a crédito que todavía no tiene comprobante. */
export function faltaDeLaCompraACredito(): LoQueFalta[] {
  return [{ que: 'registrar la factura en Adquisiciones', quien: 'Contabilidad', traba: true }]
}

/** La orden de servicio aprobada (Pagos de servicio). Gerencia ya la aprobó: si no, no saldría. */
export function faltaDelServicio(s: {
  cancelada: boolean
  /** Quien mira puede adjuntarla él mismo (`tesoreria.pagar_servicios`). */
  adjuntaTesoreria?: boolean
  /** La factura o el recibo del proveedor, adjunto a la OS. */
  conComprobante: boolean
  conforme: boolean
  /** Ya se pagó todo a cuenta y ningún pago la canceló. */
  todoPagado: boolean
  saldoProveedor: number
  saldoDetraccion: number
}): LoQueFalta[] {
  if (s.cancelada) return []
  const falta: LoQueFalta[] = []
  if (!s.conComprobante) {
    falta.push({
      que: `la factura o el recibo del proveedor: la adjunta Logística en la OS${s.adjuntaTesoreria ? ', o tú aquí' : ''}`,
      quien: 'Logística',
      traba: false,
    })
  }
  if (!s.conforme) falta.push({ que: 'la conformidad del servicio', quien: 'Logística', traba: false })
  if (s.todoPagado) {
    falta.push({ que: 'anular el último pago y registrarlo otra vez con «Sí, queda pagada»', quien: 'Tesorería', traba: false })
    return falta
  }
  if (s.saldoDetraccion > 0) falta.push({ que: 'depositar la detracción en el Banco de la Nación, con su constancia', quien: 'Tesorería', traba: false })
  if (s.saldoProveedor > 0) falta.push({ que: 'el pago al proveedor, con su voucher', quien: 'Tesorería', traba: false })
  return falta
}

/** La regla de aprobación de compras vigente, como la guarda la base. */
export type ReglaDeAprobacion = { activa: boolean; montoDesde: number; puesto: string | null }

/**
 * La regla dicha en una línea, para la cabecera de «Facturas por pagar». Las OC
 * directas, sin requerimiento, las aprueba siempre (`evaluar_aprobacion_compra`).
 */
export function textoDeLaRegla(r: ReglaDeAprobacion): string {
  const quien = r.puesto ?? 'Gerencia'
  if (!r.activa) return `La regla de aprobación está apagada: ${quien} aprueba solo las OC directas, sin requerimiento. La factura de una OC sin aprobar no se paga.`
  const desde = r.montoDesde > 0 ? `desde S/ ${r.montoDesde.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'de cualquier monto'
  return `Regla vigente: ${quien} aprueba toda OC ${desde} y las OC directas. La factura de una OC sin aprobar no se paga.`
}

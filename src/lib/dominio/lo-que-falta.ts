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

/** El área que lo tiene. La aprobación es del puesto que dice la regla (hoy, Gerencia). */
export type QuienLoTiene = 'Contabilidad' | 'Gerencia' | 'Logística' | 'Tesorería' | (string & {})

/** Una cosa que falta: qué es, quién la tiene y, si se sabe, desde cuándo y cuántos días lleva. */
export type LoQueFalta = {
  que: string
  quien: QuienLoTiene
  /** Lo demás espera esto: sin ello la base no deja pagar. */
  traba: boolean
  desde?: string | null
  dias?: number | null
}

/**
 * La OC que traba el pago de la factura, como la dice la base
 * (`ocs_que_traban_las_facturas`, la misma regla que rechaza el pago).
 */
export type OcQueTraba = { id?: string | null; nombre: string; aprobacion: string | null; desde?: string | null; dias?: number | null }

/** Las OC de una factura que Gerencia todavía no aprueba, rechazó o se anularon. */
export function ocsQueTraban<T extends { aprobacion: string | null }>(ordenes: readonly T[]): T[] {
  return ordenes.filter((o) => o.aprobacion !== null && o.aprobacion !== 'APROBADA' && o.aprobacion !== 'NO_REQUERIDA')
}


/** La factura de compra registrada (Facturas por pagar). */
export function faltaDeLaFactura(f: {
  saldo: number
  /** La OC con boleta se dio por pagada fuera: Contabilidad dice si se pagó (`fn_pago_factura_en_espera`). */
  enEspera: boolean
  /** La OC que no deja pagarla, de la base: la de la factura, la vieja o la que la anexó (`fn_pago_factura_oc_aprobada`). */
  traba: OcQueTraba | null
  /** Espera lo pagado por la boleta de su OC, en otra moneda (`fn_factura_sin_pago_directo`). */
  esperaLaBoleta: boolean
  /** El puesto que aprueba las compras, según la regla. */
  aprueba?: string
}): LoQueFalta[] {
  if (f.saldo <= 0) return []
  if (f.enEspera) return [{ que: 'que diga si la OC con boleta ya se pagó fuera del sistema', quien: 'Contabilidad', traba: true }]
  const t = f.traba
  if (t && (t.aprobacion === 'RECHAZADA' || t.aprobacion === 'ANULADA')) {
    return [{
      que: `ver con el proveedor qué pasa con la factura: la ${t.nombre} está ${t.aprobacion === 'ANULADA' ? 'anulada' : 'rechazada'} y no se paga`,
      quien: 'Contabilidad',
      traba: true,
    }]
  }
  if (t) return [{ que: `la aprobación de la ${t.nombre}`, quien: f.aprueba ?? 'Gerencia', traba: true, desde: t.desde ?? null, dias: t.dias ?? null }]
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

/**
 * La compra a crédito que todavía no tiene comprobante. Si su OC espera a
 * Gerencia, eso va primero: aunque llegue la factura, no se paga sin la
 * aprobación (`fn_pago_factura_oc_aprobada`).
 */
export function faltaDeLaCompraACredito(oc: { nombre: string; aprobacion: string | null; desde?: string | null; dias?: number | null; aprueba?: string }): LoQueFalta[] {
  const factura: LoQueFalta = { que: 'registrar la factura en Adquisiciones', quien: 'Contabilidad', traba: true }
  if (oc.aprobacion === 'RECHAZADA' || oc.aprobacion === 'ANULADA') {
    return [{
      que: `ver qué pasa con la compra: la ${oc.nombre} está ${oc.aprobacion === 'ANULADA' ? 'anulada' : 'rechazada'} y no se paga`,
      quien: 'Logística',
      traba: true,
    }]
  }
  if (oc.aprobacion === 'POR_APROBAR') {
    return [{ que: `la aprobación de la ${oc.nombre}`, quien: oc.aprueba ?? 'Gerencia', traba: true, desde: oc.desde ?? null, dias: oc.dias ?? null }, factura]
  }
  return [factura]
}

/** La orden de servicio aprobada (Pagos de servicio). Gerencia ya la aprobó: si no, no saldría. */
export function faltaDelServicio(s: {
  cancelada: boolean
  /** La factura o el recibo del proveedor, adjunto a la OS. */
  conComprobante: boolean
  conforme: boolean
  /** Ya se pagó todo a cuenta y ningún pago la canceló. */
  todoPagado: boolean
  saldoProveedor: number
  saldoDetraccion: number
  /** Logística no dijo si la OS lleva detracción (`afecta` vacío). */
  detraccionSinDefinir?: boolean
  /**
   * Lleva detracción y es en dólares, pero no tiene monto en soles: falta el tipo de cambio del día en
   * que se emitió. No se sabe cuánto va al Banco de la Nación, así que no se paga.
   */
  sinTipoDeCambio?: boolean
  /** Ese día, ya escrito como fecha (DD/MM/AAAA): Tesorería no ve la pantalla del tipo de cambio. */
  cambioDel?: string | null
  /**
   * Está en otra moneda, lleva detracción y todavía no tiene su factura: el monto en soles y la
   * detracción salen del tipo de cambio del día en que se emitió, y la fecha de la factura los cambia
   * mientras la detracción no esté depositada (20261126947000). Quien la deposita antes lo tiene que saber.
   */
  cambioSinFactura?: boolean
  /** Lo mismo, pero la factura está: se adjuntó antes de que se pidiera su fecha de emisión. */
  facturaSinFecha?: boolean
  /**
   * Tiene su factura, pero el tipo de cambio de ese día todavía no se registró y va con el último
   * anterior (`usado`). Si la detracción se deposita así, queda fija con ese.
   */
  cambioDeLaVispera?: { usado: string; factura: string } | null
}): LoQueFalta[] {
  if (s.cancelada) return []
  const falta: LoQueFalta[] = []
  if (s.cambioSinFactura) {
    falta.push({
      que: 'la factura del proveedor, adjunta a la OS con su fecha de emisión: el tipo de cambio de ese día decide el monto en soles y la detracción',
      quien: 'Logística',
      traba: false,
    })
  } else if (s.facturaSinFecha) {
    falta.push({
      que: 'anular la factura adjunta y volver a adjuntarla con su fecha de emisión: el tipo de cambio de ese día decide el monto en soles y la detracción',
      quien: 'Logística',
      traba: false,
    })
  } else if (!s.conComprobante) {
    falta.push({ que: 'la factura o el recibo del proveedor, adjunto a la OS', quien: 'Logística', traba: false })
  }
  if (!s.conforme) falta.push({ que: 'la conformidad del servicio', quien: 'Logística', traba: false })
  if (s.detraccionSinDefinir) falta.push({ que: 'decir en la OS si lleva detracción', quien: 'Logística', traba: false })
  if (s.sinTipoDeCambio) {
    // Sin su monto en soles, la detracción no tiene monto: ni se paga ni se da por pagada. Desde la
    // 20261126626000, registrar el cambio del día en que se emitió se lo pone solo; lo registran
    // Contabilidad o Administración, y Tesorería tiene que saber cuál pedir (DKS, 2026-11-26).
    falta.push({
      que: `el tipo de cambio del ${s.cambioDel ?? 'día en que se emitió la OS'}: sin él la OS no tiene monto en soles ni se sabe la detracción, así que no se paga`,
      quien: 'Contabilidad o Administración',
      traba: true,
    })
    return falta
  }
  if (s.todoPagado) {
    // Ya se pagó todo pero ningún pago la canceló: otro pago no entra hasta rehacer el último.
    falta.push({ que: 'anular el último pago y registrarlo otra vez con «Sí, queda pagada»: se pagó todo, pero ningún pago la canceló', quien: 'Tesorería', traba: true })
    return falta
  }
  // El pago va después de la conformidad: antes, lo que falta es de Logística y a Tesorería no le toca.
  if (!s.conforme) return falta
  if (s.saldoDetraccion > 0) {
    falta.push({
      // Sin la factura el depósito sale con el cambio del día en que se emitió, y lo deja fijo.
      que:
        s.cambioSinFactura || s.facturaSinFecha
          ? 'depositar la detracción en el Banco de la Nación, con su constancia: si la depositas antes de que llegue la factura con su fecha, queda con el tipo de cambio del día en que se emitió la OS'
          : s.cambioDeLaVispera
            ? `depositar la detracción en el Banco de la Nación, con su constancia: el tipo de cambio del ${s.cambioDeLaVispera.factura}, la fecha de su factura, todavía no está registrado; si la depositas ahora, queda con el del ${s.cambioDeLaVispera.usado}`
            : 'depositar la detracción en el Banco de la Nación, con su constancia',
      quien: 'Tesorería',
      traba: false,
    })
  }
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

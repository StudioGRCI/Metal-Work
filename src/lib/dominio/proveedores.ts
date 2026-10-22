import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * El RUC con su dígito verificador de SUNAT. Es el gemelo de
 * `public.ruc_es_valido` en la base: aquí sirve para avisar mientras se
 * escribe; quien decide es la base, que rechaza el RUC mal copiado aunque la
 * pantalla lo dejara pasar.
 */
export function rucEsValido(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((total, peso, i) => total + Number(ruc[i]) * peso, 0)
  let digito = 11 - (suma % 11)
  if (digito === 10) digito = 0
  if (digito === 11) digito = 1
  return digito === Number(ruc[10])
}

/** «Contado» o «Crédito a 30 días», como se dice en Logística. */
export function condicionDePago(condicion: string | null | undefined, dias: number | null | undefined): string {
  if (condicion === 'CREDITO') return `Crédito a ${dias ?? 0} ${dias === 1 ? 'día' : 'días'}`
  return 'Contado'
}

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/** El estado de aprobación de una orden de compra, como lo lee Logística. */
export const APROBACION_COMPRA: Record<string, Def> = {
  NO_REQUERIDA: { etiqueta: 'Sin aprobación', tono: 'neutro', descripcion: 'No llegó al monto que pide aprobación.' },
  POR_APROBAR: { etiqueta: 'Por aprobar', tono: 'aviso', descripcion: 'Espera la aprobación antes de enviarse al proveedor.' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito', descripcion: 'Aprobada: ya se puede enviar y recibir.' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro', descripcion: 'Rechazada: sus líneas volvieron a quedar por comprar.' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro', descripcion: 'Anulada por Gerencia: sus líneas volvieron a quedar por comprar.' },
}

/** Una compra que no se envía, no se entrega ni se recibe: espera a Gerencia, o se rechazó o se anuló. */
export function compraDetenida(aprobacion: string | null | undefined): boolean {
  return aprobacion === 'POR_APROBAR' || aprobacion === 'RECHAZADA' || aprobacion === 'ANULADA'
}

/** Su PDF se descarga: la aprobada o sin aprobación, y la anulada, que sale con la marca ANULADA como evidencia. */
export function compraConPdf(aprobacion: string | null | undefined): boolean {
  return aprobacion !== 'POR_APROBAR' && aprobacion !== 'RECHAZADA'
}

/**
 * Los bancos con que trabaja la casa, para sugerir mientras se escribe. El
 * campo es libre: una caja o un banco que no esté aquí se escribe igual.
 */
export const BANCOS_SUGERIDOS = [
  'BCP',
  'BBVA',
  'INTERBANK',
  'SCOTIABANK',
  'BANBIF',
  'BANCO DE LA NACIÓN',
  'BANCO PICHINCHA',
  'CAJA TRUJILLO',
  'CAJA PIURA',
  'CAJA AREQUIPA',
] as const

/** «S/» o «US$», como se lee una cuenta en Tesorería. */
export function simboloMoneda(moneda: string | null | undefined): string {
  return moneda === 'USD' ? 'US$' : 'S/'
}

/** «BCP · S/ · 1912345678012», para mostrar una cuenta en una línea. */
export function resumenCuenta(c: { banco: string; moneda: string; numero_cuenta: string }): string {
  return `${c.banco} · ${simboloMoneda(c.moneda)} · ${c.numero_cuenta}`
}

/**
 * La cuenta que va en la OC: la activa en la moneda de la compra; si no hay,
 * la primera que tenga. Sin cuentas, ninguna.
 */
export function cuentaParaCompra<T extends { moneda: string }>(cuentas: T[], moneda: string): T | null {
  return cuentas.find((c) => c.moneda === moneda) ?? cuentas[0] ?? null
}

/** Qué comprobante se pide, en palabras de Logística y del conductor. */
export function comprobantePedido(conFactura: boolean): { etiqueta: string; pide: string } {
  return conFactura
    ? { etiqueta: 'Con factura', pide: 'Pide la factura.' }
    : { etiqueta: 'Sin factura', pide: 'Pide boleta, nota de venta o recibo: sin factura igual va un comprobante.' }
}

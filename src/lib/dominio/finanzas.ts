/**
 * Lo que comparten las pantallas de Facturación (Contabilidad) y de Tesorería.
 * Puro, sin consultas: lo usan el servidor y el navegador. Las mismas cifras
 * las exige la base (migración 20261015120000).
 */

type Tono = 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info' | 'acento'

/** El bucket privado de las facturas de venta: la ruta es `{factura}/{archivo}.pdf`. */
export const BUCKET_FACTURAS_VENTA = 'facturas-venta'

/** El bucket privado de los comprobantes de pago de servicio: la ruta es `{orden de servicio}/{archivo}`. */
export const BUCKET_PAGOS_SERVICIO = 'pagos-servicio'

/** Lo que puede pesar una factura o un comprobante. */
export const MAXIMO_MB_FINANZAS = 10

/** Lo que acepta el bucket de pagos de servicio, con la extensión que lleva la ruta. */
export const TIPOS_COMPROBANTE_PAGO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** En qué va la factura de venta que anexó Contabilidad. */
export const ESTADO_FACTURA_VENTA: Record<string, { etiqueta: string; tono: Tono }> = {
  ANEXADA: { etiqueta: 'Por enviar a Tesorería', tono: 'aviso' },
  ENVIADA: { etiqueta: 'En Tesorería', tono: 'exito' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

/**
 * E001-00000626 → E001-626, como lo guarda la base (`normalizar_numero_factura`).
 * Nulo si no tiene la forma de un número de SUNAT.
 */
export function normalizarNumeroFactura(texto: string): string | null {
  const m = texto.replace(/\s/g, '').toUpperCase().match(/^([A-Z][A-Z0-9]{3})-0*([1-9][0-9]{0,7})$/)
  return m ? `${m[1]}-${Number(m[2])}` : null
}

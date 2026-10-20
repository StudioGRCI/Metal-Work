import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * Adquisiciones de punta a punta: una fila por OC y por OS, de dónde salió
 * hasta si se pagó (migración 20261020170000). Aquí van los nombres de cada
 * estado y los filtros, que leen tanto la página como sus tarjetas.
 */

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/** Si ya se pagó, como lo calcula `trazabilidad_de_compras()`. */
export const ESTADO_PAGO: Record<string, Def> = {
  PAGADA: { etiqueta: 'Pagada', tono: 'exito', descripcion: 'Tesorería pagó todo lo facturado.' },
  PAGO_PARCIAL: { etiqueta: 'Pagada en parte', tono: 'info', descripcion: 'Hay un pago, pero falta pagar o facturar otra parte.' },
  POR_PAGAR: { etiqueta: 'Por pagar', tono: 'aviso', descripcion: 'Lista para que Tesorería la pague.' },
  POR_FACTURAR: { etiqueta: 'Espera su factura', tono: 'aviso', descripcion: 'Contabilidad todavía no registra su factura.' },
  SIN_FACTURA: {
    etiqueta: 'Sin factura',
    tono: 'neutro',
    descripcion: 'Va con boleta, nota de venta o recibo: su pago no se registra en el sistema, solo su comprobante.',
  },
  ESPERA_APROBACION: { etiqueta: 'Espera a Gerencia', tono: 'neutro', descripcion: 'No se paga hasta que Gerencia la apruebe.' },
  NO_SE_PAGA: { etiqueta: 'No se paga', tono: 'neutro', descripcion: 'Rechazada o anulada.' },
}

/** Los PDF que Logística adjunta a una OC. */
export const TIPO_DOCUMENTO_COMPRA: Record<string, string> = {
  COTIZACION: 'Cotización',
  ORDEN_COMPRA: 'Orden de compra',
  ORDEN_PAGO: 'Orden de pago',
  ORDEN_SERVICIO: 'Orden de servicio',
  FACTURA: 'Factura',
  COMPROBANTE: 'Boleta, nota de venta o recibo',
  OTRO: 'Otro documento',
}

/** Lo que necesitan los filtros de cada fila. */
export type FilaParaFiltrar = {
  tipo: 'OC' | 'OS'
  aprobacion: string
  con_factura: boolean | null
  facturada_entera: boolean | null
  pago: string
  recojo: string | null
  en_lista: boolean
  peso_kg: number | null
  guia: unknown
}

/**
 * La OC que ya tiene su peso en la lista del conductor (o que él ya lleva) y
 * todavía no tiene guía de remisión: la que Contabilidad tiene que cargar. La
 * misma regla que `guias_por_emitir()`.
 */
export function guiaPorCargar(f: FilaParaFiltrar): boolean {
  if (f.tipo !== 'OC' || f.guia || f.peso_kg === null) return false
  return f.recojo === 'EN_RECOJO' || f.recojo === 'RECOGIDO' || (f.recojo === 'POR_RECOGER' && f.en_lista)
}

/** Los filtros de «En qué va»: la clave va en la URL como `situacion`. */
export const SITUACIONES = [
  { valor: 'por-aprobar', etiqueta: 'Esperan a Gerencia' },
  { valor: 'por-facturar', etiqueta: 'Esperan su factura' },
  { valor: 'por-pagar', etiqueta: 'Por pagar' },
  { valor: 'pagadas', etiqueta: 'Pagadas' },
  { valor: 'guia', etiqueta: 'Guía por cargar' },
  { valor: 'no-se-pagan', etiqueta: 'Rechazadas o anuladas' },
] as const
export type Situacion = (typeof SITUACIONES)[number]['valor']

export function enSituacion(f: FilaParaFiltrar, situacion: Situacion): boolean {
  switch (situacion) {
    case 'por-aprobar':
      return f.pago === 'ESPERA_APROBACION'
    case 'por-facturar':
      // Como `compras_sin_factura()`: aprobada, con factura y sin una que la complete.
      return f.tipo === 'OC' && f.con_factura === true && (f.aprobacion === 'APROBADA' || f.aprobacion === 'NO_REQUERIDA') && !f.facturada_entera
    case 'por-pagar':
      return f.pago === 'POR_PAGAR' || f.pago === 'PAGO_PARCIAL'
    case 'pagadas':
      return f.pago === 'PAGADA'
    case 'guia':
      return guiaPorCargar(f)
    case 'no-se-pagan':
      return f.pago === 'NO_SE_PAGA'
  }
}

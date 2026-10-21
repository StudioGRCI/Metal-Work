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
  // La OC con boleta que Tesorería pagó directo y a la que después llegó su comprobante (migración 20261020210000).
  PAGO_POR_ANULAR: {
    etiqueta: 'Pago por anular',
    tono: 'aviso',
    descripcion:
      'Tesorería la pagó directo por su boleta y el proveedor entregó factura: Tesorería anula ese pago para que Contabilidad la registre, y se paga por la factura.',
  },
  // La OC con boleta que Tesorería pagó directo y también por la factura que llegó después: no se anula, se pide la devolución.
  PAGADA_DOS_VECES: {
    etiqueta: 'Pagada dos veces',
    tono: 'peligro',
    descripcion:
      'Tesorería la pagó directo por su boleta y también pagó la factura que el proveedor entregó después: pide al proveedor la devolución de lo pagado de más, y el pago directo se anula cuando la devuelva.',
  },
  // La OC con boleta a la que Logística anexó una factura registrada para otras OC que no alcanza para esta.
  ANEXO_POR_REVISAR: {
    etiqueta: 'Anexo por revisar',
    tono: 'aviso',
    descripcion:
      'Logística le anexó una factura que Contabilidad registró para otras OC y no alcanza para esta: no se paga ni por ella ni por su boleta hasta que Logística anule ese anexo o Contabilidad corrija la factura.',
  },
  POR_PAGAR: { etiqueta: 'Por pagar', tono: 'aviso', descripcion: 'Lista para que Tesorería la pague.' },
  POR_FACTURAR: { etiqueta: 'Espera su factura', tono: 'aviso', descripcion: 'Contabilidad todavía no registra su factura.' },
  // La OC con boleta de antes de que Tesorería registrara esos pagos (migración 20261020210000).
  SIN_FACTURA: {
    etiqueta: 'Pago fuera del sistema',
    tono: 'neutro',
    descripcion:
      'Va con boleta y es de antes de que Tesorería registrara el pago de las OC con boleta: se dio por pagada fuera del sistema. Si no se pagó, Tesorería la pasa a Cuentas por pagar con «No se pagó».',
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

/** Los documentos de una OS (migración 20261020210000): los adjuntan Logística y Tesorería. */
export const TIPO_DOCUMENTO_SERVICIO: Record<string, string> = {
  FACTURA: 'Factura',
  BOLETA: 'Boleta',
  RECIBO: 'Recibo',
  CONTRATO: 'Contrato',
  OTRO: 'Otro documento',
}

/** La factura, la boleta y el recibo llevan su número; el contrato y lo demás, no. */
export const COMPROBANTES_DE_SERVICIO = ['FACTURA', 'BOLETA', 'RECIBO'] as const

/** Cómo se nombra un documento de la OS: «Factura F001-123», «Contrato». La usan el servidor y el navegador. */
export function etiquetaDocumentoServicio(d: { tipo: string; numero: string | null }) {
  const tipo = TIPO_DOCUMENTO_SERVICIO[d.tipo] ?? 'Documento'
  return d.numero ? `${tipo} ${d.numero}` : tipo
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
      // Y la OC con boleta a la que el proveedor entregó factura: espera que Contabilidad la registre.
      return (
        (f.tipo === 'OC' && f.con_factura === true && (f.aprobacion === 'APROBADA' || f.aprobacion === 'NO_REQUERIDA') && !f.facturada_entera) ||
        (f.tipo === 'OC' && f.con_factura === false && f.pago === 'POR_FACTURAR')
      )
    case 'por-pagar':
      return f.pago === 'POR_PAGAR' || f.pago === 'PAGO_PARCIAL' || f.pago === 'PAGO_POR_ANULAR' || f.pago === 'ANEXO_POR_REVISAR'
    case 'pagadas':
      return f.pago === 'PAGADA' || f.pago === 'PAGADA_DOS_VECES'
    case 'guia':
      return guiaPorCargar(f)
    case 'no-se-pagan':
      return f.pago === 'NO_SE_PAGA'
  }
}

/**
 * El pago vigente que cancela la OC con boleta, como `trazabilidad_de_compras`:
 * el que Tesorería dio por cancelado sin llegar al total o, si no hay, el que
 * llegó al total (migración 20261020210000). Los pagos vienen en el orden en que
 * se hicieron. Con dos pagos que «cancelan», solo uno la canceló.
 */
export function pagoQueCancela(
  pagos: { id: string; monto: number; anulado_en: string | null; cancela_sin_completar: boolean }[],
  total: number,
): string | null {
  const vigentes = pagos.filter((p) => !p.anulado_en)
  const sinCompletar = vigentes.filter((p) => p.cancela_sin_completar).at(-1)
  if (sinCompletar) return sinCompletar.id
  let acumulado = 0
  for (const p of vigentes) {
    acumulado += Number(p.monto)
    if (acumulado >= total) return p.id
  }
  return null
}

/**
 * Por qué Adquisiciones no ofrece «Anular» la factura que Logística anexó a una
 * OC con boleta, con la misma regla de `anular_documento_compra` (migración
 * 20261020210000): la factura que alcanza para esa OC, si ya se pagó ella o la
 * OC directo. Anulado el anexo, nada ataba los dos caminos y la compra se pagaba
 * otra vez. Al administrador del sistema no se le aplica.
 */
export function bloqueoDelAnexo(
  oc: { con_factura: boolean | null; pagos: unknown[] },
  anexo: { tipo: string; factura?: { numero: string; alcanza: boolean; pagado: number } | null },
): string | null {
  const factura = anexo.factura
  if (anexo.tipo !== 'FACTURA' || oc.con_factura !== false || !factura?.alcanza) return null
  if (factura.pagado <= 0 && oc.pagos.length === 0) return null
  return `No se anula: ${factura.pagado > 0 ? `la factura ${factura.numero} ya se pagó` : 'la OC ya se pagó por su boleta'}. Si el número está mal, Contabilidad corrige la factura; si no es de esta OC, la anula el administrador del sistema.`
}

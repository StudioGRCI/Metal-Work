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
  // La OC con boleta que Tesorería pagó directo y cuya factura, que llegó después, no tomó todo ese pago:
  // ya estaba pagada o es por menos (migración 20261020210000). No se anula nada: se pide la devolución y se
  // registra, o se descuenta de otra factura.
  PAGADA_DE_MAS: {
    etiqueta: 'Pagada de más',
    tono: 'peligro',
    descripcion:
      'Tesorería la pagó por su boleta y la factura que el proveedor entregó después ya estaba pagada o es por menos: se pagó de más. Tesorería pide al proveedor la devolución y la registra cuando entra, o la descuenta de otra factura suya. No se anula ningún pago.',
  },
  // La OC con boleta a la que Logística anexó una factura registrada para otras OC que no alcanza también para esta.
  // La base no liga una OC con boleta a una factura ya registrada: la salida es anular el anexo o corregir el total.
  ANEXO_POR_REVISAR: {
    etiqueta: 'Anexo por revisar',
    tono: 'aviso',
    descripcion:
      'Logística le anexó una factura que Contabilidad registró para otras OC y que no alcanza para esta: no se paga ni por ella ni por su boleta hasta que Logística anule ese anexo o Contabilidad corrija el total de la factura, si lo escribió mal.',
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
      // La pagada de más también: Tesorería tiene que pedir la devolución.
      return f.pago === 'POR_PAGAR' || f.pago === 'PAGO_PARCIAL' || f.pago === 'ANEXO_POR_REVISAR' || f.pago === 'PAGADA_DE_MAS'
    case 'pagadas':
      return f.pago === 'PAGADA' || f.pago === 'PAGADA_DE_MAS'
    case 'guia':
      return guiaPorCargar(f)
    case 'no-se-pagan':
      return f.pago === 'NO_SE_PAGA'
  }
}

/**
 * Por qué Adquisiciones no ofrece «Anular» la factura que Logística anexó a una
 * OC con boleta, con la misma regla de `anular_documento_compra` (migración
 * 20261020210000): la factura que alcanza para esa OC, si ya se pagó ella o la
 * OC directo. Anulado el anexo, nada ataba los dos caminos y la compra se pagaba
 * otra vez. `neto` es lo pagado por la boleta menos lo que el proveedor
 * devolvió: devuelto todo, la boleta no aportó nada. Al administrador del
 * sistema no se le aplica.
 */
export function bloqueoDelAnexo(
  oc: { con_factura: boolean | null; neto: number },
  anexo: { tipo: string; factura?: { numero: string; estado: string; alcanza: boolean; pagado: number } | null },
  /** Si esa factura tomó algo de lo que se pagó por la boleta de esta OC. */
  tomoDeLaBoleta: boolean,
): string | null {
  const factura = anexo.factura
  if (anexo.tipo !== 'FACTURA' || oc.con_factura !== false || !factura?.alcanza) return null
  if (factura.pagado <= 0 && oc.neto <= 0) return null
  // En el orden de la base: la que tomó el pago por la boleta, la que tiene pagos, el borrador que lo tomaría y la de otra moneda.
  const motivo = tomoDeLaBoleta
    ? `la factura ${factura.numero} tomó lo que Tesorería pagó por la boleta`
    : factura.pagado > 0
      ? `la factura ${factura.numero} ya tiene pagos`
      : factura.estado === 'BORRADOR'
        ? `la OC ya se pagó por su boleta y la factura ${factura.numero}, al registrarla, toma ese pago`
        : `la OC ya se pagó por su boleta y la factura ${factura.numero} ya está registrada`
  return `No se anula: ${motivo}. Si el número está mal, Contabilidad corrige la factura; si no es de esta OC, la anula el administrador del sistema.`
}

/**
 * Lo que dice la ventana «Anular» del anexo por revisar: la factura registrada
 * es de otras OC y no alcanza también para esta, así que lo más
 * probable es que el anexo esté mal. No se manda a nadie a «ligar» la OC a la
 * factura: `corregir_factura_compra` no acepta una OC con boleta, y el anexo por
 * revisar no se paga por ningún lado mientras siga. Si la factura ya tiene
 * pagos y sí incluía esta OC (un descuento grande, una factura parcial), se
 * anula igual y Tesorería paga por la boleta solo lo que la factura no cubrió,
 * o pide la devolución si ya la pagó (octava auditoría). Anulado, la OC con
 * pagos directos sigue con ellos; la que no tiene, se paga por su boleta (no
 * «vuelve a pagarse»: se leía como pagarla otra vez).
 */
export function anexoPorRevisarAlAnular(
  oc: { nombre: string; pagos: unknown[] },
  factura: { numero: string; estado: string; alcanza: boolean; pagado: number },
): string | null {
  if (factura.estado !== 'REGISTRADA' || factura.alcanza) return null
  const queda = oc.pagos.length > 0 ? 'la OC sigue con su pago directo' : 'la OC se paga por su boleta'
  const base = `La factura ${factura.numero}, que Contabilidad registró para otras OC, no alcanza para esta: lo más probable es que el anexo esté mal. Anúlalo y ${queda}. No se borra: queda tachado en la ${oc.nombre} con su PDF, el motivo, quién y cuándo.`
  if (factura.pagado > 0) {
    return `${base} Si la factura sí incluía esta OC, anúlalo igual: Tesorería recibe el aviso, paga por la boleta solo lo que la factura no cubrió o pide la devolución si ya la pagó. El sistema no deja ligar una OC con boleta a una factura ya registrada.`
  }
  return `${base} Si es de otra OC, después la anexas a la buena; si Contabilidad escribió mal su total, que lo corrija y el anexo deja de estar por revisar.`
}

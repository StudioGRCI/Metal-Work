import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * Lo que comparten las pantallas de subcontratos (Administración) y de recibos
 * por honorarios (Tesorería). Puro, sin consultas: lo usan el servidor y el
 * navegador. Las mismas cifras las exige la base (migración 20261015221000).
 */

/** El bucket privado de los recibos y los vouchers: la ruta es `{subcontrato}/{archivo}`. */
export const BUCKET_SUBCONTRATOS = 'subcontratos'

/** Lo que puede pesar un recibo o un voucher. */
export const MAXIMO_MB_SUBCONTRATOS = 10

/** Lo que acepta el bucket, con la extensión que lleva la ruta. */
export const TIPOS_ARCHIVO_SUBCONTRATOS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * La retención de cuarta categoría: el 8 % del bruto, cuando el recibo pasa de
 * S/ 1,500 y el emisor no tiene suspensión. La decide lo que dice el recibo;
 * el umbral solo sirve para sugerir la casilla.
 */
export const RETENCION_PORCENTAJE = 8
export const UMBRAL_RETENCION_PEN = 1500

export const AYUDA_RETENCION =
  'Márcalo si el recibo dice que lleva retención: SUNAT la pide cuando pasa de S/ 1,500 y quien lo emite no tiene suspensión.'

/** Lo retenido y el neto de un bruto, redondeados al céntimo como en la base. */
export function retencionYNeto(bruto: number, conRetencion: boolean): { retencion: number; neto: number } {
  const retencion = conRetencion ? Math.round(bruto * RETENCION_PORCENTAJE) / 100 : 0
  return { retencion, neto: Math.round((bruto - retencion) * 100) / 100 }
}

/**
 * Para qué área va el subcontrato (migraciones 20261017100000 y
 * 20261020180000): su supervisor lo ve en «Supervisión › Subcontratos», sin
 * montos, y reporta su avance. Solo estas tres: la base rechaza cualquier otra.
 */
export const AREAS_SUBCONTRATO = [
  { codigo: 'MTZ', nombre: 'Maestranza' },
  { codigo: 'PRD', nombre: 'Producción' },
  { codigo: 'ACB', nombre: 'Acabados' },
] as const

export type AreaSubcontrato = (typeof AREAS_SUBCONTRATO)[number]['codigo']

export const AYUDA_AREA_SUBCONTRATO =
  'El supervisor de esa área ve el subcontrato sin montos ni recibos, con su inicio y su fin, y reporta su avance en el reporte diario. Le llega el aviso.'

/** El nombre del área de un subcontrato, o null si es de antes y todavía no la tiene. */
export function nombreDeAreaSubcontrato(codigo: string | null | undefined): string | null {
  return AREAS_SUBCONTRATO.find((a) => a.codigo === codigo)?.nombre ?? null
}

export type EstadoSubcontrato = 'VIGENTE' | 'TERMINADO' | 'ANULADO'

export const ESTADO_SUBCONTRATO: Record<EstadoSubcontrato, { etiqueta: string; tono: Tono }> = {
  VIGENTE: { etiqueta: 'Vigente', tono: 'info' },
  TERMINADO: { etiqueta: 'Terminado', tono: 'exito' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro' },
}

export function estadoDeSubcontrato(estado: string): EstadoSubcontrato {
  return estado === 'TERMINADO' || estado === 'ANULADO' ? estado : 'VIGENTE'
}

export type EstadoRecibo = 'POR_PAGAR' | 'PAGADO' | 'ANULADO'

export const ESTADO_RECIBO: Record<EstadoRecibo, { etiqueta: string; tono: Tono }> = {
  POR_PAGAR: { etiqueta: 'Por pagar', tono: 'aviso' },
  PAGADO: { etiqueta: 'Pagado', tono: 'exito' },
  ANULADO: { etiqueta: 'Anulado', tono: 'neutro' },
}

/** En qué va un recibo: anulado, o pagado si tiene un pago vigente. */
export function estadoDeRecibo(recibo: { anulado_en: string | null; pagos: { anulado_en: string | null }[] }): EstadoRecibo {
  if (recibo.anulado_en) return 'ANULADO'
  return recibo.pagos.some((p) => !p.anulado_en) ? 'PAGADO' : 'POR_PAGAR'
}

/**
 * Las cuentas de un subcontrato con sus recibos vigentes: cuánto se recibió en
 * bruto, cuánto se retuvo, cuánto pagó Tesorería y cuánto le falta pagar, y lo
 * que falta recibir de lo pactado (negativo si los recibos pasan lo pactado).
 */
export function cuentasDeSubcontrato(
  monto: number,
  recibos: { monto_bruto: number; retencion_monto: number; monto_neto: number; anulado_en: string | null; pagos: { anulado_en: string | null }[] }[],
) {
  const vigentes = recibos.filter((r) => !r.anulado_en)
  const pagados = vigentes.filter((r) => estadoDeRecibo(r) === 'PAGADO')
  const suma = (lista: typeof vigentes, campo: 'monto_bruto' | 'retencion_monto' | 'monto_neto') =>
    Math.round(lista.reduce((n, r) => n + r[campo], 0) * 100) / 100
  const recibido = suma(vigentes, 'monto_bruto')
  const pagadoBruto = suma(pagados, 'monto_bruto')
  return {
    recibos: vigentes.length,
    recibido,
    retenido: suma(vigentes, 'retencion_monto'),
    pagado: suma(pagados, 'monto_neto'),
    /**
     * Lo pagado contra lo pactado: el bruto de los recibos pagados. Tesorería
     * deposita el neto y la retención va a SUNAT a nombre del subcontratista;
     * las dos partes descuentan del contrato. El plan 8 (entrega 8.2) pide
     * «pagado y saldo» sin decir cuál; contarlo en bruto es la propuesta del
     * hilo, a la espera del «ok» de DKS en el PR.
     */
    pagadoBruto,
    /** Lo que falta pagar del contrato: lo pactado menos lo pagado en bruto. */
    saldo: Math.round((monto - pagadoBruto) * 100) / 100,
    porPagar: Math.round((suma(vigentes, 'monto_neto') - suma(pagados, 'monto_neto')) * 100) / 100,
    porRecibir: Math.round((monto - recibido) * 100) / 100,
  }
}

/** El número del recibo como lo guarda la base: sin espacios y en mayúsculas (E001-25). */
export function normalizarNumeroRecibo(numero: string): string {
  return numero.replace(/\s/g, '').toUpperCase()
}

export const NUMERO_RECIBO = /^[A-Z0-9]{1,4}-[0-9]{1,8}$/

/** «Vence pronto»: el fin del contrato cae dentro de estos días (DKS, plan 8). */
export const DIAS_VENCE_PRONTO = 7

/**
 * Cuántos días faltan para el fin del contrato (negativo si ya pasó), contando
 * por fecha de Lima. `null` si no corre: no está vigente, no tiene fin pactado,
 * o el supervisor ya anotó que terminó.
 */
export function diasParaVencer(
  s: { estado: string; fecha_fin: string | null; fin_real: string | null },
  hoy: string,
): number | null {
  if (s.estado !== 'VIGENTE' || !s.fecha_fin || s.fin_real) return null
  // Las dos son YYYY-MM-DD: se restan como días enteros, sin la hora ni la zona.
  const dia = (f: string) => Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)))
  return Math.round((dia(s.fecha_fin.slice(0, 10)) - dia(hoy)) / 86_400_000)
}

/**
 * Vence pronto: dentro de los siete días (DKS, plan 8), o ya venció y sigue
 * vigente sin fin real. Sumar los ya vencidos es la propuesta del hilo, a la
 * espera del «ok» de DKS en el PR: son los que más urgen.
 */
export function vencePronto(dias: number | null): boolean {
  return dias !== null && dias <= DIAS_VENCE_PRONTO
}

/** Cómo se dice cuándo vence. */
export function cuandoVence(dias: number): string {
  if (dias === 0) return 'Vence hoy'
  if (dias === 1) return 'Vence mañana'
  if (dias > 1) return `Vence en ${dias} días`
  return dias === -1 ? 'Venció ayer' : `Venció hace ${-dias} días`
}

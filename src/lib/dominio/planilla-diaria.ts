/**
 * Lo que comparten las pantallas de la planilla diaria y de las horas extras.
 * Puro, sin consultas: lo usan el servidor y el navegador. Las mismas cifras
 * las exige la base (migración 20261014202000).
 */

/** La jornada ordinaria: lo que pasa de estas horas en un día son horas extras. */
export const JORNADA_HORAS = 8

/** El bucket privado de los comprobantes y las boletas: la ruta es `{planilla}/{archivo}`. */
export const BUCKET_PLANILLA_DIARIA = 'planilla-diaria'

/** Lo que puede pesar un comprobante o una boleta. */
export const MAXIMO_MB_PLANILLA = 10

/** Lo que acepta el bucket, con la extensión que lleva la ruta. */
export const TIPOS_ARCHIVO_PLANILLA: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

type Tono = 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info' | 'acento'

/** Qué decidió RR. HH. con las horas extras de un día. */
export const DECISION_EXTRAS: Record<string, { etiqueta: string; tono: Tono }> = {
  PAGAR: { etiqueta: 'Se pagan', tono: 'acento' },
  RESERVAR: { etiqueta: 'Reservadas', tono: 'info' },
}

/** En qué va una planilla, según sus pagos y sus boletas. */
export type EstadoPlanilla = 'ANULADA' | 'POR_PAGAR' | 'PAGO_PARCIAL' | 'PAGADA' | 'BOLETAS_ENTREGADAS'

export const ESTADO_PLANILLA: Record<EstadoPlanilla, { etiqueta: string; tono: Tono }> = {
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
  POR_PAGAR: { etiqueta: 'Por pagar', tono: 'aviso' },
  PAGO_PARCIAL: { etiqueta: 'Pagada en parte', tono: 'aviso' },
  PAGADA: { etiqueta: 'Pagada', tono: 'exito' },
  BOLETAS_ENTREGADAS: { etiqueta: 'Boletas entregadas', tono: 'exito' },
}

export function estadoDePlanilla(
  anuladoEn: string | null,
  personas: { pago_id: string | null; boleta_entregada_en: string | null }[],
): EstadoPlanilla {
  if (anuladoEn) return 'ANULADA'
  const pagadas = personas.filter((p) => p.pago_id).length
  if (pagadas === 0) return 'POR_PAGAR'
  if (pagadas < personas.length) return 'PAGO_PARCIAL'
  return personas.every((p) => p.boleta_entregada_en) ? 'BOLETAS_ENTREGADAS' : 'PAGADA'
}

/** La regla de las horas extras: cuántas van con el primer recargo y los dos recargos en %. */
export type ReglaHorasExtras = { horas_tramo1: number; recargo_tramo1: number; recargo_tramo2: number }

/** La regla de ley, mientras la base no diga otra. */
export const REGLA_DE_LEY: ReglaHorasExtras = { horas_tramo1: 2, recargo_tramo1: 25, recargo_tramo2: 35 }

/** Lo que vale la hora de alguien: su remuneración mensual entre 240 (30 días de 8 horas). */
export function valorHora(remuneracionMensual: number) {
  return Math.round((remuneracionMensual / 240) * 10000) / 10000
}

const redondear = (n: number) => Math.round(n * 100) / 100

/** Lo que se paga por unas horas extras con su recargo, igual que `enviar_planilla_diaria`. */
export function montoExtras(hora: number, tramo1: number, tramo2: number, regla: ReglaHorasExtras) {
  return redondear(hora * (tramo1 * (1 + regla.recargo_tramo1 / 100) + tramo2 * (1 + regla.recargo_tramo2 / 100)))
}

/** Lo que se paga por unas horas ordinarias. */
export function montoOrdinarias(hora: number, horas: number) {
  return redondear(horas * hora)
}

/** «PD-0001-2026 · 3 personas». */
export function personasTexto(n: number) {
  return `${n} ${n === 1 ? 'persona' : 'personas'}`
}

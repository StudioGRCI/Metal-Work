/**
 * Los pagos de la oficina (migración 20261020120000): cada uno cubre un tramo de
 * días y entra al costeo de cada mes por los días que caen en él. Las cuentas son
 * las mismas que hace `sueldos_oficina_del_mes` en la base; aquí solo se muestran.
 * Las fechas son planas (YYYY-MM-DD) y se operan como texto, al mediodía UTC.
 */
import { sumarDias } from '@/lib/format'

export const FRECUENCIAS = {
  SEMANA: 'Una semana',
  QUINCENA: 'Una quincena',
  MES: 'Un mes',
  OTRO: 'Otros días',
} as const
export type Frecuencia = keyof typeof FRECUENCIAS

const dia = (fecha: string) => Date.parse(`${fecha}T12:00:00Z`) / 86_400_000

/** Cuántos días hay de `desde` a `hasta`, los dos incluidos (0 si van al revés). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.max(0, Math.round(dia(hasta) - dia(desde)) + 1)
}

/** El último día del mes `YYYY-MM`. */
export function finDeMes(mes: string): string {
  return sumarDias(`${mesSiguiente(mes)}-01`, -1)
}

function mesSiguiente(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

/** El último día del tramo que empieza en `desde`, según cada cuánto se paga. */
export function tramoSugerido(frecuencia: Frecuencia, desde: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return null
  if (frecuencia === 'SEMANA') return sumarDias(desde, 6)
  if (frecuencia === 'QUINCENA') return Number(desde.slice(8)) <= 15 ? `${desde.slice(0, 8)}15` : finDeMes(desde.slice(0, 7))
  if (frecuencia === 'MES') {
    const [a, m, d] = desde.split('-')
    const siguiente = mesSiguiente(`${a}-${m}`)
    // Del 1 al último día; si empieza otro día, hasta la víspera del mismo día del mes siguiente.
    if (d === '01') return finDeMes(`${a}-${m}`)
    const objetivo = `${siguiente}-${d}`
    const tope = finDeMes(siguiente)
    return objetivo > tope ? tope : sumarDias(objetivo, -1)
  }
  return null
}

/**
 * La parte de un pago (con aportes) que cae en el mes `YYYY-MM`: lo pagado hasta el
 * fin del mes menos lo pagado hasta el fin del anterior, para que las partes de un
 * pago sumen el pago al céntimo.
 */
export function parteDelMes(pago: { desde: string; hasta: string; monto: number; aportes: number }, mes: string): number {
  // En céntimos enteros: con decimales de coma flotante, 1000.01 partido en dos
  // días daba 500.00 donde la base da 500.01.
  const total = Math.round((pago.monto + pago.aportes) * 100)
  const dias = diasEntre(pago.desde, pago.hasta)
  const inicio = `${mes}-01`
  const fin = finDeMes(mes)
  const hastaFin = pago.hasta < fin ? pago.hasta : fin
  const antes = sumarDias(inicio, -1)
  const hastaAntes = pago.hasta < antes ? pago.hasta : antes
  return (Math.round((total * diasEntre(pago.desde, hastaFin)) / dias) - Math.round((total * diasEntre(pago.desde, hastaAntes)) / dias)) / 100
}

/**
 * Los días del mes que la persona trabajó hasta `hoy` (entre su ingreso y su baja)
 * y que ningún pago cubre, y el primero de ellos. Un día que todavía no llega no
 * falta, y uno anterior a `registro` (el primer pago que registró RR. HH.) tampoco:
 * así lo cuenta también `sueldos_oficina_del_mes`.
 */
export function diasSinPago(
  persona: { fecha_ingreso: string | null; fecha_baja: string | null },
  pagos: { desde: string; hasta: string }[],
  mes: string,
  hoy: string,
  registro: string,
): { dias: number; desde: string | null } {
  const inicio = [`${mes}-01`, registro].sort()[1]
  const fin = [finDeMes(mes), persona.fecha_baja, hoy].filter((f): f is string => f !== null).sort()[0]
  let d = persona.fecha_ingreso && persona.fecha_ingreso > inicio ? persona.fecha_ingreso : inicio
  const ultimo = fin
  let dias = 0
  let desde: string | null = null
  for (; d <= ultimo; d = sumarDias(d, 1)) {
    if (pagos.some((p) => p.desde <= d && d <= p.hasta)) continue
    dias += 1
    desde ??= d
  }
  return { dias, desde }
}

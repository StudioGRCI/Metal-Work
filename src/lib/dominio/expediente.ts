/**
 * Las cuentas del expediente de fabricación: cuánto tardó cada etapa contra lo
 * programado, cómo quedó la entrega frente a lo prometido y en qué se fue el
 * costo. Son funciones puras —reciben fechas en texto y la fecha de hoy del
 * taller— para que el servidor y cualquier prueba den el mismo resultado.
 *
 * Todas las fechas se comparan como días de Lima en texto YYYY-MM-DD. Un
 * instante de la base (`2026-09-22T22:00:00Z`) es el 22 en Lima; convertirlo con
 * `new Date()` en un servidor UTC lo corría al 23.
 */
import type { Tono } from '@/components/ui/etiqueta-estado'

const ZONA = 'America/Lima'
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** El día de Lima de una fecha o un instante de la base, como YYYY-MM-DD. */
export function diaDeLima(valor: string | null | undefined): string | null {
  if (!valor) return null
  if (SOLO_FECHA.test(valor)) return valor
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Días de calendario de `desde` a `hasta` (negativo si `hasta` es antes). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000)
}

export function dias(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? 'día' : 'días'}`
}

export type EtapaParaCumplir = {
  estado: string
  fecha_inicio_real: string | null
  fecha_fin_programada: string | null
  fecha_fin_real: string | null
}

/**
 * Cómo le fue a una etapa contra su fecha de fin programada, dicha con días:
 * «2 días tarde» se entiende sin leyenda.
 */
export function cumplimientoDeEtapa(etapa: EtapaParaCumplir, hoy: string): { etiqueta: string; tono: Tono } {
  if (etapa.estado === 'OMITIDA') return { etiqueta: 'Omitida', tono: 'neutro' }
  const fin = diaDeLima(etapa.fecha_fin_real)
  const plan = etapa.fecha_fin_programada
  if (fin) {
    if (!plan) return { etiqueta: 'Terminada', tono: 'exito' }
    const retraso = diasEntre(plan, fin)
    return retraso <= 0
      ? { etiqueta: 'A tiempo', tono: 'exito' }
      : { etiqueta: `${dias(retraso)} tarde`, tono: 'peligro' }
  }
  if (plan && plan < hoy) return { etiqueta: `Vencida hace ${dias(diasEntre(plan, hoy))}`, tono: 'peligro' }
  if (etapa.fecha_inicio_real || etapa.estado === 'EN_PROCESO') {
    return plan
      ? { etiqueta: `En curso · quedan ${dias(diasEntre(hoy, plan))}`, tono: 'acento' }
      : { etiqueta: 'En curso', tono: 'acento' }
  }
  return { etiqueta: plan ? 'Por empezar' : 'Sin programar', tono: 'neutro' }
}

/** La entrega frente a la fecha prometida al cliente. */
export function situacionDeEntrega(
  comprometida: string | null,
  entregada: string | null,
  hoy: string,
): { pie: string; tono: Tono } {
  if (entregada) {
    if (!comprometida) return { pie: 'Entregada con acta', tono: 'exito' }
    const retraso = diasEntre(comprometida, entregada)
    return retraso <= 0
      ? { pie: retraso === 0 ? 'Entregada el día prometido' : `Entregada ${dias(-retraso)} antes`, tono: 'exito' }
      : { pie: `Entregada ${dias(retraso)} tarde`, tono: 'peligro' }
  }
  if (!comprometida) return { pie: 'Todavía sin fecha comprometida', tono: 'neutro' }
  const faltan = diasEntre(hoy, comprometida)
  if (faltan < 0) return { pie: `Vencida hace ${dias(-faltan)}`, tono: 'peligro' }
  if (faltan === 0) return { pie: 'Se entrega hoy', tono: 'aviso' }
  return { pie: `Faltan ${dias(faltan)}`, tono: faltan <= 7 ? 'aviso' : 'neutro' }
}

/** Días que la unidad lleva (o llevó) en el taller, desde que empezó el trabajo. */
export function tiempoEnTaller(inicio: string | null, fin: string | null, hoy: string) {
  const desde = diaDeLima(inicio)
  if (!desde) return null
  const hasta = diaDeLima(fin) ?? hoy
  return { dias: Math.max(0, diasEntre(desde, hasta)), desde, hasta, cerrado: Boolean(fin) }
}

/* ---------------------------------------------------------------- el costo */

/**
 * De qué está hecho el costo, en el orden fijo de sus colores. Las tres
 * primeras eran todo el costo hasta el 2026-10-01; las otras tres llegaron con
 * la hoja RESUMEN de la empresa: la merma que pone Diseño, los servicios del
 * local y los gastos de operación que pone Administración.
 */
export const FUENTES_COSTO = [
  { clave: 'MATERIALES', etiqueta: 'Materiales', serie: 'bg-serie-1' },
  { clave: 'PLANILLA', etiqueta: 'Mano de obra (planilla)', serie: 'bg-serie-2' },
  { clave: 'GASTOS_AREA', etiqueta: 'Gastos de las áreas', serie: 'bg-serie-3' },
  { clave: 'MERMA', etiqueta: 'Merma de material', serie: 'bg-serie-4' },
  { clave: 'INDIRECTOS', etiqueta: 'Servicios del local', serie: 'bg-serie-5' },
  { clave: 'GASTOS_OPERACION', etiqueta: 'Gastos de operación', serie: 'bg-serie-6' },
] as const

export type LineaResumenCosto = { fuente: string | null; moneda: string | null; monto: number | null; pendientes: number | null }

export type ComposicionCosto = {
  moneda: 'PEN' | 'USD'
  total: number
  partes: { clave: string; etiqueta: string; serie: string; monto: number; pct: number }[]
}

/**
 * El resumen de la base agrupado por moneda: soles y dólares no se suman entre
 * sí —no hay tipo de cambio en el sistema—, así que cada moneda tiene su total
 * y su reparto. Las fuentes siempre en el mismo orden y con el mismo color.
 */
export function composicionDelCosto(resumen: LineaResumenCosto[]): {
  monedas: ComposicionCosto[]
  sinPrecio: number
} {
  const sinPrecio = resumen
    .filter((l) => l.fuente === 'MATERIALES_SIN_PRECIO')
    .reduce((s, l) => s + Number(l.pendientes ?? 0), 0)
  const monedas = (['PEN', 'USD'] as const)
    .map((moneda) => {
      const partes = FUENTES_COSTO.map((f) => ({
        ...f,
        monto: resumen
          .filter((l) => l.fuente === f.clave && l.moneda === moneda)
          .reduce((s, l) => s + Number(l.monto ?? 0), 0),
      }))
      const total = partes.reduce((s, p) => s + p.monto, 0)
      return {
        moneda,
        total,
        partes: partes.map((p) => ({ ...p, pct: total > 0 ? (p.monto / total) * 100 : 0 })),
      }
    })
    .filter((c) => c.total > 0)
  return { monedas, sinPrecio }
}

/* ------------------------------------------------- el plan contra lo real */

export type EtapaEnGrafico = {
  inicio_programado: string | null
  fin_programado: string | null
  inicio_real: string | null
  fin_real: string | null
}

/**
 * El rango de fechas que abarca el gráfico de plan contra real: de la primera
 * fecha conocida a la última, con hoy dentro si la orden sigue viva.
 */
export function rangoDelGrafico(etapas: EtapaEnGrafico[], hoy: string, viva: boolean) {
  const fechas = etapas
    .flatMap((e) => [e.inicio_programado, e.fin_programado, diaDeLima(e.inicio_real), diaDeLima(e.fin_real)])
    .filter((f): f is string => Boolean(f))
  if (viva) fechas.push(hoy)
  if (fechas.length === 0) return null
  fechas.sort()
  const desde = fechas[0]
  const hasta = fechas[fechas.length - 1]
  // Un día de margen a cada lado: una etapa de un solo día tiene ancho.
  const total = Math.max(1, diasEntre(desde, hasta) + 1)
  const posicion = (dia: string) => (diasEntre(desde, dia) / total) * 100
  const tramo = (inicio: string, fin: string) => ({
    izquierda: posicion(inicio),
    ancho: Math.max(((diasEntre(inicio, fin) + 1) / total) * 100, 0.8),
  })
  // La marca de un día va a su mitad: las barras cubren el día entero.
  const marca = (dia: string) => ((diasEntre(desde, dia) + 0.5) / total) * 100
  return { desde, hasta, total, posicion, tramo, marca }
}

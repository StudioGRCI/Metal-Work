/*
 * Cómo trabaja Tesorería por vencimiento (plan 11, entrega 11.1): cada
 * documento por cobrar o por pagar cae en uno de cuatro grupos según su día
 * de vencimiento comparado con hoy en Lima —«Vencido», «Vence hoy», «Esta
 * semana» y «Después»—, y cada grupo dice su total en soles y en dólares por
 * separado, sin sumarlos.
 *
 * Todo es texto `YYYY-MM-DD`: el día de hoy lo da `hoyLima()` y las fechas de
 * vencimiento vienen planas de la base. Convertirlas a `Date` con la zona del
 * servidor las corre un día (skill `diseno` › Fechas), así que se restan como
 * medianoches UTC de ese mismo día.
 *
 * Funciones puras, sin React ni servidor: las usan las pantallas y las pruebas
 * (`vencimiento.test.mjs`).
 */

export type GrupoDeVencimiento = 'VENCIDO' | 'HOY' | 'SEMANA' | 'DESPUES' | 'SIN_FECHA'

/** El orden en que se leen: lo más urgente primero, lo que no vence al final. */
export const ORDEN_DE_GRUPOS: readonly GrupoDeVencimiento[] = ['VENCIDO', 'HOY', 'SEMANA', 'DESPUES', 'SIN_FECHA']

export const NOMBRE_DEL_GRUPO: Record<GrupoDeVencimiento, string> = {
  VENCIDO: 'Vencido',
  HOY: 'Vence hoy',
  SEMANA: 'Esta semana',
  DESPUES: 'Después',
  SIN_FECHA: 'Sin vencimiento',
}

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/
const DIA_MS = 86_400_000

const medianoche = (dia: string) => Date.parse(`${dia}T00:00:00Z`)

/** Días de `hoy` a `dia`: negativo si ya pasó, 0 si es hoy. `null` sin fecha válida. */
export function diasDesdeHoy(dia: string | null | undefined, hoy: string): number | null {
  if (!dia) return null
  const plano = dia.slice(0, 10)
  if (!SOLO_FECHA.test(plano) || !SOLO_FECHA.test(hoy)) return null
  return Math.round((medianoche(plano) - medianoche(hoy)) / DIA_MS)
}

/**
 * El domingo de la semana de `hoy` (de lunes a domingo, como el calendario del
 * taller). El domingo mismo es el último día de su semana.
 */
export function finDeLaSemana(hoy: string): string {
  const d = new Date(`${hoy}T12:00:00Z`)
  const diaDeLaSemana = d.getUTCDay() // 0 domingo … 6 sábado
  d.setUTCDate(d.getUTCDate() + (diaDeLaSemana === 0 ? 0 : 7 - diaDeLaSemana))
  return d.toISOString().slice(0, 10)
}

/** En qué grupo cae un vencimiento, mirado hoy en Lima. */
export function grupoDeVencimiento(dia: string | null | undefined, hoy: string): GrupoDeVencimiento {
  const faltan = diasDesdeHoy(dia, hoy)
  if (faltan === null) return 'SIN_FECHA'
  if (faltan < 0) return 'VENCIDO'
  if (faltan === 0) return 'HOY'
  return (dia as string).slice(0, 10) <= finDeLaSemana(hoy) ? 'SEMANA' : 'DESPUES'
}

/** Los días de una fila como se dicen: «hace 3 días», «hoy», «mañana», «en 4 días». */
export function diasDelVencimiento(faltan: number): string {
  if (faltan === 0) return 'hoy'
  if (faltan === 1) return 'mañana'
  if (faltan === -1) return 'hace 1 día'
  return faltan < 0 ? `hace ${-faltan} días` : `en ${faltan} días`
}

export type TotalesPorMoneda = { PEN: number; USD: number }

const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * Lo que suma cada moneda por separado. Los dólares no se pasan a soles: el
 * cambio de hoy no es el del día en que se pague o se cobre.
 */
export function totalesPorMoneda<T>(filas: readonly T[], moneda: (fila: T) => string | null, monto: (fila: T) => number): TotalesPorMoneda {
  const totales: TotalesPorMoneda = { PEN: 0, USD: 0 }
  for (const f of filas) {
    const m = moneda(f) === 'USD' ? 'USD' : 'PEN'
    totales[m] = redondear(totales[m] + (Number.isFinite(monto(f)) ? monto(f) : 0))
  }
  return totales
}

export type GrupoConFilas<T> = { grupo: GrupoDeVencimiento; filas: T[] }

/**
 * Reparte las filas en sus grupos, en el orden de lectura, y dentro de cada uno
 * de la que vence antes a la que vence después (lo más vencido primero). Las
 * que vencen el mismo día conservan el orden en que llegaron. Los grupos vacíos
 * no salen.
 */
export function agruparPorVencimiento<T>(filas: readonly T[], dia: (fila: T) => string | null | undefined, hoy: string): GrupoConFilas<T>[] {
  const porGrupo = new Map<GrupoDeVencimiento, { fila: T; i: number }[]>()
  filas.forEach((fila, i) => {
    const g = grupoDeVencimiento(dia(fila), hoy)
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), { fila, i }])
  })
  return ORDEN_DE_GRUPOS.flatMap((grupo) => {
    const lista = porGrupo.get(grupo)
    if (!lista) return []
    lista.sort((a, b) => {
      const da = (dia(a.fila) ?? '').slice(0, 10)
      const db = (dia(b.fila) ?? '').slice(0, 10)
      return da === db ? a.i - b.i : da < db ? -1 : 1
    })
    return [{ grupo, filas: lista.map((x) => x.fila) }]
  })
}

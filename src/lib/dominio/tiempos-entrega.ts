import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * Los tiempos de entrega por código interno que lleva Recursos Humanos
 * (migración 20261125100000). Puro, sin consultas. El color lo decide la base
 * (`semaforo_de_fecha`), para que la pantalla y los avisos digan lo mismo; aquí
 * solo se le pone nombre.
 */

export const RUTA_TIEMPOS = '/rrhh/tiempos-de-entrega'

export type Semaforo = 'ROJO' | 'AMBAR' | 'VERDE' | 'SIN_FECHA' | 'TERMINADA'

type Def = { etiqueta: string; tono: Tono }

/** Cómo se nombra cada color en la fila de un código. */
export const SEMAFORO_DE_CODIGO: Record<Semaforo, Def> = {
  ROJO: { etiqueta: 'Vencido', tono: 'peligro' },
  AMBAR: { etiqueta: 'Por vencer', tono: 'aviso' },
  VERDE: { etiqueta: 'A tiempo', tono: 'exito' },
  SIN_FECHA: { etiqueta: 'Sin fechas', tono: 'neutro' },
  TERMINADA: { etiqueta: 'Terminado', tono: 'neutro' },
}

/** Lo peor primero: es el orden de la lista. */
const PESO: Record<Semaforo, number> = { ROJO: 0, AMBAR: 1, VERDE: 2, SIN_FECHA: 3, TERMINADA: 4 }

export function semaforoValido(valor: unknown): Semaforo {
  return typeof valor === 'string' && valor in PESO ? (valor as Semaforo) : 'SIN_FECHA'
}

export function pesoDeSemaforo(s: Semaforo): number {
  return PESO[s]
}

/** Los filtros de la lista, en el orden en que se atienden. */
export const FILTROS_DE_TIEMPOS = [
  { valor: 'vencidos', etiqueta: 'Vencidos', semaforo: 'ROJO' },
  { valor: 'por-vencer', etiqueta: 'Por vencer', semaforo: 'AMBAR' },
  { valor: 'a-tiempo', etiqueta: 'A tiempo', semaforo: 'VERDE' },
  { valor: 'sin-fechas', etiqueta: 'Sin fechas', semaforo: 'SIN_FECHA' },
] as const satisfies readonly { valor: string; etiqueta: string; semaforo: Semaforo }[]

export function enlaceDeTiempos(codigo: string): string {
  return `${RUTA_TIEMPOS}/codigo?${new URLSearchParams({ codigo })}`
}

const dias = (n: number) => `${n} ${n === 1 ? 'día hábil' : 'días hábiles'}`

/**
 * El plazo de una fecha comprometida en palabras, con días de taller: «Vencida
 * hace 2 días hábiles», «Vence hoy», «Vence en 3 días hábiles», «Faltan 12
 * días hábiles». `faltan` viene de la base: negativo si ya venció.
 */
export function plazoEnPalabras(
  semaforo: Semaforo,
  faltan: number | null,
  { fechaPlan, hoy, femenino = true }: { fechaPlan: string | null; hoy: string; femenino?: boolean },
): string {
  const vencida = femenino ? 'Vencida' : 'Vencido'
  if (semaforo === 'SIN_FECHA') return 'Sin fecha comprometida'
  if (semaforo === 'ROJO') return faltan !== null && faltan < 0 ? `${vencida} hace ${dias(-faltan)}` : vencida
  if (semaforo === 'AMBAR') {
    if (fechaPlan === hoy) return 'Vence hoy'
    // Mañana feriado o domingo: vence antes del próximo día de taller.
    return faltan !== null && faltan > 0 ? `Vence en ${dias(faltan)}` : 'Vence antes del próximo día hábil'
  }
  if (semaforo === 'VERDE') return faltan !== null ? `Faltan ${dias(faltan)}` : 'A tiempo'
  return femenino ? 'Terminada' : 'Terminado'
}

/** Cómo terminó una etapa contra su fecha comprometida. */
export function comoTermino(finPlan: string | null, finReal: string): Def {
  if (finPlan && finReal > finPlan) return { etiqueta: 'Terminó tarde', tono: 'aviso' }
  return { etiqueta: finPlan ? 'Terminó a tiempo' : 'Terminada', tono: 'exito' }
}

/**
 * La etapa pide el reporte diario hoy: no terminó y ya empezó, o ya llegó su
 * inicio planeado o, sin él, su fecha comprometida. La que todavía no llega a
 * ninguna de las dos no pide reporte (Plan 1, entrega 1.3).
 */
export function pideReporteHoy(
  e: { fin_real?: string | null; inicio_real: string | null; inicio_plan: string | null; fin_plan: string | null },
  hoy: string,
): boolean {
  if (e.fin_real) return false
  if (e.inicio_real) return true
  const desde = e.inicio_plan ?? e.fin_plan
  return desde !== null && desde <= hoy
}

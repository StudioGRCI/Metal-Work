/**
 * Lo que comparten las pantallas de Recursos Humanos: el personal de planta,
 * la marcación del portero y la tardanza. Puro, sin consultas: lo usan el
 * servidor y el navegador.
 */

type Def = { etiqueta: string; tono: 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info' | 'acento' }

/** El tipo de cuenta donde se le paga a la persona. */
export const TIPO_CUENTA: Record<string, Def> = {
  AHORROS: { etiqueta: 'Ahorros', tono: 'neutro' },
  CORRIENTE: { etiqueta: 'Corriente', tono: 'neutro' },
  SUELDO: { etiqueta: 'Cuenta sueldo', tono: 'neutro' },
  CTS: { etiqueta: 'CTS', tono: 'neutro' },
}
export const TIPOS_CUENTA = ['AHORROS', 'CORRIENTE', 'SUELDO', 'CTS'] as const

/** Los bancos más comunes de la planilla, para no escribirlos de tres maneras. */
export const BANCOS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'Caja Piura', 'Caja Trujillo'] as const

/** Las dos marcas del día. */
export const TIPO_MARCA: Record<string, Def> = {
  INGRESO: { etiqueta: 'Ingreso', tono: 'exito' },
  SALIDA: { etiqueta: 'Salida', tono: 'info' },
}

/** `08:00:00` de la base → `08:00` para la pantalla y los campos `type="time"`. */
export function horaCorta(valor: string | null | undefined): string {
  if (!valor) return ''
  return valor.slice(0, 5)
}

/** El mes de hoy en Lima como `YYYY-MM`, para el resumen de tardanzas. */
export function mesDeLima(hoy: string): string {
  return hoy.slice(0, 7)
}

/** «1 h 05 min» para los minutos de tardanza; «—» si no hubo. */
export function minutosLargos(minutos: number): string {
  if (!minutos || minutos <= 0) return '—'
  if (minutos < 60) return `${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return `${h} h ${String(m).padStart(2, '0')} min`
}

/** El mes de la URL es válido si tiene la forma `2026-10` y un mes de 01 a 12. */
export function mesValido(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor)
}

/** La fecha de la URL es válida si tiene la forma `2026-10-13`. */
export function fechaValida(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor))
}

/** El mes anterior y el siguiente de un `YYYY-MM`, como texto, sin pasar por Date. */
export function mesVecino(mes: string, paso: -1 | 1): string {
  const [a, m] = mes.split('-').map(Number)
  const total = a * 12 + (m - 1) + paso
  const anio = Math.floor(total / 12)
  const mm = (total % 12) + 1
  return `${anio}-${String(mm).padStart(2, '0')}`
}

/** El día anterior y el siguiente de un `YYYY-MM-DD` (en UTC, que para una fecha plana no corre el día). */
export function diaVecino(dia: string, paso: -1 | 1): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + paso)
  return d.toISOString().slice(0, 10)
}

/** Las horas de un mes con que se divide el costo mensual: 30 días de 8 horas, la base del descuento por tardanza. */
export const HORAS_DEL_MES = 240

/** «6,5 h» para las horas del tareo. */
export function horasCortas(horas: number): string {
  return `${Number(horas.toFixed(2)).toLocaleString('es-PE', { maximumFractionDigits: 2 })} h`
}

/** Lo que se le registra a una persona, de lo más leve a lo más grave. */
export const TIPO_OBSERVACION: Record<string, Def> = {
  OBSERVACION: { etiqueta: 'Observación', tono: 'info' },
  AMONESTACION_VERBAL: { etiqueta: 'Amonestación verbal', tono: 'aviso' },
  AMONESTACION_ESCRITA: { etiqueta: 'Amonestación escrita', tono: 'peligro' },
  SUSPENSION: { etiqueta: 'Suspensión', tono: 'peligro' },
}
export const TIPOS_OBSERVACION = ['OBSERVACION', 'AMONESTACION_VERBAL', 'AMONESTACION_ESCRITA', 'SUSPENSION'] as const

/** Por qué: los del cuadro de penalidades de RR. HH. y lo que más se reclama en planta. */
export const MOTIVO_OBSERVACION: Record<string, Def> = {
  TARDANZAS: { etiqueta: 'Tardanzas', tono: 'neutro' },
  FALTA_INJUSTIFICADA: { etiqueta: 'Falta injustificada', tono: 'neutro' },
  EPP: { etiqueta: 'No usa su EPP', tono: 'neutro' },
  SEGURIDAD: { etiqueta: 'Seguridad en planta', tono: 'neutro' },
  CALIDAD: { etiqueta: 'Calidad del trabajo', tono: 'neutro' },
  CONDUCTA: { etiqueta: 'Conducta', tono: 'neutro' },
  OTRO: { etiqueta: 'Otro', tono: 'neutro' },
}
export const MOTIVOS_OBSERVACION = ['TARDANZAS', 'FALTA_INJUSTIFICADA', 'EPP', 'SEGURIDAD', 'CALIDAD', 'CONDUCTA', 'OTRO'] as const

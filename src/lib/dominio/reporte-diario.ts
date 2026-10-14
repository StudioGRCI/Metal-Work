/**
 * Lo que comparten las pantallas del reporte diario de Supervisión: los topes
 * que también exige `registrar_reporte_diario` y la suma de horas. Puro, sin
 * consultas: lo usan el servidor y el navegador.
 */

/** Las fotos de un reporte: las mismas que acepta la base. */
export const MAXIMO_FOTOS_REPORTE = 3

/** Los trabajos de un reporte. */
export const MAXIMO_TRABAJOS_REPORTE = 20

/** El supervisor sube el reporte de hoy o de hasta estos días atrás, y lo anula dentro de ese plazo. */
export const DIAS_PARA_EL_REPORTE = 7

/** El bucket privado de las fotos: la ruta es `{cuenta}/{reporte}/{foto}.jpg`. */
export const BUCKET_FOTOS_REPORTE = 'fotos-reporte-diario'

/** Lo que pesa como máximo una foto ya comprimida (el tope del bucket). */
export const MAXIMO_MB_FOTO_REPORTE = 5

/** Una persona con sus horas, como la manda el formulario. */
export type PersonaConHoras = { trabajador_id: string; horas: number }

/** Un trabajo realizado, como lo manda el formulario. */
export type TrabajoDelReporte = { descripcion: string; avance: number; personal: PersonaConHoras[] }

/** Las horas de cada persona en todo el reporte, sumando sus trabajos. */
export function horasPorPersona(lineas: { trabajador_id: string; horas: number }[]): Map<string, number> {
  const suma = new Map<string, number>()
  for (const l of lineas) suma.set(l.trabajador_id, (suma.get(l.trabajador_id) ?? 0) + l.horas)
  return suma
}

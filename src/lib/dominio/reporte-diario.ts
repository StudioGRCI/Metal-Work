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

/** El área que da el visto bueno o la observación. En pantalla se nombra el área, nunca a la persona. */
export type LadoValidacion = 'GERENCIA' | 'RRHH'

export const AREA_QUE_VALIDA: Record<LadoValidacion, string> = { GERENCIA: 'Gerencia', RRHH: 'Recursos Humanos' }

/** En qué va un reporte: lo mismo que calcula `reporte_diario_estado` en la base. */
export type EstadoReporte = 'POR_VALIDAR' | 'OBSERVADO' | 'VALIDADO' | 'ANULADO'

export const ESTADO_REPORTE: Record<EstadoReporte, { etiqueta: string; tono: 'info' | 'aviso' | 'exito' | 'peligro' }> = {
  POR_VALIDAR: { etiqueta: 'Por validar', tono: 'info' },
  OBSERVADO: { etiqueta: 'Observado', tono: 'aviso' },
  VALIDADO: { etiqueta: 'Validado', tono: 'exito' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro' },
}

type ConValidacion = {
  anulado_en: string | null
  observado_en: string | null
  visto_gerencia_en: string | null
  visto_rrhh_en: string | null
}

export function estadoDeReporte(r: ConValidacion): EstadoReporte {
  if (r.anulado_en) return 'ANULADO'
  if (r.observado_en) return 'OBSERVADO'
  if (r.visto_gerencia_en && r.visto_rrhh_en) return 'VALIDADO'
  return 'POR_VALIDAR'
}

/** «Falta Gerencia», «Falta Recursos Humanos» o «Faltan Gerencia y Recursos Humanos»; `null` si no está por validar. */
export function faltaParaValidar(r: ConValidacion): string | null {
  if (estadoDeReporte(r) !== 'POR_VALIDAR') return null
  if (!r.visto_gerencia_en && !r.visto_rrhh_en) return 'Faltan Gerencia y Recursos Humanos'
  return `Falta ${r.visto_gerencia_en ? 'Recursos Humanos' : 'Gerencia'}`
}

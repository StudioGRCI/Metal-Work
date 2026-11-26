import type { Tono } from '@/components/ui/etiqueta-estado'

/*
 * El reporte de avería (Plan 16.2, migración 20261126100100): la avería o la
 * posible avería de un equipo del padrón, que reporta cualquier cuenta. Lo que
 * la pantalla y la acción comparten con la base.
 */

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

/** Lo que se reporta: primero lo que ya falla. */
export const TIPOS_AVERIA = ['AVERIA', 'POSIBLE_AVERIA'] as const
export type TipoAveria = (typeof TIPOS_AVERIA)[number]

export const TIPO_AVERIA: Record<string, Def> = {
  AVERIA: { etiqueta: 'Avería', tono: 'peligro', descripcion: 'Ya falla: no funciona o funciona mal.' },
  POSIBLE_AVERIA: {
    etiqueta: 'Posible avería',
    tono: 'aviso',
    descripcion: 'Todavía funciona, pero algo anuncia que va a fallar: un ruido, un olor, una vibración, una pieza floja.',
  },
}

/**
 * El camino del reporte (migración 20261126950000, Plan 16.3): reportada, en
 * atención (Mantenimiento anotó su diagnóstico), cerrada (espera que quien la
 * reportó confirme) y confirmada. Si no quedó bien, vuelve a «en atención».
 */
export const ESTADO_AVERIA: Record<string, Def> = {
  REPORTADA: { etiqueta: 'Por atender', tono: 'aviso', descripcion: 'Reportada: espera que Mantenimiento la revise.' },
  EN_ATENCION: { etiqueta: 'En atención', tono: 'info', descripcion: 'Mantenimiento la revisó y la está arreglando.' },
  CERRADA: { etiqueta: 'Por confirmar', tono: 'acento', descripcion: 'Mantenimiento la cerró: quien la reportó confirma si quedó bien.' },
  CONFIRMADA: { etiqueta: 'Quedó bien', tono: 'exito', descripcion: 'Quien la reportó confirmó que quedó bien.' },
  ANULADA: { etiqueta: 'Anulada', tono: 'neutro', descripcion: 'Mantenimiento la anuló con su motivo.' },
}

/**
 * La bandeja de Mantenimiento (DKS: «por gravedad y días en espera»): primero la
 * más grave; entre las de la misma gravedad, la que lleva más días esperando; y
 * entre las del mismo día, la que se reportó antes.
 */
export function ordenarBandeja<T extends { gravedad: number; dias_en_espera: number | null; creado_en: string }>(averias: readonly T[]): T[] {
  return [...averias].sort(
    (a, b) =>
      a.gravedad - b.gravedad ||
      (b.dias_en_espera ?? -1) - (a.dias_en_espera ?? -1) ||
      a.creado_en.localeCompare(b.creado_en),
  )
}

/**
 * Las horas que el equipo lleva parado por el reporte, para proponerlas al
 * cerrar: de cuando quedó parado a ahora, redondeadas a media hora. Sin paro,
 * nada: Mantenimiento las escribe.
 */
export function horasParadoSugeridas(paradoDesde: string | null, ahora: Date = new Date()): number | null {
  if (!paradoDesde) return null
  const ms = ahora.getTime() - new Date(paradoDesde).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round((ms / 3_600_000) * 2) / 2
}

/** «1 hora», «26.5 horas», «0 horas»: con el punto decimal de `cantidad()` (es-PE), como el resto de la aplicación. */
export function horas(valor: number): string {
  const texto = Number.isInteger(valor) ? String(valor) : valor.toFixed(1)
  return `${texto} ${valor === 1 ? 'hora' : 'horas'}`
}

/** El bucket privado de las fotos: la ruta es `{cuenta}/{averia}/{foto}.jpg`. */
export const BUCKET_FOTOS_AVERIAS = 'fotos-averias'

/** Hasta cuatro fotos por reporte, como exige `averias_anotar_fotos`. */
export const MAXIMO_FOTOS_AVERIA = 4

/** Lo que pesa como máximo una foto ya achicada en el teléfono (el tope del bucket). */
export const MAXIMO_MB_FOTO_AVERIA = 5

/**
 * Por qué alcance ve un reporte quien mira (`averias_visibles`): todos, el suyo,
 * el de su área (donde trabaja o que tiene a cargo) o, SSOMA, el que es un riesgo.
 */
export type AlcanceAveria = 'TODAS' | 'PROPIA' | 'AREA' | 'RIESGO'

/** A quién le llegó el aviso del reporte, como lo cuenta `averias_a_quien_se_aviso`. */
export type AvisosDeLaAveria = {
  mantenimiento: boolean
  responsable: boolean
  ssoma: boolean
  gerencia: boolean
}

/** «A, B y C». */
function enLista(partes: string[]) {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
}

/**
 * Lo que dice el verde según a quién le llegó el aviso: nunca «ya le avisamos a
 * Mantenimiento» si no había nadie de Mantenimiento que lo recibiera.
 * `atiende`: quien reporta es de Mantenimiento, y el aviso no se manda a sí mismo.
 */
export function aQuienSeAviso(
  numero: string,
  avisos: AvisosDeLaAveria,
  { atiende, riesgo, parado, codigo }: { atiende: boolean; riesgo: boolean; parado: boolean; codigo: string },
): string {
  const partes: string[] = []
  // Quien es de Mantenimiento no se avisa a sí mismo: no se le dice que «le avisamos a Mantenimiento».
  if (avisos.mantenimiento && !atiende) partes.push('a Mantenimiento')
  if (avisos.responsable) partes.push('al responsable del área')
  if (avisos.ssoma) partes.push('a SSOMA')
  let texto = `Reporte ${numero} registrado.${parado ? ` El equipo ${codigo} quedó parado.` : ''}`
  if (partes.length > 0) texto += ` Ya ${partes.length === 1 ? 'le' : 'les'} avisamos ${enLista(partes)}.`
  // Lo que no tenía quién lo recibiera, todo junto: sin Mantenimiento y sin SSOMA a la vez se dicen los dos.
  const faltan = [
    ...(!atiende && !avisos.mantenimiento ? ['Mantenimiento'] : []),
    ...(riesgo && !avisos.ssoma ? ['SSOMA'] : []),
  ]
  if (faltan.length > 0) {
    texto += avisos.gerencia
      ? ` No hay una cuenta activa de ${enLista(faltan)}: le avisamos a Gerencia.`
      : ` No hay una cuenta activa de ${enLista(faltan)} para recibir el aviso: cuéntaselo a tu jefe.`
  }
  return texto
}

/**
 * Cuánto lleva parado un equipo, dicho como se habla: «5 horas» o, desde dos
 * días, «3 días» (días cumplidos). Para la lectura de Gerencia y la ficha del equipo.
 */
export function tiempoParado(horasParado: number): string {
  if (horasParado >= 48) {
    const dias = Math.floor(horasParado / 24)
    return `${dias} días`
  }
  const redondo = Math.round(horasParado * 2) / 2
  // «Lleva 0 horas parado» se leía como que no está parado.
  return redondo < 1 ? 'menos de una hora' : horas(redondo)
}

/** Lo que hace falta de la historia de un equipo para saber cuánto falla. */
export type FallasDelEquipo = { averias90: number; horasParado90: number; repetidas90: number }

/**
 * Los equipos que más fallan (DKS: «los que más fallan»): los de los últimos 90
 * días, primero el que tuvo más averías; entre iguales, el que estuvo más horas
 * parado y, después, el que más repitió. Los que no fallaron no entran.
 */
export function losQueMasFallan<T extends FallasDelEquipo>(equipos: readonly T[], cuantos = 5): T[] {
  return equipos
    .filter((e) => e.averias90 > 0)
    .sort((a, b) => b.averias90 - a.averias90 || b.horasParado90 - a.horasParado90 || b.repetidas90 - a.repetidas90)
    .slice(0, cuantos)
}

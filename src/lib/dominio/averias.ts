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

export const ESTADO_AVERIA: Record<string, Def> = {
  REPORTADA: { etiqueta: 'En Mantenimiento', tono: 'aviso', descripcion: 'Reportada: la tiene Mantenimiento.' },
  ANULADA: { etiqueta: 'Anulada', tono: 'neutro', descripcion: 'Mantenimiento la anuló con su motivo.' },
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
  if (avisos.mantenimiento && !atiende) partes.push('Mantenimiento')
  if (avisos.responsable) partes.push('el responsable del área')
  if (avisos.ssoma) partes.push('SSOMA')
  let texto = `Reporte ${numero} registrado.${parado ? ` El equipo ${codigo} quedó parado.` : ''}`
  if (partes.length > 0) texto += ` Ya le avisamos a ${enLista(partes)}.`
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

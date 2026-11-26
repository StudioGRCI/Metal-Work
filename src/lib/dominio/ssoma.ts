import type { Tono } from '@/components/ui/etiqueta-estado'

/*
 * SSOMA (migración 20261125150100): el reporte de un accidente, un incidente o
 * una condición insegura, que hace cualquier cuenta. Lo que la pantalla y la
 * acción comparten con la base.
 */

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

/** Lo que se reporta, en el orden de gravedad con que se ofrece. */
export const TIPOS_REPORTE_SSOMA = ['ACCIDENTE', 'INCIDENTE', 'CONDICION_INSEGURA'] as const
export type TipoReporteSsoma = (typeof TIPOS_REPORTE_SSOMA)[number]

export const TIPO_REPORTE_SSOMA: Record<string, Def> = {
  ACCIDENTE: { etiqueta: 'Accidente', tono: 'peligro', descripcion: 'Alguien se lastimó, aunque sea leve.' },
  INCIDENTE: { etiqueta: 'Incidente', tono: 'aviso', descripcion: 'Pasó algo que pudo lastimar a alguien y no lo hizo.' },
  CONDICION_INSEGURA: {
    etiqueta: 'Condición insegura',
    tono: 'info',
    descripcion: 'Algo que está mal y puede causar un accidente: un cable pelado, una guarda que falta, un piso con aceite.',
  },
}

export const ESTADO_REPORTE_SSOMA: Record<string, Def> = {
  REPORTADO: {
    etiqueta: 'En SSOMA',
    tono: 'aviso',
    descripcion: 'Reportado: lo tiene SSOMA, por clasificar.',
  },
  CLASIFICADO: {
    etiqueta: 'En corrección',
    tono: 'info',
    descripcion: 'SSOMA lo clasificó y define o sigue las acciones correctivas.',
  },
  CERRADO: {
    etiqueta: 'Corregido',
    tono: 'exito',
    descripcion: 'Todas sus acciones correctivas se cerraron con evidencia.',
  },
  ANULADO: {
    etiqueta: 'Anulado',
    tono: 'neutro',
    descripcion: 'SSOMA lo anuló con su motivo.',
  },
}

/*
 * Entrega 15.2 (migración 20261126151500): SSOMA clasifica, anota la causa y
 * encarga acciones correctivas a una cuenta, con fecha límite.
 */

/** Las clases del registro de la R.M. 050-2013-TR, en el orden en que se ofrecen. */
export const CLASIFICACIONES_SSOMA = [
  'ACCIDENTE_LEVE',
  'ACCIDENTE_INCAPACITANTE',
  'ACCIDENTE_MORTAL',
  'INCIDENTE_PELIGROSO',
  'INCIDENTE',
  'CONDICION_INSEGURA',
] as const
export type ClasificacionSsoma = (typeof CLASIFICACIONES_SSOMA)[number]

export const CLASIFICACION_SSOMA: Record<string, Def> = {
  ACCIDENTE_LEVE: {
    etiqueta: 'Accidente leve',
    tono: 'peligro',
    descripcion: 'Con descanso breve: vuelve a trabajar a más tardar al día siguiente.',
  },
  ACCIDENTE_INCAPACITANTE: {
    etiqueta: 'Accidente incapacitante',
    tono: 'peligro',
    descripcion: 'Con descanso médico de uno o más días: se anotan los días perdidos.',
  },
  ACCIDENTE_MORTAL: {
    etiqueta: 'Accidente mortal',
    tono: 'peligro',
    descripcion: 'La lesión causó la muerte.',
  },
  INCIDENTE_PELIGROSO: {
    etiqueta: 'Incidente peligroso',
    tono: 'aviso',
    descripcion: 'Pudo causar lesiones graves o enfermedad a las personas.',
  },
  INCIDENTE: {
    etiqueta: 'Incidente',
    tono: 'aviso',
    descripcion: 'Pasó algo, sin lesión ni riesgo grave.',
  },
  CONDICION_INSEGURA: {
    etiqueta: 'Condición insegura',
    tono: 'info',
    descripcion: 'Algo que está mal y puede causar un accidente.',
  },
}

/** Si la clase es de un accidente: lleva la atención médica (y el incapacitante, sus días perdidos). */
export const esAccidente = (clase: string) => clase.startsWith('ACCIDENTE_')

export const ESTADO_ACCION_SSOMA: Record<string, Def> = {
  ABIERTA: {
    etiqueta: 'Abierta',
    tono: 'aviso',
    descripcion: 'La tiene su responsable.',
  },
  CERRADA: {
    etiqueta: 'Cerrada',
    tono: 'exito',
    descripcion: 'Cerrada con evidencia.',
  },
  ANULADA: {
    etiqueta: 'Anulada',
    tono: 'neutro',
    descripcion: 'SSOMA la anuló con su motivo.',
  },
}

/** Lo que dice la historia de cada paso de una acción. */
export const PASO_ACCION_SSOMA: Record<string, string> = {
  ASIGNADA: 'Encargada',
  REASIGNADA: 'Reasignada',
  CERRADA: 'Cerrada con evidencia',
  REABIERTA: 'Reabierta por SSOMA',
  ANULADA: 'Anulada por SSOMA',
}

/** Por qué alcance ve una acción quien mira (`ssoma_acciones_visibles`). */
export type AlcanceAccionSsoma = 'TODOS' | 'RESPONSABLE' | 'REPORTE'

/** Hasta cuatro fotos de evidencia por cierre, como exige `ssoma_anotar_evidencia`. */
export const MAXIMO_FOTOS_EVIDENCIA = 4

/**
 * «Vence hoy», «vence mañana», «vence en 3 días», «venció ayer», «venció hace
 * 4 días»: los días los cuenta la base con la fecha de Lima.
 */
export function cuandoVence(dias: number | null): { texto: string; tono: Tono } | null {
  if (dias === null) return null
  if (dias < 0)
    return {
      texto: dias === -1 ? 'venció ayer' : `venció hace ${-dias} días`,
      tono: 'peligro',
    }
  if (dias === 0) return { texto: 'vence hoy', tono: 'aviso' }
  if (dias === 1) return { texto: 'vence mañana', tono: 'aviso' }
  return { texto: `vence en ${dias} días`, tono: 'neutro' }
}

/**
 * El orden de una lista de acciones: las vencidas arriba (la que venció hace más,
 * primero), después las abiertas por su fecha, después las cerradas (la más
 * reciente primero) y al final las anuladas.
 */
export function ordenDeAcciones<
  T extends {
    estado: string
    dias_para_vencer: number | null
    fecha_limite: string
    cerrado_en: string | null
    creado_en: string
  },
>(acciones: T[]): T[] {
  const grupo = (a: T) => (a.estado === 'ABIERTA' ? ((a.dias_para_vencer ?? 0) < 0 ? 0 : 1) : a.estado === 'CERRADA' ? 2 : 3)
  return [...acciones].sort((a, b) => {
    const g = grupo(a) - grupo(b)
    if (g !== 0) return g
    if (grupo(a) <= 1) return a.fecha_limite.localeCompare(b.fecha_limite) || a.creado_en.localeCompare(b.creado_en)
    return (b.cerrado_en ?? b.creado_en).localeCompare(a.cerrado_en ?? a.creado_en)
  })
}

/** El bucket privado de las fotos: la ruta es `{cuenta}/{reporte}/{foto}.jpg`. */
export const BUCKET_FOTOS_SSOMA = 'fotos-ssoma'

/** Hasta cuatro fotos por reporte, como exige `ssoma_anotar_fotos`. */
export const MAXIMO_FOTOS_SSOMA = 4

/** Lo que pesa como máximo una foto ya achicada en el teléfono (el tope del bucket). */
export const MAXIMO_MB_FOTO_SSOMA = 5

/**
 * Por qué alcance ve un reporte quien mira (`ssoma_reportes_visibles`): todo,
 * el suyo, el de su área, o el de una acción que tiene a cargo (15.2). Los dos
 * últimos, sin quién lo reportó ni las fotos.
 */
export type AlcanceSsoma = 'TODOS' | 'PROPIO' | 'AREA' | 'ACCION'

/** «Hoy», «hace 1 día», «hace 3 días»: lo que lleva esperando, contado en la base con la fecha de Lima. */
export function diasEnEspera(dias: number | null): string | null {
  if (dias === null) return null
  if (dias <= 0) return 'hoy'
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

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
  REPORTADO: { etiqueta: 'En SSOMA', tono: 'aviso', descripcion: 'Reportado: lo tiene SSOMA.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'neutro', descripcion: 'SSOMA lo anuló con su motivo.' },
}

/** El bucket privado de las fotos: la ruta es `{cuenta}/{reporte}/{foto}.jpg`. */
export const BUCKET_FOTOS_SSOMA = 'fotos-ssoma'

/** Hasta cuatro fotos por reporte, como exige `ssoma_anotar_fotos`. */
export const MAXIMO_FOTOS_SSOMA = 4

/** Lo que pesa como máximo una foto ya achicada en el teléfono (el tope del bucket). */
export const MAXIMO_MB_FOTO_SSOMA = 5

/** Por qué alcance ve un reporte quien mira (`ssoma_reportes_visibles`). */
export type AlcanceSsoma = 'TODOS' | 'PROPIO' | 'AREA'

/** «Hoy», «hace 1 día», «hace 3 días»: lo que lleva esperando, contado en la base con la fecha de Lima. */
export function diasEnEspera(dias: number | null): string | null {
  if (dias === null) return null
  if (dias <= 0) return 'hoy'
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

import type { Tono } from '@/components/ui/etiqueta-estado'
import { fecha } from '@/lib/format'

/**
 * Lo que Diseño carga por código interno de la unidad (migración
 * 20261015200000): los planos de cada área, la lista de materiales y las
 * etapas. Puro, sin consultas: lo usan las pantallas de Diseño, la del
 * supervisor y la de Gerencia.
 */

/** El bucket privado de los PDF de los planos: `{plano}/{revisión}.pdf`. */
export const BUCKET_PLANOS_CODIGO = 'planos-codigo'
export const MAXIMO_MB_PLANO = 20

/** Las áreas de producción a las que va un plano. */
export const AREAS_DE_PLANOS = ['MTZ', 'PRD', 'ACB'] as const

export function rutaPlanoCodigo(plano: string, revision: string) {
  return `${plano}/${revision}.pdf`
}

/** Las secciones del código en Diseño, en el orden de su trabajo. */
export const VISTAS_DISENO = [
  { valor: 'planos', etiqueta: 'Planos', titulo: 'Planos' },
  { valor: 'materiales', etiqueta: 'Materiales', titulo: 'Gestión de materiales' },
  { valor: 'etapas', etiqueta: 'Etapas', titulo: 'Control de etapas' },
] as const

export type VistaDiseno = (typeof VISTAS_DISENO)[number]['valor']

export function vistaDisenoValida(valor: unknown): VistaDiseno {
  return VISTAS_DISENO.some((v) => v.valor === valor) ? (valor as VistaDiseno) : 'planos'
}

/** El código lleva «/»: va en la consulta, no en la ruta. */
export function enlaceDisenoCodigo(codigo: string, vista?: VistaDiseno) {
  const query = new URLSearchParams({ codigo })
  if (vista && vista !== 'planos') query.set('vista', vista)
  return `/diseno/codigo?${query}`
}

/** El tamaño de un PDF para leerlo de un vistazo: «2.4 MB», «350 KB». */
export function tamanoArchivo(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Días de una fecha a otra, las dos `YYYY-MM-DD`: negativo si la segunda es antes. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000)
}

type Def = { etiqueta: string; tono: Tono }

export type EtapaConFechas = {
  inicio_real: string | null
  fin_real: string | null
  fin_plan: string | null
}

/** En qué va una etapa: por empezar, en proceso o terminada. */
export function estadoEtapa(e: EtapaConFechas): Def & { valor: 'PENDIENTE' | 'EN_PROCESO' | 'TERMINADA' } {
  if (e.fin_real) return { valor: 'TERMINADA', etiqueta: 'Terminada', tono: 'exito' }
  if (e.inicio_real) return { valor: 'EN_PROCESO', etiqueta: 'En proceso', tono: 'info' }
  return { valor: 'PENDIENTE', etiqueta: 'Por empezar', tono: 'neutro' }
}

/** Cuántos días antes de la fecha comprometida se avisa que vence. */
export const DIAS_POR_VENCER = 3

/**
 * El semáforo de una etapa contra su fecha comprometida, como la hoja «Control
 * de plazos»: terminada a tiempo o con atraso; si no terminó, vencida, por
 * vencer, a tiempo o sin fecha.
 */
export function plazoEtapa(e: EtapaConFechas, hoy: string): Def {
  if (e.fin_real) {
    const atraso = e.fin_plan ? diasEntre(e.fin_plan, e.fin_real) : 0
    return atraso > 0
      ? { etiqueta: `Terminó ${atraso} ${atraso === 1 ? 'día' : 'días'} tarde`, tono: 'aviso' }
      : { etiqueta: 'A tiempo', tono: 'exito' }
  }
  if (!e.fin_plan) return { etiqueta: 'Sin fecha comprometida', tono: 'neutro' }
  const faltan = diasEntre(hoy, e.fin_plan)
  if (faltan < 0) return { etiqueta: `Vencida hace ${-faltan} ${faltan === -1 ? 'día' : 'días'}`, tono: 'peligro' }
  if (faltan === 0) return { etiqueta: 'Vence hoy', tono: 'aviso' }
  if (faltan <= DIAS_POR_VENCER) return { etiqueta: `Vence en ${faltan} ${faltan === 1 ? 'día' : 'días'}`, tono: 'aviso' }
  return { etiqueta: `Vence el ${fecha(e.fin_plan)}`, tono: 'info' }
}

/** Lo comprado o salido contra lo que puso Diseño, en una palabra. */
export function comparacionMaterial(m: { disenado: number | null; comprado: number; salido: number }): Def {
  if (m.disenado === null) return { etiqueta: 'Fuera de la lista', tono: 'aviso' }
  const usado = Math.max(m.comprado, m.salido)
  if (usado === 0) return { etiqueta: 'Sin pedir', tono: 'neutro' }
  if (usado > m.disenado) return { etiqueta: 'Pasa lo diseñado', tono: 'aviso' }
  if (m.salido >= m.disenado) return { etiqueta: 'Completo', tono: 'exito' }
  return { etiqueta: 'En camino', tono: 'info' }
}

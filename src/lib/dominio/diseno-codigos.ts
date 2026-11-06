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

/**
 * Las dos áreas a las que Diseño les pone su etapa, por cada juego de planos:
 * Maestranza (habilitado) y Producción (ensamblaje). Las subetapas y las etapas
 * de las demás áreas las agrega el supervisor de cada una (observaciones de
 * Diseño, 2026-11-06; migración 20261106100000).
 */
export const AREAS_DE_ETAPA_DE_DISENO = ['MTZ', 'PRD'] as const

/**
 * Los DXF comprimidos de cada código (`dxf-codigo/{id}.{zip|rar|7z}`). Los sube
 * Diseño; los ven Diseño y Maestranza.
 */
export const BUCKET_DXF = 'dxf-codigo'
export const MAXIMO_MB_DXF = 50
export const EXTENSIONES_DXF = ['zip', 'rar', '7z'] as const
export type ExtensionDxf = (typeof EXTENSIONES_DXF)[number]

/** El tipo con que se sube cada comprimido: el que el bucket acepta. */
export const TIPO_DXF: Record<ExtensionDxf, string> = {
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
}

/** La extensión del comprimido por su nombre, o null si no es .zip, .rar ni .7z. */
export function extensionDxf(nombre: string): ExtensionDxf | null {
  const ext = nombre.trim().toLowerCase().split('.').pop() ?? ''
  return (EXTENSIONES_DXF as readonly string[]).includes(ext) ? (ext as ExtensionDxf) : null
}

export function rutaDxf(id: string, ext: ExtensionDxf) {
  return `${id}.${ext}`
}

/** Las secciones del código en Diseño, en el orden de su trabajo. */
export const VISTAS_DISENO = [
  { valor: 'planos', etiqueta: 'Planos', titulo: 'Planos' },
  { valor: 'materiales', etiqueta: 'Materiales', titulo: 'Gestión de materiales' },
  { valor: 'etapas', etiqueta: 'Etapas', titulo: 'Control de etapas' },
  { valor: 'dxf', etiqueta: 'DXF', titulo: 'Archivos DXF' },
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

/**
 * Las mismas secciones para quien sigue el código sin cambiar nada
 * (Supervisión general y Almacén, `codigos_internos.seguimiento`; migración
 * 20261016110000), con las etapas primero: es lo que más se mira.
 */
export const VISTAS_SEGUIMIENTO = [
  { valor: 'etapas', etiqueta: 'Etapas' },
  { valor: 'materiales', etiqueta: 'Materiales' },
  { valor: 'planos', etiqueta: 'Planos' },
] as const satisfies readonly { valor: VistaDiseno; etiqueta: string }[]

export function vistaSeguimientoValida(valor: unknown): VistaDiseno {
  return VISTAS_SEGUIMIENTO.some((v) => v.valor === valor) ? (valor as VistaDiseno) : 'etapas'
}

export function enlaceSeguimientoCodigo(codigo: string, vista?: VistaDiseno) {
  const query = new URLSearchParams({ codigo })
  if (vista && vista !== 'etapas') query.set('vista', vista)
  return `/seguimiento/codigo?${query}`
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

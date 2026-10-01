/**
 * El informe semanal de Diseño tal como lo pide el formato de la empresa
 * «Informe semanal – Área de Ingeniería» (MW-IF-DI-01, versión 1.0, revisado
 * el 30/05/2026). Lo llena el colaborador de Diseño; lo revisa Diseño y lo
 * recibe Administración (migraciones 20260930093000 y 20261001201500).
 */

export const FORMATO_INFORME_DISENO = {
  codigo: 'MW-IF-DI-01',
  version: '1.0',
  revision: '30/05/2026',
  titulo: 'Informe semanal – Área de Ingeniería',
  planta: 'Metal Work',
  area: 'Diseño',
} as const

/** Las tareas de la tabla «Planificación de modelado», con el nombre que usa el formato. */
export const TAREAS_DISENO = {
  MODELADO: 'Modelado',
  MODELADO_3D: 'Modelado 3D',
  PLOTEO: 'Ploteo',
  MODELADO_Y_PLOTEO: 'Modelado y ploteo',
  CREACION_PLANO: 'Creación de planos',
  PLANO_CORTE_DXF: 'Creación de plano de corte DXF',
  ENSAMBLE_3D: 'Ensamble 3D',
  MODIFICACION_MODELO: 'Modificación de modelo',
  MODIFICACION_PLANO: 'Modificación de planos',
  REVISION: 'Revisión',
  SOPORTE: 'Soporte técnico',
  OTRA: 'Otra tarea',
} as const

export type TareaDiseno = keyof typeof TAREAS_DISENO
export const CLAVES_TAREA = Object.keys(TAREAS_DISENO) as [TareaDiseno, ...TareaDiseno[]]

export function nombreTarea(tipo: string): string {
  return (TAREAS_DISENO as Record<string, string>)[tipo] ?? tipo.replaceAll('_', ' ').toLowerCase()
}

/** Las áreas que reciben planos, por su código en `areas`. */
export const AREAS_QUE_RECIBEN = { MTZ: 'Maestranza', PRD: 'Producción', ACB: 'Acabados' } as const
export type AreaQueRecibe = keyof typeof AREAS_QUE_RECIBEN
export const CLAVES_AREA = Object.keys(AREAS_QUE_RECIBEN) as [AreaQueRecibe, ...AreaQueRecibe[]]

export const ESTADOS_ENTREGA = { CULMINADO: 'Culminado', EN_PROCESO: 'En proceso' } as const

/**
 * «Código interno / OT», como lo escribe Diseño: el código de fabricación de
 * la unidad y el número de la OT sin el año («COM_CM_N2_1_26/43/2922»). Las
 * unidades por garantía o mantenimiento no tienen código interno: solo la OT.
 */
export function codigoInternoOt(codigo: string | null | undefined, numeroOt: string | null | undefined): string {
  const ot = (numeroOt ?? '').trim().replace(/-\d{4}$/, '')
  const interno = (codigo ?? '').trim()
  if (interno && ot) return `${interno}/${ot}`
  return interno || ot || '—'
}

/** CM (carrocería montada) o SR (semirremolque), como en la columna «Tipo de carrocería». */
export function siglaCarroceria(tipoUnidad: string | null | undefined): string {
  if (tipoUnidad === 'CARROCERIA_MONTADA') return 'CM'
  if (tipoUnidad === 'SEMIRREMOLQUE') return 'SR'
  return '—'
}

/** El número del informe con tres cifras, como en el formato: «021». */
export function numeroInforme(numero: number | null | undefined): string {
  return numero ? String(numero).padStart(3, '0') : '—'
}

/** La fecha del informe es el sábado de su semana: el último día de trabajo. */
export function fechaDelInforme(inicio: string): string {
  const d = new Date(`${inicio}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 5)
  return d.toISOString().slice(0, 10)
}

/** Un texto del formulario partido en viñetas: una idea por línea. */
export function vinetas(texto: string | null | undefined): string[] {
  return (texto ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

/** Lo que la conclusión del informe suma: planos entregados a cada área. */
export function planosPorArea(entregas: readonly { n_planos: number; estado: string; entregado_a: readonly string[] }[]) {
  return CLAVES_AREA.map((area) => ({
    area,
    nombre: AREAS_QUE_RECIBEN[area],
    planos: entregas
      .filter((e) => e.estado === 'CULMINADO' && e.entregado_a.includes(area))
      .reduce((total, e) => total + e.n_planos, 0),
  })).filter((a) => a.planos > 0)
}

import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * Lo que comparten las pantallas de los códigos internos de Gerencia. Puro, sin
 * consultas: las cuentas y las etiquetas que no son de la base.
 */

/** El código como lo guarda la base: sin espacios de más y en mayúsculas (`normalizar_codigo_interno`). */
export function normalizarCodigo(codigo: string): string {
  return codigo.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * La llave para ver si dos códigos son el mismo mal escrito: solo letras y
 * números, y la O como cero. En el sistema conviven `PLA_SR_O4_1_26/28` (con O)
 * y `PLA_SR_04_1_26/27` (con cero), y `ABR_CM_N1_1_26-12` junto a
 * `ABR_CM_N1_1_26/12`: la base no puede saber si son uno, Gerencia sí.
 */
export function llaveParecido(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0')
}

/** Para cada código, los otros que se escriben casi igual. */
export function parecidos(codigos: string[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>()
  for (const c of codigos) {
    const llave = llaveParecido(c)
    grupos.set(llave, [...(grupos.get(llave) ?? []), c])
  }
  const resultado = new Map<string, string[]>()
  for (const c of codigos) {
    const otros = (grupos.get(llaveParecido(c)) ?? []).filter((o) => o !== c)
    if (otros.length > 0) resultado.set(c, otros)
  }
  return resultado
}

/**
 * Lo que lleva costado un código: mano de obra más materiales salidos del
 * almacén. Las compras NO entran: lo comprado se cuenta cuando sale del almacén
 * para el código (migración 20261014220000). Los dólares van aparte, sin cambio.
 */
export function costoDelCodigo(c: { mano_obra: number; materiales_pen: number; materiales_usd: number }) {
  return { pen: c.mano_obra + c.materiales_pen, usd: c.materiales_usd }
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Dónde aparece un código, en una línea: «4 reportes · 3 salidas del almacén · 1 RQ». */
export function dondeAparece(c: {
  reportes: number
  salidas: number
  requerimientos: number
  compras: number
  unidades: number
  ordenes: number
  servicios: number
  vehiculos: number
  horas: number
}): string {
  const partes = [
    c.reportes > 0 && plural(c.reportes, 'reporte diario', 'reportes diarios'),
    c.reportes === 0 && c.horas > 0 && 'horas de RR. HH.',
    c.salidas > 0 && plural(c.salidas, 'salida del almacén', 'salidas del almacén'),
    c.requerimientos > 0 && plural(c.requerimientos, 'RQ', 'RQ'),
    c.compras > 0 && plural(c.compras, 'OC', 'OC'),
    c.servicios > 0 && plural(c.servicios, 'OS', 'OS'),
    c.unidades > 0 && plural(c.unidades, 'unidad', 'unidades'),
    c.ordenes > 0 && plural(c.ordenes, 'OT', 'OT'),
    c.vehiculos > 0 && plural(c.vehiculos, 'ingreso a la planta', 'ingresos a la planta'),
  ].filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : 'Solo en documentos anulados'
}

/**
 * Lo que va en lugar de «S/ 0.00» cuando no hay nada con precio pero sí cosas sin
 * él: un cero ahí se lee como «no costó nada», y lo que pasa es que falta el precio.
 */
export function faltaElPrecio(monto: number, pendientes: number, etiqueta = 'Sin precio'): string | null {
  return monto === 0 && pendientes > 0 ? etiqueta : null
}

/** Un trabajo de un reporte, como lo devuelve `codigo_interno_avance`. */
export type TrabajoReportado = {
  reporte_id: string
  fecha: string
  creado_en: string
  trabajo_orden: number
  trabajo: string
  avance: number
}

/** Un trabajo con su último avance, reconocido por su descripción sin mayúsculas ni espacios de más. */
export type TrabajoConAvance = {
  trabajo: string
  avance: number
  fecha: string
  reportes: number
  /** Los avances de ese trabajo, del primero al último. */
  historial: { fecha: string; avance: number }[]
}

function llaveTrabajo(trabajo: string) {
  return trabajo.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * El último avance de cada trabajo: la misma regla que `codigos_internos_resumen`
 * usa para el avance medio, así la lista y el detalle no dicen cosas distintas.
 */
export function ultimoAvancePorTrabajo(filas: TrabajoReportado[]): TrabajoConAvance[] {
  const orden = [...filas].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.creado_en.localeCompare(b.creado_en) || b.trabajo_orden - a.trabajo_orden,
  )
  const trabajos = new Map<string, TrabajoConAvance>()
  for (const f of orden) {
    const llave = llaveTrabajo(f.trabajo)
    const previo = trabajos.get(llave)
    trabajos.set(llave, {
      trabajo: f.trabajo,
      avance: f.avance,
      fecha: f.fecha,
      reportes: (previo?.reportes ?? 0) + 1,
      historial: [...(previo?.historial ?? []), { fecha: f.fecha, avance: f.avance }],
    })
  }
  return [...trabajos.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.avance - b.avance)
}

/** El promedio del último avance de cada trabajo, en entero. `null` sin trabajos. */
export function avanceMedio(trabajos: TrabajoConAvance[]): number | null {
  if (trabajos.length === 0) return null
  return Math.round(trabajos.reduce((n, t) => n + t.avance, 0) / trabajos.length)
}

type Def = { etiqueta: string; tono: Tono }

/**
 * Lo que devuelve `codigo_interno_documentos` en `tipo`, en el orden en que se
 * muestra: primero la OT y la cotización, que es lo que Gerencia busca.
 */
export const TIPO_DOCUMENTO_CODIGO: Record<string, { titulo: string; vacio: string }> = {
  OT: { titulo: 'Órdenes de trabajo', vacio: 'Sin OT: hoy solo se llega a la OT si su unidad lleva este código en Unidades.' },
  COTIZACION: { titulo: 'Cotizaciones', vacio: 'Sin cotización: hoy solo se llega a ella por la OT de la unidad.' },
  UNIDAD: { titulo: 'Unidades', vacio: 'Ninguna unidad de Unidades lleva este código.' },
  REQUERIMIENTO: { titulo: 'Requerimientos', vacio: 'Ningún requerimiento pidió insumos para este código.' },
  SERVICIO: { titulo: 'Órdenes de servicio', vacio: 'Logística no emitió órdenes de servicio con este código.' },
  VEHICULO: { titulo: 'Ingresos a la planta', vacio: 'Portería no registró ingresos de un vehículo con este código.' },
}

/** El estado de un ingreso a la planta, de una unidad y de una cotización PDF. */
export const ESTADO_DOCUMENTO_CODIGO: Record<string, Def> = {
  EN_PLANTA: { etiqueta: 'En la planta', tono: 'info' },
  SALIO: { etiqueta: 'Salió', tono: 'neutro' },
  ACTIVA: { etiqueta: 'Activa', tono: 'exito' },
  INACTIVA: { etiqueta: 'Desactivada', tono: 'neutro' },
  POR_REVISAR: { etiqueta: 'Por revisar', tono: 'aviso' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

/** En qué va una orden de servicio del código: la decisión de Gerencia y, después, el trabajo. */
export const ESTADO_SERVICIO_CODIGO: Record<string, Def> = {
  POR_APROBAR: { etiqueta: 'Por aprobar', tono: 'aviso' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro' },
  EMITIDA: { etiqueta: 'Aprobada', tono: 'neutro' },
  EN_EJECUCION: { etiqueta: 'En ejecución', tono: 'info' },
  CONFORME: { etiqueta: 'Conforme', tono: 'exito' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

/** Las pestañas del detalle de un código. */
export const VISTAS_CODIGO = [
  { valor: 'avance', etiqueta: 'Avance' },
  { valor: 'costeo', etiqueta: 'Costeo' },
  { valor: 'personal', etiqueta: 'Personal' },
  { valor: 'documentos', etiqueta: 'RQ, OT y cotización' },
] as const

export type VistaCodigo = (typeof VISTAS_CODIGO)[number]['valor']

export function vistaValida(valor: unknown): VistaCodigo {
  return VISTAS_CODIGO.some((v) => v.valor === valor) ? (valor as VistaCodigo) : 'avance'
}

/** El enlace al detalle: el código lleva «/», así que va en la consulta y no en la ruta. */
export function enlaceCodigo(codigo: string, vista?: VistaCodigo) {
  const query = new URLSearchParams({ codigo })
  if (vista && vista !== 'avance') query.set('vista', vista)
  return `/codigos-internos/detalle?${query}`
}

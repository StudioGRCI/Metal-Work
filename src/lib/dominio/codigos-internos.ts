import type { Tono } from '@/components/ui/etiqueta-estado'
import { moneda } from '@/lib/format'
import { horasCortas } from './rrhh'

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
 * Lo que lleva costado un código, en soles: mano de obra con el recargo de sus
 * horas extras, materiales salidos del almacén, órdenes de servicio aprobadas
 * sin IGV, recibos por honorarios por su bruto, gastos del mes, egresos de
 * caja con el código, gastos aprobados en la OT y su merma (migración
 * 20261017300000). Las compras NO entran: lo
 * comprado se cuenta cuando sale del almacén para el código. Los dólares van a
 * soles al cambio de Tesorería; los de una línea sin cambio cargado quedan
 * aparte (`usd`) y no suman, porque sin cambio no se adivinan.
 */
export function costoDelCodigo(c: { costo_pen: number; usd_sin_cambio: number }) {
  return { pen: c.costo_pen, usd: c.usd_sin_cambio }
}

/** «S/ 230.00 + US$ 10.00», o una sola moneda cuando la otra está en cero. */
export function montoMixto(pen: number, usd: number) {
  if (usd > 0 && pen === 0) return moneda(usd, 'USD')
  return usd > 0 ? `${moneda(pen)} + ${moneda(usd, 'USD')}` : moneda(pen)
}

/**
 * Por qué las partes no dan el total a ojo: cada parte va en su moneda y el
 * total en soles. Con la línea, Gerencia suma y cuadra. `null` sin dólares.
 */
/** Lo que deja incompleto un costo, contado («2 salidas sin precio · 8 h sin costo»); `null` si nada. */
export function faltanteDelCosto(f: { sinPrecio: number; horasSinCosto: number; sinCambio: number }) {
  const partes = [
    f.sinPrecio > 0 && `${f.sinPrecio} ${f.sinPrecio === 1 ? 'salida' : 'salidas'} sin precio`,
    f.horasSinCosto > 0 && `${horasCortas(f.horasSinCosto)} sin costo`,
    f.sinCambio > 0 && `${f.sinCambio} ${f.sinCambio === 1 ? 'línea' : 'líneas'} en dólares sin cambio`,
  ].filter(Boolean)
  return partes.length > 0 ? `Incompleto: ${partes.join(' · ')}` : null
}

export function dolaresAlCambio(c: { usd_al_cambio: number; usd_en_soles: number }) {
  if (c.usd_al_cambio <= 0) return null
  return `Lo que está en dólares (${moneda(c.usd_al_cambio, 'USD')}) suma ${moneda(c.usd_en_soles)} al cambio de Tesorería del día de cada línea: con eso, las partes en soles dan el costo hasta hoy.`
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Dónde aparece un código, en una línea: «4 reportes · 3 salidas del almacén · 1 RQ». */
export function dondeAparece(
  c: {
    reportes: number
    salidas: number
    requerimientos: number
    compras: number
    unidades: number
    ordenes: number
    servicios: number
    subcontratos: number
    vehiculos: number
    horas: number
    /** Del costo completo: un código que solo está en la caja o en un gasto de la OT no está «solo en anulados». */
    egresos_caja?: number
    gastos_ot_pen?: number
    gastos_ot_usd?: number
  },
  /** Lo que Diseño cargó en el código: un código puede tener planos antes que cualquier documento. */
  diseno?: { planos: number; materiales: number; etapas: number },
): string {
  const partes = [
    diseno && diseno.planos > 0 && plural(diseno.planos, 'plano', 'planos'),
    diseno && diseno.etapas > 0 && plural(diseno.etapas, 'etapa', 'etapas'),
    diseno && diseno.materiales > 0 && 'lista de materiales',
    c.reportes > 0 && plural(c.reportes, 'reporte diario', 'reportes diarios'),
    c.reportes === 0 && c.horas > 0 && 'horas de RR. HH.',
    c.salidas > 0 && plural(c.salidas, 'salida del almacén', 'salidas del almacén'),
    c.requerimientos > 0 && plural(c.requerimientos, 'RQ', 'RQ'),
    c.compras > 0 && plural(c.compras, 'OC', 'OC'),
    c.servicios > 0 && plural(c.servicios, 'OS', 'OS'),
    c.subcontratos > 0 && plural(c.subcontratos, 'recibo por honorarios', 'recibos por honorarios'),
    c.unidades > 0 && plural(c.unidades, 'unidad', 'unidades'),
    c.ordenes > 0 && plural(c.ordenes, 'OT', 'OT'),
    c.vehiculos > 0 && plural(c.vehiculos, 'ingreso a la planta', 'ingresos a la planta'),
    (c.gastos_ot_pen ?? 0) + (c.gastos_ot_usd ?? 0) > 0 && 'gastos aprobados en la OT',
    (c.egresos_caja ?? 0) > 0 && plural(c.egresos_caja ?? 0, 'egreso de caja', 'egresos de caja'),
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

/** PLANTA agrupa el trabajo de la planta que no es de una unidad: no tiene avance. */
export const CODIGO_SIN_AVANCE = 'PLANTA'

/**
 * El código del requerimiento de Administración que es de todas las unidades:
 * lo que sale del almacén con él se reparte en partes iguales entre los códigos
 * que trabajaron ese mes (migración 20261017401000). No es una unidad.
 */
export const CODIGO_TODOS_LOS_ACTIVOS = 'TODOS LOS ACTIVOS'

/**
 * Los códigos que no son de una unidad, primeros en el buscador de código: lo
 * de la planta y lo de la oficina.
 */
export const CODIGO_FIJO_PLANTA = { codigo: 'PLANTA', detalle: 'No es para una unidad: lo de la planta' }
export const CODIGO_FIJO_OFICINA = { codigo: 'OFICINA', detalle: 'No es para una unidad: lo de la oficina' }

/** PLANTA y TODOS LOS ACTIVOS no son una unidad: no avanzan, no se venden y su costeo no se cierra. */
export function noEsUnidad(codigo: string) {
  return codigo === CODIGO_SIN_AVANCE || codigo === CODIGO_TODOS_LOS_ACTIVOS
}

/**
 * De dónde sale el porcentaje de un código, en una línea, con lo que devuelve
 * `codigos_internos_avance`. Sin fila, el código no tiene etapas ni reportes y
 * va en 0 %.
 */
export function origenDelAvance(
  codigo: string,
  a: { fuente: 'PLANOS' | 'ETAPAS' | 'REPORTES'; etapas: number; etapas_terminadas: number; trabajos: number; trabajos_terminados: number } | undefined,
): string {
  if (codigo === CODIGO_SIN_AVANCE) return 'PLANTA no es una unidad: no lleva avance'
  if (codigo === CODIGO_TODOS_LOS_ACTIVOS) return 'No es una unidad: lo que sale con él se reparte entre los códigos que trabajaron ese mes'
  if (!a) return 'Sin etapas de Diseño ni reporte diario: todavía no avanza'
  if (a.fuente === 'PLANOS') {
    return `Por los planos de Diseño, cada uno con su % de la unidad${a.etapas > 0 ? `, y el resto por sus ${plural(a.etapas, 'etapa', 'etapas')}` : ''}`
  }
  if (a.fuente === 'ETAPAS') {
    return `Por sus ${plural(a.etapas, 'etapa', 'etapas')} de Diseño: ${a.etapas_terminadas} ${a.etapas_terminadas === 1 ? 'terminada' : 'terminadas'}`
  }
  return `Por el reporte diario, sin etapas de Diseño: ${a.trabajos_terminados} de ${plural(a.trabajos, 'trabajo terminado', 'trabajos terminados')}`
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
  // Lo que carga Diseño por código (migración 20261015200000).
  { valor: 'etapas', etiqueta: 'Etapas' },
  { valor: 'planos', etiqueta: 'Planos' },
  { valor: 'materiales', etiqueta: 'Materiales' },
  { valor: 'costeo', etiqueta: 'Costeo' },
  { valor: 'personal', etiqueta: 'Personal' },
  { valor: 'documentos', etiqueta: 'RQ, OT y cotización' },
  // La factura de venta y su cobro cuelgan del código (migración 20261015124000).
  { valor: 'facturacion', etiqueta: 'Factura y cobro' },
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

/** El detalle del gasto de un código para Requerimientos: como el de Gerencia, el código va en la consulta. */
export function enlaceGastoCodigo(codigo: string) {
  return `/requerimientos/gasto-por-codigo/detalle?${new URLSearchParams({ codigo })}`
}

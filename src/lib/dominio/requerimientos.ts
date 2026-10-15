import type { Tono } from '@/components/ui/etiqueta-estado'
import type { PerfilSesion } from '@/lib/sesion'

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/**
 * En qué va el requerimiento. Primero lo revisa Almacén; si no hay stock lo
 * compra Logística; cuando está en almacén, Supervisión lo recoge y Almacén lo
 * entrega (migración 20261013100000).
 */
export const ESTADO_REQUERIMIENTO: Record<string, Def> = {
  POR_ATENDER: { etiqueta: 'Por revisar', tono: 'aviso', descripcion: 'Almacén revisa si hay stock.' },
  SIN_STOCK: { etiqueta: 'Por comprar', tono: 'peligro', descripcion: 'Almacén no tiene todo: se compra solo lo que falta.' },
  EN_ATENCION: { etiqueta: 'En compra', tono: 'info', descripcion: 'Se está comprando lo que falta.' },
  LISTO_EN_ALMACEN: { etiqueta: 'Listo en almacén', tono: 'exito', descripcion: 'El área puede recogerlo.' },
  ENTREGADO: { etiqueta: 'Entregado', tono: 'neutro', descripcion: 'Almacén lo entregó al área.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro', descripcion: 'Anulado con su motivo.' },
}

/**
 * Los dos requerimientos (migración 20261015162000). El de operación lo piden
 * Maestranza, Producción, Acabados y Almacén y su OC la hace Logística; el de
 * Administración es de oficina, lo lleva la administradora y ella hace su OC.
 * Los dos pasan primero por Almacén. Qué áreas van en cada uno lo dice
 * `areas.requerimiento`.
 */
export const TIPO_REQUERIMIENTO: Record<string, Def> = {
  OPERACION: { etiqueta: 'Operación', tono: 'neutro', descripcion: 'Maestranza, Producción, Acabados y Almacén. La OC la hace Logística.' },
  ADMINISTRACION: { etiqueta: 'Administración', tono: 'acento', descripcion: 'Lo de oficina. Lo lleva la administradora y ella hace su OC.' },
}

export type TipoRequerimiento = 'OPERACION' | 'ADMINISTRACION'

/** Los que todavía esperan a alguien: lo que la bandeja de atención muestra primero. */
export const ESTADOS_RQ_ABIERTOS = ['POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN'] as const

/** Quién compra cada requerimiento: el de operación, Logística; el de Administración, la administradora. */
export type CompraDe = Record<TipoRequerimiento, boolean>
export type QuienAtiende = { recibe: boolean; despacha: boolean; compraDe: CompraDe }

export const tipoDeRequerimiento = (rq: { tipo: string | null }): TipoRequerimiento =>
  rq.tipo === 'ADMINISTRACION' ? 'ADMINISTRACION' : 'OPERACION'

/**
 * Qué hace esta persona en la bandeja de atención. Cada uno compra lo suyo, como
 * exige `rq_exigir` en la base: el RQ de operación, Logística; el de
 * Administración, la administradora. ADMIN, los dos.
 */
export function quienAtiende(perfil: Pick<PerfilSesion, 'permisos' | 'rol'>): QuienAtiende {
  const esAdmin = perfil.rol.codigo === 'ADMIN'
  const tiene = (permiso: string) => esAdmin || perfil.permisos.includes(permiso)
  const administra = tiene('requerimientos.administracion')
  const conOc = tiene('compras.crear')
  return {
    recibe: tiene('almacen.recibir'),
    despacha: tiene('almacen.despachar'),
    compraDe: { OPERACION: conOc && (esAdmin || !administra), ADMINISTRACION: conOc && administra },
  }
}

/**
 * Si un requerimiento abierto espera a quien mira en la bandeja de atención: el
 * que revisa el stock lo recibe por revisar y en compra (para recepcionarlo), el
 * que compra lo suyo sin stock, y el que despacha lo listo en almacén. La misma
 * regla para la bandeja y para «Te toca» del dashboard, para que digan lo mismo.
 */
export function leTocaAtender(rq: { estado: string | null; tipo: string | null }, p: QuienAtiende): boolean {
  if (rq.estado === 'POR_ATENDER' || rq.estado === 'EN_ATENCION') return p.recibe
  if (rq.estado === 'SIN_STOCK') return p.compraDe[tipoDeRequerimiento(rq)] || p.recibe
  if (rq.estado === 'LISTO_EN_ALMACEN') return p.despacha
  return false
}

/**
 * En qué etapa va cada insumo del RQ, con su porcentaje. Lo calcula la base
 * (`avance_de_requerimientos`, migración 20261013121000) a partir del estado
 * del RQ, de la OC del insumo y de su recojo: el RQ va en el promedio de sus
 * insumos y su etapa es la del más atrasado. Desde la migración 20261015162000
 * Almacén revisa cada insumo: el que tiene completo va en «Almacén lo tiene» y
 * no se compra. Las etiquetas viven aquí.
 */
export const ETAPA_AVANCE_RQ: Record<string, Def> = {
  POR_REVISAR: { etiqueta: 'Almacén revisa el stock', tono: 'aviso', descripcion: 'Almacén todavía no dice si lo tiene.' },
  POR_COMPRAR: { etiqueta: 'Por comprar', tono: 'aviso', descripcion: 'Almacén no lo tiene completo y todavía no va en una orden de compra.' },
  OC_POR_APROBAR: { etiqueta: 'OC por aprobar', tono: 'aviso', descripcion: 'La orden de compra espera a Gerencia.' },
  PENDIENTE_RECOJO: { etiqueta: 'Pendiente de recojo', tono: 'aviso', descripcion: 'Aprobada: el conductor todavía no sale a recogerla.' },
  EN_RECOJO: { etiqueta: 'En recojo', tono: 'info', descripcion: 'El conductor salió a recogerla.' },
  RECOGIDO: { etiqueta: 'Recogido, va al almacén', tono: 'info', descripcion: 'El conductor la tiene y la lleva al almacén.' },
  POR_VALIDAR: { etiqueta: 'En almacén, por validar', tono: 'info', descripcion: 'El conductor la dejó; Almacén valida el ingreso.' },
  OBSERVADO: { etiqueta: 'Observado en almacén', tono: 'peligro', descripcion: 'Almacén no la recibió completa.' },
  EN_KARDEX: { etiqueta: 'Ingresó al kardex', tono: 'exito', descripcion: 'Almacén validó el ingreso.' },
  EN_STOCK: { etiqueta: 'Almacén lo tiene', tono: 'exito', descripcion: 'Había en almacén: no se compra.' },
  LISTO_EN_ALMACEN: { etiqueta: 'Listo en almacén', tono: 'exito', descripcion: 'El área puede recogerlo.' },
  ENTREGADO: { etiqueta: 'Entregado', tono: 'neutro', descripcion: 'Almacén lo entregó al área.' },
}

/**
 * Quién da cada insumo del RQ. Almacén revisa el RQ insumo por insumo
 * (migración 20261015162000): lo que tiene lo separa de su stock y lo demás se
 * compra con una OC. En un mismo RQ unos insumos los da Almacén y otros van a
 * compra, y el supervisor quiere saber cuál es cuál.
 */
export type AtencionDelInsumo = 'POR_REVISAR' | 'ALMACEN' | 'ALMACEN_Y_COMPRA' | 'COMPRA'

export const ATENCION_INSUMO: Record<AtencionDelInsumo, Def> = {
  POR_REVISAR: { etiqueta: 'Almacén lo revisa', tono: 'aviso', descripcion: 'Almacén todavía no dice si lo tiene.' },
  ALMACEN: { etiqueta: 'Lo da Almacén', tono: 'exito', descripcion: 'Almacén lo tiene completo en su stock: no se compra.' },
  ALMACEN_Y_COMPRA: { etiqueta: 'Almacén y compra', tono: 'info', descripcion: 'Almacén tiene una parte; el resto se compra.' },
  COMPRA: { etiqueta: 'Va a compra', tono: 'info', descripcion: 'Almacén no lo tiene: se compra con una orden de compra.' },
}

/**
 * Quién da el insumo, por lo que Almacén dijo al revisarlo y por su OC. Los RQ
 * de antes de la revisión por insumo no dicen cuánto tenía Almacén: ahí cuenta
 * si el insumo tiene OC y en qué va el RQ. Vacío en un RQ anulado.
 */
export function atencionDelInsumo(
  l: { cantidad: number; en_stock: number | null; orden_compra: string | null },
  estadoRq: string,
): AtencionDelInsumo | null {
  if (estadoRq === 'ANULADO') return null
  if (estadoRq === 'POR_ATENDER') return 'POR_REVISAR'
  if (l.en_stock === null) {
    if (l.orden_compra) return 'COMPRA'
    return estadoRq === 'LISTO_EN_ALMACEN' || estadoRq === 'ENTREGADO' ? 'ALMACEN' : 'COMPRA'
  }
  if (l.en_stock >= l.cantidad) return 'ALMACEN'
  return l.en_stock > 0 ? 'ALMACEN_Y_COMPRA' : 'COMPRA'
}

/**
 * Cuántos insumos hay de cada clase: «1 lo da Almacén · 1 en parte Almacén y en
 * parte compra · 1 va a compra». Suman el total del RQ.
 */
export function resumenDeAtencion(atenciones: (AtencionDelInsumo | null)[]): string {
  const n = (a: AtencionDelInsumo) => atenciones.filter((x) => x === a).length
  const [revisa, almacen, partido, compra] = [n('POR_REVISAR'), n('ALMACEN'), n('ALMACEN_Y_COMPRA'), n('COMPRA')]
  return [
    revisa > 0 ? `${revisa} por revisar en Almacén` : null,
    almacen > 0 ? `${almacen} ${almacen === 1 ? 'lo da' : 'los da'} Almacén` : null,
    partido > 0 ? `${partido} en parte Almacén y en parte compra` : null,
    compra > 0 ? `${compra} ${compra === 1 ? 'va' : 'van'} a compra` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Las dos etapas del recojo que Gerencia quiere distinguir de un vistazo. */
export const ETAPAS_DE_RECOJO = ['PENDIENTE_RECOJO', 'EN_RECOJO'] as const

/**
 * Cuántos insumos hay en cada etapa, en el orden del circuito, cuando no van
 * todos juntos: «Pendiente de recojo: 2 · En recojo: 1». Vacío si van parejos.
 */
export function resumenDeEtapas(etapas: (string | null)[]): string {
  const cuenta = new Map<string, number>()
  for (const e of etapas) if (e) cuenta.set(e, (cuenta.get(e) ?? 0) + 1)
  if (cuenta.size < 2) return ''
  const orden = Object.keys(ETAPA_AVANCE_RQ)
  return [...cuenta.entries()]
    .sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0]))
    .map(([e, n]) => `${ETAPA_AVANCE_RQ[e]?.etiqueta ?? e}: ${n}`)
    .join(' · ')
}

/** Por qué entra un vehículo a la planta (los formatos MW/JM/CON-FOR-VIG de portería). */
export const MOTIVO_VEHICULO: Record<string, Def> = {
  FABRICACION: { etiqueta: 'Fabricación', tono: 'acento', descripcion: 'Chasis o unidad para fabricarle la carrocería.' },
  MANTENIMIENTO: { etiqueta: 'Mantenimiento', tono: 'info', descripcion: 'Unidad de un cliente para mantenimiento.' },
  GARANTIA: { etiqueta: 'Garantía', tono: 'aviso', descripcion: 'Unidad que vuelve por garantía.' },
  ARENADO: { etiqueta: 'Retorno de arenado', tono: 'neutro', descripcion: 'Vuelve del arenado externo.' },
  COCHERA: { etiqueta: 'Cochera', tono: 'neutro', descripcion: 'Vehículo de un tercero que se guarda en la cochera.' },
  OTRO: { etiqueta: 'Otro', tono: 'neutro', descripcion: 'Cualquier otro motivo; se cuenta en la observación.' },
}

export const MOTIVOS_VEHICULO = Object.keys(MOTIVO_VEHICULO) as [string, ...string[]]

/**
 * La hora que se escribe en un `datetime-local` es la del taller. Perú no
 * cambia de hora, así que se le pega su desfase y la base la guarda bien.
 */
export function horaDeLima(valor: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor) ? `${valor}:00-05:00` : null
}

/**
 * Las fotos del vehículo al entrar y al salir: de 1 a 15 cada vez, como exige
 * `registrar_ingreso_vehiculo` y `registrar_salida_vehiculo` (migración 20261015161000).
 */
export const MAXIMO_FOTOS_VEHICULO = 15

/** El bucket privado de esas fotos: la ruta es `{cuenta}/{registro}/ingreso|salida/{foto}.jpg`. */
export const BUCKET_FOTOS_VEHICULO = 'fotos-vehiculos'

/** Lo que pesa como máximo una foto ya achicada en el teléfono (el tope del bucket). */
export const MAXIMO_MB_FOTO_VEHICULO = 5

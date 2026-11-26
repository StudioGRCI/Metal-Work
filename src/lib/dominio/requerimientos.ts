import type { Tono } from '@/components/ui/etiqueta-estado'
import { CODIGO_FIJO_OFICINA, CODIGO_FIJO_PLANTA } from '@/lib/dominio/codigos-internos'
import type { PerfilSesion } from '@/lib/sesion'

import { ESTADOS_CON_ALGO_POR_ENTREGAR } from '@/lib/dominio/plazo-rq'
import { fecha } from '@/lib/format'

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/**
 * En qué va el requerimiento. Primero lo revisa Almacén; si no hay stock lo
 * compra Logística; cuando está en almacén, Supervisión lo recoge y Almacén lo
 * entrega (migración 20261013100000).
 */
export const ESTADO_REQUERIMIENTO: Record<string, Def> = {
  POR_ATENDER: { etiqueta: 'Por revisar', tono: 'aviso', descripcion: 'Almacén revisa si hay stock.' },
  SIN_STOCK: { etiqueta: 'Por comprar', tono: 'aviso', descripcion: 'Almacén no tiene todo: se compra solo lo que falta.' },
  EN_ATENCION: { etiqueta: 'En compra', tono: 'info', descripcion: 'Se está comprando lo que falta.' },
  LISTO_EN_ALMACEN: { etiqueta: 'Listo en almacén', tono: 'exito', descripcion: 'El área puede recogerlo.' },
  ENTREGADO: { etiqueta: 'Entregado', tono: 'neutro', descripcion: 'Almacén lo entregó al área.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro', descripcion: 'Anulado con su motivo.' },
}

/**
 * Entregado, pero parte no salió del kardex porque ya no iba a salir: Almacén
 * lo cerró con su motivo (migración 20261020196000). Quien lo pidió tiene que
 * verlo distinto de uno que salió entero.
 */
export const ENTREGADO_CON_FALTANTE: Def = {
  etiqueta: 'Entregado con faltante',
  tono: 'aviso',
  descripcion: 'Almacén lo entregó; una parte no salió del kardex, con su motivo.',
}

/** El estado como se muestra: el entregado con faltante se dice aparte. */
export function estadoDelRequerimiento(rq: { estado: string; faltante_al_entregar: string | null }): Def | undefined {
  if (rq.estado === 'ENTREGADO' && rq.faltante_al_entregar) return ENTREGADO_CON_FALTANTE
  return ESTADO_REQUERIMIENTO[rq.estado]
}

/**
 * Los estados como los devuelven las funciones del código interno
 * (`codigo_interno_documentos`, `codigo_interno_lo_pedido`), que ya dicen
 * aparte el entregado con faltante (migración 20261020196000).
 */
export const ESTADO_REQUERIMIENTO_DEL_CODIGO: Record<string, Def> = { ...ESTADO_REQUERIMIENTO, ENTREGADO_CON_FALTANTE }

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

/**
 * Los códigos del requerimiento que no son de una unidad, primeros en la lista
 * del código interno: PLANTA en el de operación y OFICINA en el de
 * Administración, como decía la ayuda del campo cuando se escribía a mano.
 */
export const CODIGOS_FIJOS_DEL_RQ: Record<TipoRequerimiento, { codigo: string; detalle: string }[]> = {
  OPERACION: [CODIGO_FIJO_PLANTA],
  ADMINISTRACION: [CODIGO_FIJO_OFICINA],
}

/** Los que todavía esperan a alguien: lo que la bandeja de atención muestra primero. */
export const ESTADOS_RQ_ABIERTOS = ESTADOS_CON_ALGO_POR_ENTREGAR

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
 * que revisa el stock lo recibe por revisar, el que compra lo suyo sin stock, y
 * el que despacha lo listo en almacén. En compra, al que revisa el stock le toca
 * solo cuando lo comprado ya llegó y falta dejarlo listo: lo dice el recorrido
 * (`loTiene`, el puesto que lo tiene ahora). Antes contaba todo lo que estaba en
 * compra y la bandeja decía «62 esperan por ti» con 42 esperando a Logística,
 * mientras el globo del menú decía 20. La misma regla para la bandeja y para el
 * globo, para que digan lo mismo.
 */
export function leTocaAtender(rq: { estado: string | null; tipo: string | null }, p: QuienAtiende, loTiene?: string | null): boolean {
  const loTieneAlmacen = p.recibe && loTiene === PUESTO_ALMACEN
  if (rq.estado === 'POR_ATENDER') return p.recibe
  if (rq.estado === 'EN_ATENCION') return loTieneAlmacen
  if (rq.estado === 'SIN_STOCK') return p.compraDe[tipoDeRequerimiento(rq)] || loTieneAlmacen
  if (rq.estado === 'LISTO_EN_ALMACEN') return p.despacha
  return false
}

/** Cómo nombra el recorrido de un RQ a Almacén cuando lo tiene (`recorrido_de_requerimientos`). */
export const PUESTO_ALMACEN = 'Almacén'

/** Los estados en compra en que Almacén recibe lo que llega: le tocan solo si el recorrido dice que lo tiene. */
export const RQ_EN_COMPRA = ['SIN_STOCK', 'EN_ATENCION'] as const

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
  POR_REPONER: {
    etiqueta: 'El proveedor lo repone',
    tono: 'aviso',
    descripcion: 'Almacén devolvió parte de la compra y el proveedor la repone en la misma OC: no se pide otra vez.',
  },
  EN_KARDEX: { etiqueta: 'Ingresó al kardex', tono: 'exito', descripcion: 'Almacén validó el ingreso.' },
  EN_STOCK: { etiqueta: 'Almacén lo tiene', tono: 'exito', descripcion: 'Había en almacén: no se compra.' },
  LISTO_EN_ALMACEN: { etiqueta: 'Listo en almacén', tono: 'exito', descripcion: 'El área puede recogerlo.' },
  ENTREGADO: { etiqueta: 'Entregado', tono: 'neutro', descripcion: 'Almacén lo entregó al área.' },
}

/**
 * En cuántas partes va un insumo del RQ, en su unidad. Lo pidió DKS el
 * 2026-10-20 para Maestranza: «que pueda detectar que ya hay 10 de recojo en
 * almacén, faltarían 5 de logística». Suman lo pedido:
 *
 * - `entregado`: lo que ya salió del almacén para este insumo, menos lo devuelto.
 * - `recoger`: lo que ya está en almacén para el RQ y el área todavía no se
 *   llevó. Almacén lo separó de su stock al revisarlo, o entró con su compra:
 *   lo que de verdad ingresó al kardex por la línea de su OC (`llegado`),
 *   aunque el proveedor haya traído solo una parte.
 * - `porLlegar`: lo que se compra y todavía no entra al almacén; va en la etapa
 *   de su OC (`etapa`). Lo compra Logística, o la administradora en el RQA.
 * - `revisar`: Almacén todavía no dice si lo tiene.
 *
 * Los RQ de antes de la revisión por insumo no dicen cuánto tenía Almacén, y
 * los de antes de que la OC se enlazara por insumo no dicen cuánto llegó: ahí
 * lo comprado está todo en almacén o todo por llegar, según su etapa.
 */
export type PartesDelInsumo = { entregado: number; recoger: number; porLlegar: number; revisar: number }

/** Las etapas en que lo comprado ya está en el almacén y se puede entregar. */
const LLEGO_AL_ALMACEN = ['EN_KARDEX', 'EN_STOCK', 'LISTO_EN_ALMACEN', 'ENTREGADO']

export function partesDelInsumo(
  l: { cantidad: number; en_stock: number | null; etapa: string | null; entregado: number | null; llegado: number | null; sin_salida?: number | null },
  estadoRq: string,
): PartesDelInsumo | null {
  // Sin lo entregado no se parte: no se sabe cuánto de lo llegado ya se llevaron.
  if (estadoRq === 'ANULADO' || l.entregado === null) return null
  const pedido = Math.max(l.cantidad, 0)
  // Entregado con faltante (migración 20261020196000): lo que no salió del
  // kardex no se entregó, y la tarjeta lo dice aparte.
  if (estadoRq === 'ENTREGADO') return { entregado: pedido - Math.min(Math.max(l.sin_salida ?? 0, 0), pedido), recoger: 0, porLlegar: 0, revisar: 0 }
  const entregado = Math.min(Math.max(l.entregado, 0), pedido)
  if (estadoRq === 'POR_ATENDER') return { entregado, recoger: 0, porLlegar: 0, revisar: pedido - entregado }
  // Lo que Almacén separó de su stock más lo que ya entró de su compra.
  const deStock = l.en_stock === null ? 0 : Math.min(Math.max(l.en_stock, 0), pedido)
  let llegado: number
  if (estadoRq === 'LISTO_EN_ALMACEN') llegado = pedido
  else if (l.llegado !== null) llegado = Math.min(deStock + Math.max(l.llegado, 0), pedido)
  else if (LLEGO_AL_ALMACEN.includes(l.etapa ?? '')) llegado = pedido
  else llegado = deStock
  return {
    entregado,
    recoger: Math.max(llegado - entregado, 0),
    porLlegar: Math.max(pedido - Math.max(llegado, entregado), 0),
    revisar: 0,
  }
}

/**
 * ¿Tiene algún insumo que ya se puede recoger en Almacén? Es la lista
 * `?ver=recoger` y el pendiente del supervisor: los dos cuentan lo mismo.
 */
export function tieneParaRecoger(rq: {
  estado: string
  lineas: { cantidad: number; en_stock: number | null; etapa: string | null; entregado: number | null; llegado: number | null; sin_salida?: number | null }[]
}): boolean {
  return rq.lineas.some((l) => (partesDelInsumo(l, rq.estado)?.recoger ?? 0) > 0)
}

/** Quién trae lo que falta: Logística en el RQ de operación, la administradora en el de Administración. */
export const quienCompra = (rq: { tipo: string | null }) => (tipoDeRequerimiento(rq) === 'ADMINISTRACION' ? 'Administración' : 'Logística')

/**
 * Los cuatro pasos del RQ, para la línea de pasos de cada tarjeta. La compra se
 * salta cuando Almacén tenía todo: el RQ pasa de la revisión a estar listo.
 */
export const PASOS_DEL_RQ = ['REVISION', 'COMPRA', 'EN_ALMACEN', 'ENTREGADO'] as const
export type PasoDelRq = (typeof PASOS_DEL_RQ)[number]

/**
 * Ya llegó todo lo que faltaba, aunque Almacén todavía no marque el RQ listo:
 * ningún insumo espera su compra ni la revisión. Con la compra validada en el
 * kardex, la tarjeta decía «Logística compra» encima de una barra sin nada por
 * llegar.
 */
export function yaLlegoTodo(partes: readonly (PartesDelInsumo | null)[]): boolean {
  return partes.length > 0 && partes.every((p) => p !== null && p.porLlegar === 0 && p.revisar === 0)
}

/**
 * La compra del insumo ya entró al almacén y todavía falta: la OC se emitió por
 * menos de lo que faltaba (o su línea, compartida con otros RQ, no alcanzó a
 * este). Lo que falta ya no va en ninguna compra; la etapa de la OC, verde, no
 * puede pintarlo como si ya estuviera (auditoría del 2026-10-20).
 */
export function laCompraQuedoCorta(l: { etapa: string | null; compra_rechazada: boolean }, partes: PartesDelInsumo): boolean {
  return partes.porLlegar > 0 && !l.compra_rechazada && LLEGO_AL_ALMACEN.includes(l.etapa ?? '')
}

export const COMPRA_CORTA: Def = {
  etiqueta: 'La OC compró menos: pide el resto en un RQ nuevo',
  tono: 'aviso',
  descripcion: 'La orden de compra ya entró entera y no alcanzó para todo el insumo.',
}

/** Lo que dice la insignia del RQ en compra cuando solo falta lo que la OC no compró. */
export const FALTA_LO_NO_COMPRADO: Def = {
  etiqueta: 'Falta lo que la OC no compró',
  tono: 'aviso',
  descripcion: 'Lo comprado ya está en almacén; el resto no va en ninguna compra y se pide en un RQ nuevo.',
}

/** Lo que dice la insignia del RQ en compra cuando ya llegó todo (`yaLlegoTodo`). */
export const YA_LLEGO_TODO: Def = {
  etiqueta: 'Ya llegó todo',
  tono: 'exito',
  descripcion: 'Está en almacén todo lo que faltaba. Almacén lo marca listo para recoger.',
}

/**
 * En qué paso va el RQ por su estado; vacío si está anulado. Con las partes de
 * sus insumos, el RQ en compra al que ya le llegó todo va en «Para recoger».
 */
export function pasoDelRequerimiento(estado: string, partes?: readonly (PartesDelInsumo | null)[]): PasoDelRq | null {
  if (estado === 'POR_ATENDER') return 'REVISION'
  if (estado === 'SIN_STOCK' || estado === 'EN_ATENCION') return partes && yaLlegoTodo(partes) ? 'EN_ALMACEN' : 'COMPRA'
  if (estado === 'LISTO_EN_ALMACEN') return 'EN_ALMACEN'
  if (estado === 'ENTREGADO') return 'ENTREGADO'
  return null
}

/**
 * Los pasos de un insumo, de principio a fin, como los sigue el supervisor en
 * «RQ por unidad» (Plan 1, entrega 1.2). El visto de Diseño va primero y solo
 * cuando lo pedido se pasa del metrado: mientras no lo da, Almacén no lo
 * revisa. La compra y el camino se saltan cuando Almacén ya lo tenía.
 */
export const PASOS_DEL_INSUMO = ['VISTO_DISENO', 'POR_ATENDER', 'EN_COMPRA', 'EN_CAMINO', 'EN_ALMACEN', 'ENTREGADO'] as const
export type PasoDelInsumo = (typeof PASOS_DEL_INSUMO)[number]

export const TITULO_PASO_DEL_INSUMO: Record<PasoDelInsumo, string> = {
  VISTO_DISENO: 'Visto de Diseño',
  POR_ATENDER: 'Por atender',
  EN_COMPRA: 'En compra',
  EN_CAMINO: 'En camino',
  EN_ALMACEN: 'En almacén',
  ENTREGADO: 'Entregado',
}

/** A qué paso del insumo corresponde cada etapa de `avance_de_requerimientos`. */
const PASO_DE_LA_ETAPA: Record<string, PasoDelInsumo> = {
  POR_REVISAR: 'POR_ATENDER',
  POR_COMPRAR: 'EN_COMPRA',
  OC_POR_APROBAR: 'EN_COMPRA',
  PENDIENTE_RECOJO: 'EN_CAMINO',
  EN_RECOJO: 'EN_CAMINO',
  RECOGIDO: 'EN_CAMINO',
  POR_REPONER: 'EN_CAMINO',
  POR_VALIDAR: 'EN_ALMACEN',
  OBSERVADO: 'EN_ALMACEN',
  EN_KARDEX: 'EN_ALMACEN',
  EN_STOCK: 'EN_ALMACEN',
  LISTO_EN_ALMACEN: 'EN_ALMACEN',
  ENTREGADO: 'ENTREGADO',
}

/** El visto de Diseño todavía no se da: el insumo espera ahí. */
const VISTO_QUE_FRENA = ['SIN_SUSTENTO', 'POR_AUTORIZAR', 'RECHAZADO']

/** Lo que dice el visto de Diseño debajo del insumo. */
export const VISTO_DEL_INSUMO: Record<string, { etiqueta: string; tono: Tono }> = {
  SIN_SUSTENTO: { etiqueta: 'Se pasa del metrado: falta el sustento de quien registró el RQ', tono: 'aviso' },
  POR_AUTORIZAR: { etiqueta: 'Se pasa del metrado: Diseño revisa el sustento', tono: 'aviso' },
  RECHAZADO: { etiqueta: 'Diseño no autorizó lo que se pasa del metrado', tono: 'peligro' },
  AUTORIZADO: { etiqueta: 'Diseño autorizó lo que se pasa del metrado', tono: 'exito' },
}

/** En qué va el visto de Diseño del insumo, como lo lee `pasoDelInsumo`; vacío si no espera a Diseño. */
export const vistoDelMetrado = (estado: string | null | undefined) => (estado && estado in VISTO_DEL_INSUMO ? estado : null)

/** Mientras se compra o viene en camino, se dice cuándo llega. */
export const ESPERA_LA_COMPRA: readonly PasoDelInsumo[] = ['EN_COMPRA', 'EN_CAMINO']

/**
 * Cuándo llega lo que se compra, dicho igual en «RQ por unidad» y en el RQA. Si
 * la fecha ya pasó, no se promete; si Gerencia no aprobó la compra, llegar
 * depende de que la apruebe. `quienCompra` nombra a quien puso la fecha cuando
 * quien lee es otro (el supervisor lee la de Logística); `null` si es quien lee.
 */
export function cuandoLlega({ llega, atrasada, porAprobar, quienCompra }: { llega: string; atrasada: boolean; porAprobar: boolean; quienCompra: string | null }): string {
  if (porAprobar && atrasada)
    return quienCompra ? `${quienCompra} lo esperaba el ${fecha(llega)}` : `Se esperaba el ${fecha(llega)}; la compra sigue por aprobar`
  if (porAprobar) return `Si Gerencia aprueba la compra, llega aprox. el ${fecha(llega)}`
  return atrasada ? `Se esperaba el ${fecha(llega)}` : `Llega aprox. el ${fecha(llega)}`
}

/** El visto de Diseño que el supervisor tiene que mover: escribir el sustento o corregirlo. */
export const VISTO_QUE_PIDE_SUSTENTO = ['SIN_SUSTENTO', 'RECHAZADO']

/**
 * En qué paso va el insumo y cuáles le tocan. `null` si no se sabe (el RQ
 * anulado no tiene etapa).
 *
 * - El visto de Diseño es un paso si Diseño lo autorizó, o mientras frena la
 *   revisión de Almacén (`frenado`). Si el metrado cambió después de revisado,
 *   el insumo sigue su camino sin ese paso, pero no sale del almacén hasta el
 *   visto (`frenaLaSalida`).
 * - La compra y el camino no le tocan si Almacén ya lo tenía entero.
 * - Entregado es por insumo: el que ya salió entero va entregado aunque otro
 *   del mismo RQ siga en compra (`entregado`, de `entregado_de_requerimientos`).
 * - El RQ entregado con faltante deja en `faltante` lo que no salió de ese
 *   insumo: su paso «Entregado» no termina en verde.
 */
export function pasoDelInsumo(
  l: { etapa: string | null; cantidad: number; en_stock: number | null; entregado: number | null; sin_salida?: number | null },
  visto: string | null,
): {
  pasos: PasoDelInsumo[]
  actual: PasoDelInsumo
  terminado: boolean
  frenado: boolean
  frenaLaSalida: boolean
  faltante: number | null
} | null {
  const segun = l.etapa ? PASO_DE_LA_ETAPA[l.etapa] : undefined
  if (!segun) return null
  const sinVisto = visto !== null && VISTO_QUE_FRENA.includes(visto)
  const salioEntero = l.entregado !== null && l.cantidad > 0 && l.entregado >= l.cantidad
  // Sin el visto, Almacén no lo revisa (migración 20261120400000): espera ahí.
  const frenado = sinVisto && segun === 'POR_ATENDER'
  // Si el metrado cambió después de la revisión, sigue su camino (se compra,
  // llega), pero no sale del almacén hasta el visto (migración 20261120410000).
  const frenaLaSalida = sinVisto && !frenado && segun !== 'ENTREGADO' && !salioEntero
  const conVisto = visto === 'AUTORIZADO' || frenado
  const deStock = l.etapa === 'EN_STOCK' || (l.en_stock !== null && l.en_stock >= l.cantidad)
  const actual: PasoDelInsumo = frenado ? 'VISTO_DISENO' : salioEntero ? 'ENTREGADO' : segun
  // El RQ se entregó con faltante y de este insumo no salió todo: no se pinta
  // como entregado entero (`sin_salida_al_entregar`, lo que no salió del kardex).
  const faltante = segun === 'ENTREGADO' && !salioEntero && l.sin_salida != null && l.sin_salida > 0 ? l.sin_salida : null
  const pasos = PASOS_DEL_INSUMO.filter((p) => (p !== 'VISTO_DISENO' || conVisto) && ((p !== 'EN_COMPRA' && p !== 'EN_CAMINO') || !deStock))
  return { pasos, actual, terminado: actual === 'ENTREGADO' && faltante === null, frenado, frenaLaSalida, faltante }
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
  MANTENIMIENTO: { etiqueta: 'Mantenimiento', tono: 'info', descripcion: 'Unidad de un cliente para mantenimiento: entra con el N.º de su OT.' },
  GARANTIA: { etiqueta: 'Garantía', tono: 'aviso', descripcion: 'Unidad que vuelve por garantía: entra con el N.º de su OT de garantía.' },
  ARENADO: { etiqueta: 'Retorno de arenado', tono: 'neutro', descripcion: 'Vuelve del arenado externo.' },
  COCHERA: { etiqueta: 'Cochera', tono: 'neutro', descripcion: 'Vehículo de un tercero que se guarda en la cochera.' },
  OTRO: { etiqueta: 'Otro', tono: 'neutro', descripcion: 'Cualquier otro motivo; se cuenta en la observación.' },
}

export const MOTIVOS_VEHICULO = Object.keys(MOTIVO_VEHICULO) as [string, ...string[]]

/**
 * Los motivos que son trabajo del taller: salen con la revisión de Tesorería
 * atendida. Gemelo de `vehiculo_motivo_exige_codigo` (migración 20261020166000).
 */
const MOTIVOS_CON_CODIGO = new Set(['FABRICACION', 'MANTENIMIENTO', 'GARANTIA', 'ARENADO'])
export function motivoExigeCodigo(motivo: string): boolean {
  return MOTIVOS_CON_CODIGO.has(motivo)
}

/**
 * Los que no tienen código interno: entran eligiendo su OT por el número, su
 * código es «OT 2921-2026» y salen cuando Administración da por terminado el
 * trabajo (migración 20261120500000). Fabricación y retorno del arenado entran
 * por el código de la unidad y salen con el 100 % de su avance.
 */
const MOTIVOS_POR_OT = new Set(['MANTENIMIENTO', 'GARANTIA'])
export function motivoPorOt(motivo: string): boolean {
  return MOTIVOS_POR_OT.has(motivo)
}

/**
 * Con qué vuelve del arenado externo: el de mantenimiento o garantía, por su
 * OT, aunque Administración la haya dado por terminada mientras estaba fuera;
 * los demás, con el motivo Arenado y su código. La base no deja otra puerta.
 */
export function conQueVuelveDelArenado(motivo: string, codigo: string | null): string {
  if (motivoPorOt(motivo) && codigo) return `el motivo ${motivo === 'MANTENIMIENTO' ? 'Mantenimiento' : 'Garantía'} y su ${codigo}`
  return 'el motivo «Arenado»'
}

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

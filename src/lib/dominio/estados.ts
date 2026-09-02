import type { Enums } from '@/types/database'

type EstadoEtapa = Enums<'estado_etapa_ot'>

import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * Traducción de los enums de la base a lo que ve el usuario: etiqueta legible,
 * color y orden. Mantener este archivo alineado con los enums de las migraciones.
 */

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

export const ESTADO_OT: Record<string, Def> = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro', descripcion: 'En elaboración, aún no aprobada' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'info', descripcion: 'Aprobada, pendiente de programar' },
  PROGRAMADA: { etiqueta: 'Programada', tono: 'info', descripcion: 'Con fecha de inicio asignada' },
  EN_PROCESO: { etiqueta: 'En proceso', tono: 'acento', descripcion: 'En ejecución en el taller' },
  PAUSADA: { etiqueta: 'Pausada', tono: 'aviso', descripcion: 'Detenida por falta de material o decisión del cliente' },
  CONTROL_CALIDAD: { etiqueta: 'Control de calidad', tono: 'info', descripcion: 'En inspección final' },
  TERMINADA: { etiqueta: 'Terminada', tono: 'exito', descripcion: 'Trabajo concluido, pendiente de entrega' },
  ENTREGADA: { etiqueta: 'Entregada', tono: 'exito', descripcion: 'Entregada al cliente con acta de conformidad' },
  FACTURADA: { etiqueta: 'Facturada', tono: 'exito', descripcion: 'Cerrada y facturada' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro', descripcion: 'Sin efecto' },
}

/** Orden en que se muestran los estados en filtros y tableros. */
export const ORDEN_ESTADO_OT = [
  'BORRADOR',
  'APROBADA',
  'PROGRAMADA',
  'EN_PROCESO',
  'PAUSADA',
  'CONTROL_CALIDAD',
  'TERMINADA',
  'ENTREGADA',
  'FACTURADA',
  'ANULADA',
] as const

/** Estados en los que la orden sigue viva en el taller. */
export const ESTADOS_ACTIVOS_OT = [
  'APROBADA',
  'PROGRAMADA',
  'EN_PROCESO',
  'PAUSADA',
  'CONTROL_CALIDAD',
] as const

export const PRIORIDAD: Record<string, Def> = {
  BAJA: { etiqueta: 'Baja', tono: 'neutro' },
  NORMAL: { etiqueta: 'Normal', tono: 'info' },
  ALTA: { etiqueta: 'Alta', tono: 'aviso' },
  URGENTE: { etiqueta: 'Urgente', tono: 'peligro' },
}

export const TIPO_TRABAJO: Record<string, Def> = {
  FABRICACION: { etiqueta: 'Fabricación', tono: 'acento' },
  REPARACION: { etiqueta: 'Reparación', tono: 'info' },
  REPOTENCIACION: { etiqueta: 'Repotenciación', tono: 'info' },
  MANTENIMIENTO: { etiqueta: 'Mantenimiento', tono: 'neutro' },
  GARANTIA: { etiqueta: 'Garantía', tono: 'aviso' },
}

// El tipo se ata al enum de la base a propósito. Cuando una migración agregue
// un estado, esto deja de compilar y obliga a decidir cómo se muestra, en vez de
// que aparezca en pantalla como texto crudo. Así se descubrió que faltaba
// REQUIERE_REVISION: el mapa era Record<string, Def> y nadie se enteró.
export const ESTADO_ETAPA: Record<EstadoEtapa, Def> = {
  PENDIENTE: { etiqueta: 'Pendiente', tono: 'neutro' },
  EN_PROCESO: { etiqueta: 'En proceso', tono: 'acento' },
  PAUSADA: { etiqueta: 'Pausada', tono: 'aviso' },
  REQUIERE_REVISION: { etiqueta: 'Necesita revisión', tono: 'peligro' },
  TERMINADA: { etiqueta: 'Terminada', tono: 'exito' },
  OMITIDA: { etiqueta: 'Omitida', tono: 'neutro' },
}

// El orden en que se ofrecen en pantalla, que no es el del enum: primero lo que
// se usa a diario, y omitir al final porque es la salida excepcional.
export const ORDEN_ESTADO_ETAPA = [
  'PENDIENTE', 'EN_PROCESO', 'PAUSADA', 'REQUIERE_REVISION', 'TERMINADA', 'OMITIDA',
] as const satisfies readonly EstadoEtapa[]

/**
 * El semáforo del plazo, tal como lo calcula `estado_del_plazo` en la base. Los
 * tres primeros son la fórmula de la empresa; los dos de cierre los agregó el
 * sistema porque su hoja no los tenía.
 *
 * `barra` es el color de la barra del cronograma; el resto de pantallas solo
 * usa etiqueta y tono. Estaba copiado en dos sitios y ya habían empezado a
 * discrepar: un enum tiene un solo mapa, y vive aquí.
 */
export const ESTADO_PLAZO: Record<string, Def & { barra: string }> = {
  VENCIDO: { etiqueta: 'Vencido', tono: 'peligro', barra: 'bg-peligro' },
  POR_VENCER: { etiqueta: 'Por vencer', tono: 'aviso', barra: 'bg-aviso' },
  VIGENTE: { etiqueta: 'Vigente', tono: 'exito', barra: 'bg-acento' },
  CUMPLIDO: { etiqueta: 'Cumplido', tono: 'neutro', barra: 'bg-exito' },
  CUMPLIDO_TARDE: { etiqueta: 'Cumplido tarde', tono: 'neutro', barra: 'bg-aviso' },
}

/**
 * Las etiquetas dicen en qué mano está la cotización, no el nombre técnico del
 * estado: quien mira la lista quiere saber a quién le toca mover.
 */
export const ESTADO_COTIZACION: Record<string, Def> = {
  BORRADOR: { etiqueta: 'En ventas', tono: 'neutro' },
  EN_COSTEO: { etiqueta: 'En costeo', tono: 'info' },
  EN_REVISION: { etiqueta: 'Con Gerencia', tono: 'aviso' },
  OBSERVADA: { etiqueta: 'Devuelta', tono: 'peligro' },
  REVISADA: { etiqueta: 'Lista para enviar', tono: 'exito' },
  ENVIADA: { etiqueta: 'Enviada al cliente', tono: 'info' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro' },
  VENCIDA: { etiqueta: 'Vencida', tono: 'aviso' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

/** El circuito en el orden en que ocurre, para los filtros y los listados. */
export const ORDEN_ESTADO_COTIZACION = [
  'BORRADOR',
  'EN_COSTEO',
  'EN_REVISION',
  'OBSERVADA',
  'REVISADA',
  'ENVIADA',
  'APROBADA',
  'RECHAZADA',
  'VENCIDA',
  'ANULADA',
] as const

export const RESULTADO_INSPECCION: Record<string, Def> = {
  CONFORME: { etiqueta: 'Conforme', tono: 'exito' },
  OBSERVADO: { etiqueta: 'Observado', tono: 'aviso' },
  RECHAZADO: { etiqueta: 'Rechazado', tono: 'peligro' },
}

export const TIPO_EVENTO_BITACORA: Record<string, Def> = {
  CREACION: { etiqueta: 'Creación', tono: 'info' },
  CAMBIO_ESTADO: { etiqueta: 'Cambio de estado', tono: 'acento' },
  AVANCE: { etiqueta: 'Avance', tono: 'info' },
  MATERIAL: { etiqueta: 'Material', tono: 'neutro' },
  DOCUMENTO: { etiqueta: 'Documento', tono: 'neutro' },
  INSPECCION: { etiqueta: 'Inspección', tono: 'aviso' },
  PAUSA: { etiqueta: 'Pausa', tono: 'aviso' },
  REANUDACION: { etiqueta: 'Reanudación', tono: 'exito' },
  COMENTARIO: { etiqueta: 'Comentario', tono: 'neutro' },
  ENTREGA: { etiqueta: 'Entrega', tono: 'exito' },
}

export const TIPO_COSTO: Record<string, Def> = {
  MATERIAL: { etiqueta: 'Materiales', tono: 'info' },
  MANO_OBRA: { etiqueta: 'Mano de obra', tono: 'acento' },
  SERVICIO: { etiqueta: 'Servicios de terceros', tono: 'aviso' },
  INDIRECTO: { etiqueta: 'Gastos indirectos', tono: 'neutro' },
  OTRO: { etiqueta: 'Otros', tono: 'neutro' },
}

const VACIO: Def = { etiqueta: '—', tono: 'neutro' }

/** Busca la definición de un valor de enum sin reventar si llega uno desconocido. */
export function definir(mapa: Record<string, Def>, valor: string | null | undefined): Def {
  if (!valor) return VACIO
  return mapa[valor] ?? { etiqueta: valor.replaceAll('_', ' ').toLowerCase(), tono: 'neutro' }
}

/** Convierte un mapa en opciones para un <select>, respetando un orden dado. */
export function opciones(mapa: Record<string, Def>, orden?: readonly string[]) {
  const claves = orden ?? Object.keys(mapa)
  return claves.map((valor) => ({ valor, etiqueta: mapa[valor]?.etiqueta ?? valor }))
}

/** Cómo se le dice a cada condición de pago fuera de la base de datos. */
export const CONDICION_PAGO: Record<string, string> = {
  CONTADO: 'Contado',
  CREDITO_7: 'Crédito 7 días',
  CREDITO_15: 'Crédito 15 días',
  CREDITO_30: 'Crédito 30 días',
  CREDITO_45: 'Crédito 45 días',
  CREDITO_60: 'Crédito 60 días',
  LETRAS: 'Letras',
}

/**
 * Las etapas de una cotización en el idioma de Ventas.
 *
 * La lista de cotizaciones ofrecía una pastilla por cada estado del circuito
 * —diez— y con el nombre interno de cada uno: «En costeo», «Con Gerencia»,
 * «Devuelta». Eso describe el trámite por dentro, que es de Administración; el
 * vendedor no necesita saber en cuál de las tres manos está parada, necesita
 * saber si ya puede mandársela al cliente.
 *
 * Cada etapa agrupa los estados que para Ventas significan lo mismo. Las
 * cerradas siguen estando —una rechazada se retoma, y ese es justo el caso en
 * el que hay que ir a buscarla—.
 */
export const ETAPA_VENTA = [
  {
    clave: 'realizada',
    etiqueta: 'Cotización realizada',
    estados: ['BORRADOR'],
    pie: 'Escrita, sin mandar a costear',
  },
  {
    clave: 'costeando',
    etiqueta: 'En costeo',
    estados: ['EN_COSTEO', 'EN_REVISION', 'OBSERVADA'],
    pie: 'En manos de Administración o Gerencia',
  },
  {
    clave: 'costeada',
    etiqueta: 'Ya costeada',
    estados: ['REVISADA'],
    pie: 'Con el visto: lista para enviar al cliente',
  },
  {
    clave: 'con-cliente',
    etiqueta: 'Con el cliente',
    estados: ['ENVIADA'],
    pie: 'Enviada, sin respuesta todavía',
  },
  {
    clave: 'aprobada',
    etiqueta: 'Aprobada',
    estados: ['APROBADA'],
    pie: 'El cliente la aceptó',
  },
  {
    clave: 'rechazada',
    etiqueta: 'Rechazada',
    estados: ['RECHAZADA', 'VENCIDA'],
    pie: 'Se puede retomar y volver a ofrecer',
  },
  {
    clave: 'anulada',
    etiqueta: 'Anulada',
    estados: ['ANULADA'],
    pie: 'Anulada con su motivo, queda como evidencia',
  },
] as const

export type EtapaVenta = (typeof ETAPA_VENTA)[number]

/** Los estados que hay detrás de una etapa. Vacío si la clave no existe. */
export function estadosDeEtapa(clave?: string | null): string[] {
  if (!clave) return []
  return [...(ETAPA_VENTA.find((e) => e.clave === clave)?.estados ?? [])]
}

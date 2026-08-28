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

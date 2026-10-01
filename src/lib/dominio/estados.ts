import type { Enums } from '@/types/database'

type EstadoEtapa = Enums<'estado_etapa_ot'>
type EstadoRevision = Enums<'estado_revision'>

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

/**
 * En qué va un trabajo sin orden: una unidad que entró sin orden de trabajo o
 * algo que el taller está implementando. No hay «entregado» a propósito: en este
 * sistema entregar es el acta de conformidad, y eso no pasa cuando el
 * supervisor lo marca desde el celular. «Terminado» existe para que entre
 * «terminé el jueves» y «el chofer la recogió el lunes» no cuente como sin
 * noticias. En la base siguen siendo EN_TALLER, LISTA y SALIO.
 */
export const ESTADO_FLOTA: Record<string, Def> = {
  EN_TALLER: { etiqueta: 'En curso', tono: 'acento', descripcion: 'Se está trabajando' },
  LISTA: { etiqueta: 'Terminado', tono: 'exito', descripcion: 'Terminado; si es una unidad, falta que la recojan' },
  SALIO: { etiqueta: 'Cerrado', tono: 'neutro', descripcion: 'Ya no se trabaja: salió del taller o se dio por cerrado' },
}

/**
 * En qué va un reporte del día con el jefe de producción. «Por aprobar» no
 * frena nada —el avance cuenta desde que se reporta—; «Observado» vuelve a
 * quien lo escribió para que lo corrija.
 */
/** Lo que traen las tres vistas de reportes sobre su revisión (migración 097). */
export type DatosRevision = {
  revision: string | null
  observacion: string | null
  revisado_en: string | null
  revisado_por_nombre: string | null
  corregido_en: string | null
}

export const REVISION: Record<EstadoRevision, Def> = {
  PENDIENTE: { etiqueta: 'Por aprobar', tono: 'aviso', descripcion: 'Esperando la revisión de Administración' },
  APROBADO: { etiqueta: 'Aprobado', tono: 'exito', descripcion: 'Con visto bueno: queda como está' },
  OBSERVADO: { etiqueta: 'Observado', tono: 'peligro', descripcion: 'Administración pidió corregirlo' },
}

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

/** Los gastos que cada área carga a su OT; Administración los aprueba (migración 20260929226000). */
export const ESTADO_GASTO_AREA: Record<string, Def> = {
  PENDIENTE: { etiqueta: 'Por aprobar', tono: 'aviso' },
  APROBADO: { etiqueta: 'Aprobado', tono: 'exito' },
  OBSERVADO: { etiqueta: 'Observado', tono: 'peligro' },
}

export const TIPO_GASTO_AREA: Record<string, Def> = {
  SERVICIO: { etiqueta: 'Servicio', tono: 'neutro' },
  TRANSPORTE: { etiqueta: 'Transporte', tono: 'neutro' },
  VIATICO: { etiqueta: 'Viático', tono: 'neutro' },
  SUBCONTRATO: { etiqueta: 'Subcontrato', tono: 'neutro' },
  OTRO: { etiqueta: 'Otro', tono: 'neutro' },
  TRAMITE: { etiqueta: 'Trámites de placas y documentación', tono: 'neutro' },
  COMISION: { etiqueta: 'Comisión de venta', tono: 'neutro' },
}

/** Lo que Costos le pide a Tesorería desde la OT (migración 20260929160000). */
export const ESTADO_SOLICITUD_TESORERIA: Record<string, Def> = {
  PENDIENTE: { etiqueta: 'Pendiente', tono: 'aviso' },
  ATENDIDA: { etiqueta: 'Atendida', tono: 'exito' },
  OBSERVADA: { etiqueta: 'Observada', tono: 'peligro' },
}

/** Los comprobantes que registra Contabilidad en Adquisiciones (migración 20260929190000). */
export const TIPO_COMPROBANTE: Record<string, Def> = {
  FACTURA_COMPRA: { etiqueta: 'Factura de compra', tono: 'neutro' },
  RECIBO_HONORARIOS: { etiqueta: 'Recibo por honorarios', tono: 'neutro' },
  FACTURA_VEHICULO: { etiqueta: 'Factura de vehículo', tono: 'neutro' },
  FACTURA_TESORERIA: { etiqueta: 'Factura de Tesorería', tono: 'neutro' },
  OTRO: { etiqueta: 'Otro comprobante', tono: 'neutro' },
}

export const ESTADO_COMPROBANTE: Record<string, Def> = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'aviso', descripcion: 'Falta adjuntar el PDF o vincular la factura' },
  REGISTRADA: { etiqueta: 'Registrado', tono: 'exito' },
}

export const TIPO_PLANILLA: Record<string, Def> = {
  TALLER: { etiqueta: 'Planilla de taller', tono: 'neutro' },
  ADMINISTRATIVA: { etiqueta: 'Planilla administrativa', tono: 'neutro' },
  SUBCONTRATOS: { etiqueta: 'Subcontratos', tono: 'neutro' },
}

const VACIO: Def = { etiqueta: '—', tono: 'neutro' }

/** Busca la definición de un valor de enum sin reventar si llega uno desconocido. */
export function definir(mapa: Record<string, Def>, valor: string | null | undefined): Def {
  if (!valor) return VACIO
  return mapa[valor] ?? { etiqueta: valor.replaceAll('_', ' ').toLowerCase(), tono: 'neutro' }
}

/**
 * El estado de una orden como se lee. Una que abrió el taller y sigue en
 * borrador no es un borrador de oficina: está «por revisar», esperando que el
 * jefe de producción la apruebe o la rechace (migración 098).
 */
export function estadoDeOrden(estado: string | null | undefined, abiertaEnTaller?: boolean | null): Def {
  if (estado === 'BORRADOR' && abiertaEnTaller) {
    return {
      etiqueta: 'Por revisar',
      tono: 'aviso',
      descripcion: 'La abrió el taller: la aprueba o la rechaza Administración',
    }
  }
  return definir(ESTADO_OT, estado)
}

/** Convierte un mapa en opciones para un <select>, respetando un orden dado. */
export function opciones(mapa: Record<string, Def>, orden?: readonly string[]) {
  const claves = orden ?? Object.keys(mapa)
  return claves.map((valor) => ({ valor, etiqueta: mapa[valor]?.etiqueta ?? valor }))
}

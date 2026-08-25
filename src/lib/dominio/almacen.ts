import type { Tono } from '@/components/ui/etiqueta-estado'

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

export const TIPO_MOVIMIENTO: Record<string, Def> = {
  INGRESO: { etiqueta: 'Ingreso', tono: 'exito', descripcion: 'Entrada de material al almacén' },
  SALIDA_OT: { etiqueta: 'Vale de consumo', tono: 'acento', descripcion: 'Material que se entrega a una orden' },
  DEVOLUCION_OT: { etiqueta: 'Devolución', tono: 'info', descripcion: 'El taller devuelve lo que no consumió' },
  TRANSFERENCIA: { etiqueta: 'Transferencia', tono: 'info', descripcion: 'Traslado entre almacenes' },
  AJUSTE: { etiqueta: 'Ajuste', tono: 'aviso', descripcion: 'Corrección por inventario físico' },
  SALIDA_MERMA: { etiqueta: 'Merma', tono: 'peligro', descripcion: 'Baja por recorte o material inservible' },
}

export const ESTADO_MOVIMIENTO: Record<string, Def> = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' },
  CONFIRMADO: { etiqueta: 'Confirmado', tono: 'exito' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro' },
}

export const ESTADO_REQUERIMIENTO: Record<string, Def> = {
  SOLICITADO: { etiqueta: 'Solicitado', tono: 'aviso' },
  APROBADO: { etiqueta: 'Aprobado', tono: 'info' },
  ATENDIDO_PARCIAL: { etiqueta: 'Atendido parcial', tono: 'info' },
  ATENDIDO: { etiqueta: 'Atendido', tono: 'exito' },
  RECHAZADO: { etiqueta: 'Rechazado', tono: 'peligro' },
  ANULADO: { etiqueta: 'Anulado', tono: 'neutro' },
}

export const ESTADO_ORDEN_COMPRA: Record<string, Def> = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'info' },
  ENVIADA: { etiqueta: 'Enviada', tono: 'info' },
  RECIBIDA_PARCIAL: { etiqueta: 'Recibida parcial', tono: 'aviso' },
  RECIBIDA: { etiqueta: 'Recibida', tono: 'exito' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

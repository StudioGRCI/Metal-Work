import type { Tono } from '@/components/ui/etiqueta-estado'

type Def = { etiqueta: string; tono: Tono; descripcion?: string }

/**
 * Lo que se manda a hacer afuera. Son los trabajos que el taller subcontrata
 * porque no tiene la máquina o no le conviene tenerla.
 */
export const TIPO_SERVICIO: Record<string, Def> = {
  ARENADO: { etiqueta: 'Arenado', tono: 'neutro' },
  PINTURA: { etiqueta: 'Pintura', tono: 'neutro' },
  CORTE_LASER: { etiqueta: 'Corte láser', tono: 'neutro' },
  CORTE_PLASMA: { etiqueta: 'Corte plasma', tono: 'neutro' },
  DOBLADO: { etiqueta: 'Doblado', tono: 'neutro' },
  TORNO: { etiqueta: 'Torno', tono: 'neutro' },
  GALVANIZADO: { etiqueta: 'Galvanizado', tono: 'neutro' },
  TRATAMIENTO_TERMICO: { etiqueta: 'Tratamiento térmico', tono: 'neutro' },
  TAPICERIA: { etiqueta: 'Tapicería', tono: 'neutro' },
  ELECTRICIDAD: { etiqueta: 'Electricidad', tono: 'neutro' },
  HIDRAULICA: { etiqueta: 'Hidráulica', tono: 'neutro' },
  TRANSPORTE: { etiqueta: 'Transporte', tono: 'neutro' },
  CERTIFICACION: { etiqueta: 'Certificación', tono: 'neutro' },
  OTRO: { etiqueta: 'Otro', tono: 'neutro' },
}

/**
 * El recorrido de una orden de servicio. La conformidad es la bisagra: antes
 * de ella el monto es compromiso, después es costo de la unidad, y sin ella no
 * se paga.
 */
export const ESTADO_SERVICIO: Record<string, Def> = {
  SOLICITADO: {
    etiqueta: 'Solicitada',
    tono: 'neutro',
    descripcion: 'Se le pidió al proveedor y todavía no empezó',
  },
  EN_EJECUCION: {
    etiqueta: 'En el proveedor',
    tono: 'info',
    descripcion: 'El trabajo está afuera',
  },
  EJECUTADO: {
    etiqueta: 'Ejecutada',
    tono: 'acento',
    descripcion: 'El proveedor terminó y falta darle la conformidad',
  },
  CONFORME: {
    etiqueta: 'Conforme',
    tono: 'exito',
    descripcion: 'El trabajo volvió y se aceptó: ya es costo de la unidad',
  },
  PAGADO: { etiqueta: 'Pagada', tono: 'exito', descripcion: 'Con factura y pagada' },
  ANULADO: { etiqueta: 'Anulada', tono: 'peligro' },
}

/** A dónde puede pasar una orden de servicio desde donde está. */
export const SIGUIENTES_SERVICIO: Record<string, string[]> = {
  SOLICITADO: ['EN_EJECUCION', 'EJECUTADO', 'ANULADO'],
  EN_EJECUCION: ['EJECUTADO', 'ANULADO'],
  EJECUTADO: ['ANULADO'],
  CONFORME: ['PAGADO'],
  PAGADO: [],
  ANULADO: [],
}

import type { Tono } from '@/components/ui/etiqueta-estado'

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/** En qué va el requerimiento. EN_ATENCION y ATENDIDO los marca Logística. */
export const ESTADO_REQUERIMIENTO: Record<string, Def> = {
  POR_ATENDER: { etiqueta: 'Por atender', tono: 'aviso', descripcion: 'Le llegó a Logística; todavía no lo empieza.' },
  EN_ATENCION: { etiqueta: 'En atención', tono: 'info', descripcion: 'Logística lo está comprando.' },
  ATENDIDO: { etiqueta: 'Atendido', tono: 'exito', descripcion: 'Logística lo cerró.' },
  ANULADO: { etiqueta: 'Anulado', tono: 'peligro', descripcion: 'Anulado con su motivo.' },
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

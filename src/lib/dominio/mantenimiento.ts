import type { Tono } from '@/components/ui/etiqueta-estado'

/** El permiso que da la lista de las OT de mantenimiento: el mismo que exige `mantenimiento_ots`. */
export const PERMISO_OTS_DE_MANTENIMIENTO = 'mantenimiento.ots'

type DeLaOt = {
  abierta: boolean
  estado: string
  en_planta: boolean
  ingreso_en: string | null
  salida_en: string | null
}

/**
 * En qué está la OT de mantenimiento para quien hace el trabajo, en una
 * palabra: si ya se terminó, si está pausada, si el vehículo ya entró.
 */
export function situacionDeLaOt(ot: DeLaOt): { etiqueta: string; tono: Tono } {
  if (!ot.abierta) return { etiqueta: 'Terminada', tono: 'exito' }
  if (ot.estado === 'PAUSADA') return { etiqueta: 'Pausada', tono: 'aviso' }
  if (ot.en_planta) return { etiqueta: 'En la planta', tono: 'info' }
  if (ot.salida_en) return { etiqueta: 'El vehículo salió', tono: 'aviso' }
  return { etiqueta: 'Espera el vehículo', tono: 'neutro' }
}

/**
 * Hay trabajo que reportar hoy en la OT: sigue abierta, sin pausa, y el
 * vehículo está en la planta. Es lo que decide si a Mantenimiento se le pide su
 * reporte diario del día.
 */
export function tieneTrabajoHoy(ot: Pick<DeLaOt, 'abierta' | 'estado' | 'en_planta'>): boolean {
  return ot.abierta && ot.estado !== 'PAUSADA' && ot.en_planta
}

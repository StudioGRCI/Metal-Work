import type { Vistas } from '@/types/database'

/** Estado del programa compartido por el resumen servidor y la edición cliente. */
export function programaDeEtapa(
  etapa: Pick<Vistas<'ot_tablero_etapas'>, 'estado' | 'fecha_fin_real' | 'fecha_inicio_programada' | 'fecha_fin_programada'>,
  hoy: string,
) {
  const cerrada = Boolean(etapa.fecha_fin_real) || etapa.estado === 'TERMINADA' || etapa.estado === 'OMITIDA'
  const fin = etapa.fecha_fin_programada
  const inicio = etapa.fecha_inicio_programada
  const vencida = !cerrada && fin !== null && fin < hoy
  const tocaAhora = !cerrada && !vencida && inicio !== null && inicio <= hoy
  return { vencida, tocaAhora, inicio, fin }
}

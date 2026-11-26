import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Lo que falta para cerrar una planilla del mes (`planilla_lo_que_falta`,
 * migración 20261126310000): de la de taller, los reportes diarios del mes sin
 * el visto de RR. HH. u observados; de la de taller y la administrativa, quien
 * no tiene cuenta bancaria en su ficha o no tiene ficha. Avisa, no frena el
 * cierre. Lo lee quien ve las planillas; la cuenta misma no viene, solo que falta.
 */
export type ClaseDeLoQueFalta = 'REPORTE_SIN_VISTO' | 'REPORTE_OBSERVADO' | 'SIN_CUENTA' | 'SIN_FICHA'

export type LoQueFalta = {
  clase: ClaseDeLoQueFalta
  /** El reporte; la ficha de quien no tiene cuenta; la fila de la planilla de quien no tiene ficha. */
  documento: string
  /** La fecha del reporte. */
  fecha: string | null
  /** El asunto del reporte o el nombre de la persona. */
  nombre: string
  /** «Taller · CI-0001» del reporte; «Sin cuenta bancaria en su ficha». */
  detalle: string | null
  /** Desde cuándo espera el reporte. */
  desde: string | null
  /** Días que lleva esperando, por fecha de Lima (los cuenta la base). */
  dias: number | null
}

const CLASES: readonly ClaseDeLoQueFalta[] = ['REPORTE_SIN_VISTO', 'REPORTE_OBSERVADO', 'SIN_CUENTA', 'SIN_FICHA']

type Fila = {
  clase: string | null
  documento: string | null
  fecha: string | null
  nombre: string | null
  detalle: string | null
  desde: string | null
  dias: number | null
}

/** Lo que falta de cada planilla en preparación, por su id. Las cerradas no se piden: ya no les falta nada. */
export async function loQueFaltaDePlanillas(ids: string[]): Promise<Map<string, LoQueFalta[]>> {
  const porPlanilla = new Map<string, LoQueFalta[]>()
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return porPlanilla
  const supabase = await createClient()
  const respuestas = await Promise.all(unicos.map((id) => supabase.rpc('planilla_lo_que_falta', { p_planilla: id })))
  respuestas.forEach(({ data, error }, i) => {
    if (error) throw new Error(`No se pudo leer lo que falta para cerrar la planilla: ${error.message}`)
    const filas: LoQueFalta[] = []
    for (const f of (data ?? []) as Fila[]) {
      // Una clase que la pantalla no conoce no se esconde ni se inventa: se avisa en el registro.
      if (!f.clase || !CLASES.includes(f.clase as ClaseDeLoQueFalta) || !f.documento) {
        console.error(`[planillas] planilla_lo_que_falta devolvió una fila que la pantalla no conoce: ${f.clase ?? 'sin clase'}`)
        continue
      }
      filas.push({
        clase: f.clase as ClaseDeLoQueFalta,
        documento: f.documento,
        fecha: f.fecha,
        nombre: f.nombre ?? 'Sin nombre',
        detalle: f.detalle,
        desde: f.desde,
        dias: f.dias == null ? null : Number(f.dias),
      })
    }
    porPlanilla.set(unicos[i], filas)
  })
  return porPlanilla
}

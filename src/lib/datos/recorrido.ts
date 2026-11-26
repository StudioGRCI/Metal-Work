import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import type { PasoDelRecorrido, SituacionDelPaso } from '@/lib/dominio/recorrido'
import { createClient } from '@/lib/supabase/server'

/**
 * El recorrido de cada documento, por su id (migración 20261125130000): lo
 * hecho con el puesto de quien lo hizo y su hora (nunca su nombre); quién lo tiene ahora y hace cuántos
 * días; y lo que falta. La función de cada documento decide quién lo lee: quien
 * ya ve el documento. Las frases se ponen con `src/lib/dominio/recorrido.ts`.
 */
export type Recorridos = Map<string, PasoDelRecorrido[]>

type Fila = {
  documento: string | null
  orden: number | null
  paso: string | null
  situacion: string | null
  puesto: string | null
  en: string | null
  dias: number | null
  espera: string | null
  detalle: string | null
}

const SITUACIONES: readonly SituacionDelPaso[] = ['HECHO', 'AHORA', 'PENDIENTE']

// Una fila por paso: cien documentos rara vez pasan de mil, y si pasan se lee otra tanda.
const POR_TANDA = 100

async function leer(
  funcion:
    | 'recorrido_de_requerimientos'
    | 'recorrido_de_cotizaciones'
    | 'recorrido_de_planillas'
    | 'recorrido_de_averias'
    | 'recorrido_de_ordenes_compra'
    | 'recorrido_de_ordenes_servicio',
  ids: string[],
  de: string,
): Promise<Recorridos> {
  const porDocumento: Recorridos = new Map()
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return porDocumento
  const supabase = await createClient()
  const tandas: string[][] = []
  for (let i = 0; i < unicos.length; i += POR_TANDA) tandas.push(unicos.slice(i, i + POR_TANDA))
  const respuestas = await Promise.all(
    tandas.map((tanda) => todasLasFilas<Fila>(() => supabase.rpc(funcion, { p_ids: tanda }), ['documento', 'orden'])),
  )
  let sueltas = 0
  const raras = new Set<string>()
  for (const { data, error } of respuestas) {
    if (error) throw new Error(`No se pudo leer el recorrido de ${de}: ${error.message}`)
    for (const f of data) {
      // La función siempre da documento, orden y paso: si falta uno, se cuenta y se dice abajo.
      if (!f.documento || f.orden == null || !f.paso) {
        sueltas++
        continue
      }
      const conocida = SITUACIONES.includes(f.situacion as SituacionDelPaso)
      if (!conocida) raras.add(String(f.situacion))
      // Una situación que la pantalla no conoce se pinta como lo que falta, nunca como hecho.
      const situacion = conocida ? (f.situacion as SituacionDelPaso) : 'PENDIENTE'
      const pasos = porDocumento.get(f.documento) ?? []
      pasos.push({
        orden: f.orden,
        paso: f.paso,
        situacion,
        puesto: f.puesto,
        en: f.en,
        dias: f.dias == null ? null : Number(f.dias),
        espera: f.espera,
        detalle: f.detalle,
      })
      porDocumento.set(f.documento, pasos)
    }
  }
  if (sueltas > 0 || raras.size > 0) {
    console.error(
      `[recorrido] ${funcion}: ${sueltas} filas sin documento, orden o paso; situaciones desconocidas: ${[...raras].join(', ') || 'ninguna'}`,
    )
  }
  for (const pasos of porDocumento.values()) pasos.sort((a, b) => a.orden - b.orden)
  return porDocumento
}

/** El recorrido de esos requerimientos. Lo lee quien ve los requerimientos; a los demás la base les dice que no. */
export const recorridoDeRequerimientos = (ids: string[]) => leer('recorrido_de_requerimientos', ids, 'los requerimientos')

/** El recorrido de esas cotizaciones: solo de las que quien mira ya puede ver. */
export const recorridoDeCotizaciones = (ids: string[]) => leer('recorrido_de_cotizaciones', ids, 'las cotizaciones')

/** El recorrido de esas planillas del mes. Lo lee quien ve las planillas (`rrhh.ver_planillas`). */
export const recorridoDePlanillas = (ids: string[]) => leer('recorrido_de_planillas', ids, 'las planillas')

/** El recorrido de esos reportes de avería (Plan 16.2): solo de los que quien mira ya puede ver. */
export const recorridoDeAverias = (ids: string[]) => leer('recorrido_de_averias', ids, 'los reportes de avería')

/** El recorrido de esas OC (Plan 4.2): quién la tiene, y el motivo y la fecha que anotó Logística. Con el alcance del listado. */
export const recorridoDeOrdenesCompra = (ids: string[]) => leer('recorrido_de_ordenes_compra', ids, 'las órdenes de compra')

/** El recorrido de esas OS (Plan 4.2). */
export const recorridoDeOrdenesServicio = (ids: string[]) => leer('recorrido_de_ordenes_servicio', ids, 'las órdenes de servicio')

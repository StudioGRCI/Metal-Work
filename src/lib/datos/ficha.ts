import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type LineaFicha = {
  id: string
  seccion: string
  orden_seccion: number
  orden_linea: number
  etiqueta: string | null
  detalle: string
}

export type AccesorioCotizado = {
  id: string
  orden: number
  cantidad: number
  unidad: string
  descripcion: string
  incluye_el_accesorio: boolean
  observacion: string | null
}

export type SeccionFicha = { seccion: string; lineas: LineaFicha[] }

/** La ficha técnica de una cotización, agrupada por sección y en su orden. */
export async function fichaDeCotizacion(cotizacionId: string): Promise<SeccionFicha[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizacion_especificaciones')
    .select('id, seccion, orden_seccion, orden_linea, etiqueta, detalle')
    .eq('cotizacion_id', cotizacionId)
    .order('orden_seccion')
    .order('orden_linea')

  if (error) throw new Error(`No se pudo leer la ficha técnica: ${error.message}`)

  const secciones: SeccionFicha[] = []
  for (const linea of (data ?? []) as unknown as LineaFicha[]) {
    const ultima = secciones[secciones.length - 1]
    if (ultima && ultima.seccion === linea.seccion) ultima.lineas.push(linea)
    else secciones.push({ seccion: linea.seccion, lineas: [linea] })
  }
  return secciones
}

/** El equipamiento que la cotización promete. */
export async function accesoriosDeCotizacion(cotizacionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizacion_accesorios')
    .select('id, orden, cantidad, unidad, descripcion, incluye_el_accesorio, observacion')
    .eq('cotizacion_id', cotizacionId)
    .order('orden')

  if (error) throw new Error(`No se pudieron leer los accesorios: ${error.message}`)
  return (data ?? []) as unknown as AccesorioCotizado[]
}

/**
 * Las fichas preescritas que sirven para este tipo de carrocería. Sin tipo se
 * devuelven todas, porque a veces conviene partir de la de otro producto.
 */
export async function plantillasDisponibles(tipoCarroceriaId?: string | null) {
  const supabase = await createClient()

  let consulta = supabase
    .from('plantillas_ficha')
    .select('id, nombre, descripcion, tipo_carroceria_id, tipo:tipos_carroceria(nombre)')
    .eq('activa', true)
    .order('nombre')

  if (tipoCarroceriaId) consulta = consulta.eq('tipo_carroceria_id', tipoCarroceriaId)

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudieron leer las plantillas: ${error.message}`)

  return (data ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    carroceria: (p.tipo as unknown as { nombre: string } | null)?.nombre ?? null,
  }))
}

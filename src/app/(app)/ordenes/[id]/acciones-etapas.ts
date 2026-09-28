'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const uuid = z.string().uuid()
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export async function definirEtapas(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) return { ok: false, error: 'Solo Diseño define las etapas.' }
  const orden = uuid.safeParse(datos.get('orden_id'))
  const seleccion = datos.getAll('etapa_id').map((valor) => uuid.safeParse(valor))
  if (!orden.success || seleccion.length === 0 || seleccion.some((id) => !id.success) ||
      new Set(seleccion.filter((id) => id.success).map((id) => id.data)).size !== seleccion.length) {
    return { ok: false, error: 'Seleccione al menos una etapa válida.' }
  }
  const configuracion = seleccion.map((id) => {
    if (!id.success) throw new Error('Etapa inválida')
    const area = uuid.safeParse(datos.get(`area_${id.data}`))
    const peso = z.coerce.number().int().min(1).max(100).safeParse(datos.get(`peso_${id.data}`))
    return { catalogo_id: id.data, area_id: area.success ? area.data : null, peso_pct: peso.success ? peso.data : null }
  })
  if (configuracion.some((e) => e.area_id === null || e.peso_pct === null)) {
    return { ok: false, error: 'Cada etapa necesita un área y un peso entre 1 y 100 %.' }
  }
  if (configuracion.reduce((total, e) => total + (e.peso_pct ?? 0), 0) !== 100) {
    return { ok: false, error: 'Los pesos de las etapas deben sumar 100 %.' }
  }
  const supabase = await createClient()
  const conversion = datos.get('conversion') === '1'
  const etapaActividad = uuid.safeParse(datos.get('etapa_actividad'))
  if (conversion && (!etapaActividad.success || !seleccion.some((id) => id.success && id.data === etapaActividad.data))) {
    return { ok: false, error: 'Elige la etapa de la actividad que ya existe en esta OT.' }
  }
  const { data, error } = conversion && etapaActividad.success
    ? await supabase.rpc('reemplazar_etapas_historicas', {
        p_orden_id: orden.data, p_config: configuracion, p_etapa_actividad: etapaActividad.data,
      })
    : await supabase.rpc('definir_etapas_ponderadas', {
        p_orden_id: orden.data, p_config: configuracion,
      })
  if (error) return { ok: false, error: mensajeDeError(error) }
  revalidatePath(`/ordenes/${orden.data}`)
  revalidatePath('/plazos')
  return { ok: true, mensaje: `${data} etapas definidas para la OT.` }
}

export async function programarEtapa(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.editar')) return { ok: false, error: 'Solo Administración programa las etapas.' }
  const orden = uuid.safeParse(datos.get('orden_id'))
  const etapa = uuid.safeParse(datos.get('etapa_id'))
  const inicio = fecha.safeParse(datos.get('inicio'))
  const fin = fecha.safeParse(datos.get('fin'))
  if (!orden.success || !etapa.success || !inicio.success || !fin.success || fin.data < inicio.data) {
    return { ok: false, error: 'Indique un inicio y un fin válidos.' }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('programar_etapa_administracion', {
    p_etapa_id: etapa.data, p_inicio: inicio.data, p_fin: fin.data,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== etapa.data) return { ok: false, error: 'La fecha no se guardó.' }
  revalidatePath(`/ordenes/${orden.data}`)
  revalidatePath('/plazos')
  return { ok: true, mensaje: 'Fechas de la etapa guardadas.' }
}

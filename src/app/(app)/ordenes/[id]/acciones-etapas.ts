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
  if (!orden.success || seleccion.length === 0 || seleccion.some((id) => !id.success)) {
    return { ok: false, error: 'Seleccione al menos una etapa válida.' }
  }
  const ordenadas = seleccion.map((id) => {
    if (!id.success) throw new Error('Etapa inválida')
    const posicion = z.coerce.number().int().min(1).max(100).safeParse(datos.get(`posicion_${id.data}`))
    return { id: id.data, posicion: posicion.success ? posicion.data : null }
  })
  if (ordenadas.some((e) => e.posicion === null) ||
      new Set(ordenadas.map((e) => e.posicion)).size !== ordenadas.length) {
    return { ok: false, error: 'Cada etapa necesita una posición distinta.' }
  }
  ordenadas.sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('definir_etapas_diseno', {
    p_orden_id: orden.data, p_etapas: ordenadas.map((e) => e.id),
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

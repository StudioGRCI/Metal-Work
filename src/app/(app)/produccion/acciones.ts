'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'

const esquemaParte = z.object({
  fecha: z.string().min(10, 'Indica la fecha del parte'),
  sede_id: z.string().uuid('Selecciona el taller'),
  observaciones: z.string().trim().optional(),
})

export async function crearParte(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para registrar producción.' }
  }

  const analisis = esquemaParte.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('partes_diarios')
    .insert({
      fecha: v.fecha,
      sede_id: v.sede_id,
      responsable_id: perfil.id,
      observaciones: v.observaciones?.trim() || null,
    })
    .select('id')
    .single()

  if (error) {
    // Solo puede existir un parte por taller y día; conviene decirlo claro.
    if (error.code === '23505') {
      return { ok: false, error: 'Ya existe un parte para ese taller y esa fecha.' }
    }
    return { ok: false, error: mensajeDeError(error) }
  }

  revalidatePath('/produccion')
  redirect(`/produccion/${data.id}`)
}

const esquemaLinea = z.object({
  parte_id: z.string().uuid(),
  orden_id: z.string().uuid('Selecciona la orden de trabajo'),
  etapa_id: z.string().uuid('Selecciona la etapa'),
  usuario_id: z.string().uuid('Selecciona el operario'),
  horas: z.coerce.number().positive('Las horas deben ser mayores que cero').max(24),
  horas_extra: z.coerce.number().min(0).max(12).default(0),
  descripcion: z.string().trim().optional(),
})

export async function agregarHoras(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para registrar producción.' }
  }

  const analisis = esquemaLinea.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase.from('parte_detalle').insert({
    parte_id: v.parte_id,
    orden_id: v.orden_id,
    etapa_id: v.etapa_id,
    usuario_id: v.usuario_id,
    horas: v.horas,
    horas_extra: v.horas_extra,
    descripcion: v.descripcion?.trim() || null,
  })

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'Ese operario ya tiene horas registradas en esa orden y etapa dentro de este parte.',
      }
    }
    return { ok: false, error: mensajeDeError(error) }
  }

  revalidatePath(`/produccion/${v.parte_id}`)
  return { ok: true, mensaje: 'Horas registradas.' }
}

export async function eliminarHoras(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para modificar el parte.' }
  }

  const id = String(datos.get('linea_id') ?? '')
  const parteId = String(datos.get('parte_id') ?? '')
  if (!id || !parteId) return { ok: false, error: 'Solicitud inválida.' }

  const supabase = await createClient()
  const { error } = await supabase.from('parte_detalle').delete().eq('id', id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/produccion/${parteId}`)
  return { ok: true, mensaje: 'Registro eliminado.' }
}

const esquemaEstadoParte = z.object({
  parte_id: z.string().uuid(),
  estado: z.enum(['BORRADOR', 'CERRADO', 'APROBADO']),
})

export async function cambiarEstadoParte(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()

  const analisis = esquemaEstadoParte.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Solicitud inválida.' }
  const { parte_id, estado } = analisis.data

  // Aprobar es lo que carga las horas a las órdenes y al costo de mano de obra,
  // así que exige un permiso distinto al de simplemente registrar.
  const permiso = estado === 'APROBADO' ? 'produccion.aprobar_parte' : 'produccion.registrar'
  if (!puede(perfil, permiso)) {
    return { ok: false, error: 'No tienes permiso para este cambio.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('partes_diarios')
    .update({ estado, ...(estado === 'APROBADO' ? { aprobado_por: perfil.id } : {}) })
    .eq('id', parte_id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/produccion/${parte_id}`)
  revalidatePath('/produccion')
  revalidatePath('/ordenes')
  return { ok: true, mensaje: 'Parte actualizado.' }
}

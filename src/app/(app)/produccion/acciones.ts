'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'

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
  // Acotado también por el parte del formulario: el id de la línea llega del
  // navegador y sin esto podría apuntar a la de otro parte.
  const { data, error } = await supabase
    .from('parte_detalle')
    .delete()
    .eq('id', id)
    .eq('parte_id', parteId)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

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
  const { data, error } = await supabase
    .from('partes_diarios')
    .update({ estado, ...(estado === 'APROBADO' ? { aprobado_por: perfil.id } : {}) })
    .eq('id', parte_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/produccion/${parte_id}`)
  revalidatePath('/produccion')
  revalidatePath('/ordenes')
  return { ok: true, mensaje: 'Parte actualizado.' }
}

/**
 * Las etapas de una orden, para el desplegable del parte diario.
 *
 * Va por acción de servidor y no por consulta desde el navegador: así el error
 * llega a la pantalla en vez de perderse —antes la lista quedaba vacía sin que
 * nadie supiera por qué— y esta ruta deja de cargar el cliente de Supabase.
 */
export async function etapasParaElParte(
  ordenId: string,
): Promise<ResultadoAccion<{ etapa_id: string; etapa: string }[]>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para registrar horas.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ot_tablero_etapas')
    .select('etapa_id, etapa, orden_secuencia')
    .eq('orden_id', ordenId)
    .order('orden_secuencia')

  if (error) return { ok: false, error: mensajeDeError(error) }

  return {
    ok: true,
    datos: (data ?? []).map((e) => ({ etapa_id: e.etapa_id as string, etapa: e.etapa as string })),
  }
}

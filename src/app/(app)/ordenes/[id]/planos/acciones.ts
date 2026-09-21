'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const esquema = z.object({
  id: z.string().uuid(), plano_id: z.string().uuid(), area_id: z.string().uuid(),
  nombre_archivo: z.string().trim().min(1).max(200),
})

export async function registrarVersionPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) return { ok: false, error: 'Las versiones las carga Diseño.' }
  const analisis = esquema.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Elige el plano, el área y un PDF válido.' }
  const v = analisis.data
  const supabase = await createClient()
  const ruta = `${perfil.id}/${v.id}.pdf`
  // Comprobar el contenido en el servidor; extensión y MIME del navegador no bastan.
  const { data: archivo, error: descarga } = await supabase.storage.from('planos-privados').download(ruta)
  if (descarga || !archivo) return { ok: false, error: 'No se pudo comprobar el PDF cargado. Vuelve a intentar.' }
  if (archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
    return { ok: false, error: 'El archivo debe ser un PDF de hasta 20 MB.' }
  }
  const { data, error } = await supabase.rpc('registrar_version_plano', {
    p_id: v.id, p_plano: v.plano_id, p_area: v.area_id, p_nombre: v.nombre_archivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó la versión. Recarga antes de volver a intentar.' }
  revalidatePath('/ordenes', 'layout')
  return { ok: true, mensaje: 'Versión enviada a revisión. El área la verá cuando sea aprobada.' }
}

export async function resolverVersionPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = z.object({
    id: z.string().uuid(), accion: z.enum(['aprobar', 'observar', 'recibir']),
    observacion: z.string().trim().max(1000).optional(),
  }).safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Revisa la acción y la observación (máximo 1000 caracteres).' }
  const v = analisis.data
  if (!puede(perfil, v.accion === 'recibir' ? ['produccion.actividades', 'produccion.cualquier_area'] : 'diseno.revisar')) {
    return { ok: false, error: 'No tienes permiso para realizar esta acción.' }
  }
  const supabase = await createClient()
  const { data, error } = v.accion === 'recibir'
    ? await supabase.rpc('recibir_version_plano', { p_id: v.id })
    : await supabase.rpc('revisar_version_plano', { p_id: v.id, p_aprobar: v.accion === 'aprobar', p_observacion: v.observacion || undefined })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó el cambio. Recarga la pantalla.' }
  revalidatePath('/ordenes', 'layout')
  return { ok: true, mensaje: v.accion === 'recibir' ? 'Recepción registrada.' : v.accion === 'aprobar' ? 'Versión aprobada y disponible para el área.' : 'Observación registrada. Diseño debe cargar una nueva versión.' }
}

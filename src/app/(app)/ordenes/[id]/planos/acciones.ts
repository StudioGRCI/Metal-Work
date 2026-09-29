'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const esquema = z.object({
  id: z.string().uuid(), plano_id: z.string().uuid(), area_id: z.string().uuid(),
  nombre_archivo: z.string().trim().min(1).max(200),
  nota_envio: z.string().trim().max(1000).optional(),
})

export async function registrarVersionPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['diseno.planos', 'diseno.subir_pdf'])) return { ok: false, error: 'Las versiones las carga Diseño.' }
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
  const { data, error } = await supabase.rpc('registrar_version_plano_con_nota', {
    p_id: v.id, p_plano: v.plano_id, p_area: v.area_id, p_nombre: v.nombre_archivo,
    p_nota: v.nota_envio ?? '',
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
  if (!puede(perfil, ['produccion.actividades', 'produccion.cualquier_area'])) {
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

export async function asignarEquipoDiseno(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.asignar')) return { ok: false, error: 'La asignación de Diseño corresponde al líder del área.' }

  const ordenId = z.string().uuid().safeParse(formulario.get('orden_id'))
  const lider = z.union([z.string().uuid(), z.literal('')]).safeParse(formulario.get('lider_id'))
  const ids = formulario.getAll('plano_id')
  if (!ordenId.success || !lider.success || ids.length > 100 || ids.some((id) => typeof id !== 'string')) {
    return { ok: false, error: 'La orden o la lista de planos no es válida.' }
  }
  const asignaciones = z.array(z.object({
    plano_id: z.string().uuid(),
    usuario_id: z.union([z.string().uuid(), z.literal('')]),
  })).max(100).safeParse(ids.map((id) => ({
    plano_id: String(id),
    usuario_id: formulario.get(`responsable_${String(id)}`),
  })))
  if (!asignaciones.success) return { ok: false, error: 'Revisa los responsables seleccionados para cada plano.' }

  const responsables = Object.fromEntries(asignaciones.data.map((a) => [a.plano_id, a.usuario_id]))
  const supabase = await createClient()
  const { error } = await supabase.rpc('asignar_equipo_diseno', {
    p_orden: ordenId.data,
    p_lider: lider.data,
    p_responsables: responsables,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${ordenId.data}/planos`)
  revalidatePath(`/ordenes/${ordenId.data}`)
  return { ok: true, mensaje: 'Líder y responsables de planos actualizados.' }
}

export async function guardarLiderEntregaPlanos(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) return { ok: false, error: 'Solo Diseño puede indicar quién lidera la entrega de planos.' }
  const analisis = z.object({ orden_id: z.string().uuid(), nombre: z.string().trim().min(2).max(120) })
    .safeParse(Object.fromEntries(formulario))
  if (!analisis.success) return { ok: false, error: 'Escribe el nombre completo del líder (entre 2 y 120 caracteres).' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('guardar_lider_entrega_planos', {
    p_orden: analisis.data.orden_id,
    p_nombre: analisis.data.nombre,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó el nombre. Recarga la página antes de volver a intentar.' }
  revalidatePath(`/ordenes/${analisis.data.orden_id}/planos`)
  return { ok: true, mensaje: `Líder de entrega registrado: ${data}.` }
}

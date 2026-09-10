'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const CLAVE_MINIMA = 10

const esquemaPersona = z.object({
  nombres: z.string().trim().min(2, 'Los nombres son obligatorios'),
  apellidos: z.string().trim().min(2, 'Los apellidos son obligatorios'),
  correo: z.string().trim().toLowerCase().email('El correo no es válido'),
  clave: z.string().min(CLAVE_MINIMA, `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres`),
  rol_id: z.string().uuid('Elige el puesto'),
  sede_id: z.string().uuid('Elige el taller'),
  area_id: z.string().uuid().optional().or(z.literal('')),
  cargo: z.string().trim().optional(),
  documento: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  es_operario: z.coerce.boolean().default(false),
  costo_hora: z.coerce.number().min(0, 'El costo por hora no puede ser negativo').default(0),
})

function nulo(valor: string | undefined) {
  const t = valor?.trim()
  return t ? t : null
}

/** Los parámetros opcionales de una función de base se omiten, no van en nulo. */
function omitible(valor: string | undefined) {
  const t = valor?.trim()
  return t ? t : undefined
}

export async function darDeAltaPersona(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'usuarios.gestionar')) {
    return { ok: false, error: 'No tienes permiso para dar de alta al personal.' }
  }

  const analisis = esquemaPersona.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos de la persona.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase.rpc('crear_personal', {
    p_nombres: v.nombres,
    p_apellidos: v.apellidos,
    p_correo: v.correo,
    p_clave: v.clave,
    p_rol_id: v.rol_id,
    p_sede_id: v.sede_id,
    p_area_id: omitible(v.area_id),
    p_cargo: omitible(v.cargo),
    p_documento: omitible(v.documento),
    p_telefono: omitible(v.telefono),
    p_es_operario: v.es_operario,
    p_costo_hora: v.costo_hora,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/personal')
  return {
    ok: true,
    mensaje: `${v.nombres} ${v.apellidos} ya puede entrar con ${v.correo}. Anota la contraseña: no se vuelve a mostrar.`,
  }
}

const esquemaEdicion = z.object({
  id: z.string().uuid(),
  nombres: z.string().trim().min(2, 'Los nombres son obligatorios'),
  apellidos: z.string().trim().min(2, 'Los apellidos son obligatorios'),
  rol_id: z.string().uuid('Elige el puesto'),
  sede_id: z.string().uuid('Elige el taller'),
  area_id: z.string().uuid().optional().or(z.literal('')),
  cargo: z.string().trim().optional(),
  documento: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  es_operario: z.coerce.boolean().default(false),
  costo_hora: z.coerce.number().min(0).default(0),
})

export async function guardarPersona(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'usuarios.gestionar')) {
    return { ok: false, error: 'No tienes permiso para editar al personal.' }
  }

  const analisis = esquemaEdicion.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos de la persona.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('usuarios')
    .update({
      nombres: v.nombres,
      apellidos: v.apellidos,
      rol_id: v.rol_id,
      sede_id: v.sede_id,
      area_id: nulo(v.area_id),
      cargo: nulo(v.cargo),
      documento: nulo(v.documento),
      telefono: nulo(v.telefono),
      es_operario: v.es_operario,
      costo_hora: v.costo_hora,
    })
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/personal')
  return { ok: true, mensaje: 'Ficha actualizada.' }
}

export async function cambiarClave(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'usuarios.gestionar')) {
    return { ok: false, error: 'No tienes permiso para cambiar contraseñas.' }
  }

  const analisis = z
    .object({
      id: z.string().uuid(),
      clave: z.string().min(CLAVE_MINIMA, `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres`),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la contraseña.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cambiar_clave_personal', {
    p_usuario: analisis.data.id,
    p_clave: analisis.data.clave,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/personal')
  return { ok: true, mensaje: 'Contraseña cambiada. Anótala: no se vuelve a mostrar.' }
}

export async function cambiarEstado(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'usuarios.gestionar')) {
    return { ok: false, error: 'No tienes permiso para dar de baja al personal.' }
  }

  const analisis = z
    .object({ id: z.string().uuid(), activo: z.coerce.boolean() })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cambiar_estado_personal', {
    p_usuario: analisis.data.id,
    p_activo: analisis.data.activo,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/personal')
  return {
    ok: true,
    mensaje: analisis.data.activo ? 'Persona reactivada.' : 'Persona dada de baja.',
  }
}

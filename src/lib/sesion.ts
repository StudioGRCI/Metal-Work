import { cache } from 'react'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export type PerfilSesion = {
  id: string
  nombres: string
  apellidos: string
  correo: string
  cargo: string | null
  activo: boolean
  es_operario: boolean
  sede_id: string | null
  rol: { codigo: string; nombre: string; nivel: number }
  permisos: string[]
}

/**
 * Perfil del usuario autenticado con su rol y permisos.
 * cache() lo resuelve una sola vez por petición aunque lo pidan varios componentes.
 */
export const obtenerSesion = cache(async (): Promise<PerfilSesion | null> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from('usuarios')
    .select(
      'id, nombres, apellidos, correo, cargo, activo, es_operario, sede_id, rol:roles!inner(codigo, nombre, nivel, roles_permisos(permiso_codigo))',
    )
    .eq('id', user.id)
    .maybeSingle()

  if (!data) return null

  const rol = data.rol as unknown as {
    codigo: string
    nombre: string
    nivel: number
    roles_permisos: { permiso_codigo: string }[]
  }

  return {
    id: data.id,
    nombres: data.nombres,
    apellidos: data.apellidos,
    correo: data.correo,
    cargo: data.cargo,
    activo: data.activo,
    es_operario: data.es_operario,
    sede_id: data.sede_id,
    rol: { codigo: rol.codigo, nombre: rol.nombre, nivel: rol.nivel },
    permisos: (rol.roles_permisos ?? []).map((p) => p.permiso_codigo),
  }
})

/** Igual que obtenerSesion, pero corta la petición si no hay sesión válida. */
export async function exigirSesion(): Promise<PerfilSesion> {
  const perfil = await obtenerSesion()

  // El motivo no es solo para el mensaje: el proxy lo usa para no devolver a
  // esta persona a la aplicación. Sin él se forma un bucle -la aplicación manda
  // a ingresar, el proxy ve la sesión de Supabase y manda de vuelta- que deja al
  // usuario dando vueltas sin poder hacer nada, ni siquiera cerrar sesión.
  if (!perfil) redirect('/ingresar?motivo=sin-perfil')
  if (!perfil.activo) redirect('/ingresar?motivo=inactivo')

  return perfil
}

export function puede(perfil: PerfilSesion | null, permiso: string): boolean {
  if (!perfil) return false
  if (perfil.rol.codigo === 'ADMIN') return true
  return perfil.permisos.includes(permiso)
}

/** Corta la petición con 403 si el usuario no tiene el permiso indicado. */
export async function exigirPermiso(permiso: string): Promise<PerfilSesion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, permiso)) redirect('/sin-permiso')
  return perfil
}

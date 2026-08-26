import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type PersonaEnLista = {
  id: string
  codigo: string | null
  nombres: string
  apellidos: string
  correo: string
  cargo: string | null
  telefono: string | null
  documento: string | null
  es_operario: boolean
  costo_hora: number
  activo: boolean
  rol: { id: string; codigo: string; nombre: string } | null
  area: { id: string; codigo: string; nombre: string } | null
  sede: { id: string; nombre: string } | null
}

/** Todo el personal, con su puesto y su área. */
export async function listarPersonal(filtros: { busqueda?: string; estado?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('usuarios')
    .select(
      'id, codigo, nombres, apellidos, correo, cargo, telefono, documento, es_operario, costo_hora, activo,' +
        ' rol:roles!inner(id, codigo, nombre), area:areas(id, codigo, nombre), sede:sedes(id, nombre)',
    )
    .order('apellidos')

  if (filtros.estado === 'activos') consulta = consulta.eq('activo', true)
  if (filtros.estado === 'bajas') consulta = consulta.eq('activo', false)

  const t = filtros.busqueda?.trim()
  if (t) {
    consulta = consulta.or(
      `nombres.ilike.%${t}%,apellidos.ilike.%${t}%,correo.ilike.%${t}%,documento.ilike.%${t}%`,
    )
  }

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo listar el personal: ${error.message}`)

  return (data ?? []) as unknown as PersonaEnLista[]
}

/** Los catálogos que necesita el formulario de alta. */
export async function catalogosDePersonal() {
  const supabase = await createClient()

  const [roles, areas, sedes] = await Promise.all([
    supabase.from('roles').select('id, codigo, nombre').order('nombre'),
    supabase.from('areas').select('id, codigo, nombre').eq('activo', true).order('nombre'),
    supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  const fallo = roles.error ?? areas.error ?? sedes.error
  if (fallo) throw new Error(`No se pudieron cargar los catálogos: ${fallo.message}`)

  return {
    roles: roles.data ?? [],
    areas: areas.data ?? [],
    sedes: sedes.data ?? [],
  }
}

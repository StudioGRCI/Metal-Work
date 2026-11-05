import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'

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
      'id, codigo, nombres, apellidos, correo, cargo, telefono, es_operario, activo,' +
        ' rol:roles!inner(id, codigo, nombre),' +
        ' area:areas!usuarios_area_id_fkey(id, codigo, nombre), sede:sedes(id, nombre)',
    )
    .order('apellidos')

  if (filtros.estado === 'activos') consulta = consulta.eq('activo', true)
  if (filtros.estado === 'bajas') consulta = consulta.eq('activo', false)

  // Un DNI se busca en la tabla reservada, que solo lee quien puede verlo; para
  // los demás no encuentra a nadie, igual que no ven el número.
  const dni = filtros.busqueda?.trim().replace(/\s+/g, '') ?? ''
  if (/^\d{4,}$/.test(dni)) {
    const { data: conDni, error: errorDni } = await supabase
      .from('usuario_datos_reservados')
      .select('usuario_id')
      .ilike('documento', `%${dni}%`)
      .limit(200)
    if (errorDni) throw new Error(`No se pudo buscar por documento: ${errorDni.message}`)
    consulta = consulta.in('id', (conDni ?? []).map((r) => r.usuario_id))
  } else {
    for (const filtro of filtrosDeBusqueda(['nombres', 'apellidos', 'correo'], filtros.busqueda)) consulta = consulta.or(filtro)
  }

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo listar el personal: ${error.message}`)
  const personas = (data ?? []) as unknown as Omit<PersonaEnLista, 'documento'>[]

  // El DNI vive aparte (migración 20261020163000): `usuarios` la lee toda
  // cuenta, y esta tabla solo RR. HH. y quien administra el personal. Para
  // cualquier otro, el RLS la devuelve vacía y la ficha sale sin él. El costo
  // por hora de la cuenta se queda en la tabla, pero ya no se muestra (DKS,
  // 2026-10-26): la mano de obra sale de la ficha y del tareo.
  const reservados = new Map<string, { documento: string | null }>()
  const ids = personas.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 150) {
    const { data: tanda, error: errorReservados } = await supabase
      .from('usuario_datos_reservados')
      .select('usuario_id, documento')
      .in('usuario_id', ids.slice(i, i + 150))
    if (errorReservados) throw new Error(`No se pudo leer el DNI del personal: ${errorReservados.message}`)
    for (const r of tanda ?? []) reservados.set(r.usuario_id, { documento: r.documento })
  }

  return personas.map((p) => ({ ...p, documento: null, ...reservados.get(p.id) }))
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
    // Puestos que ya no existen en la planta: no se ofrecen en la ficha de Personal.
    roles: (roles.data ?? []).filter(
      (r) => !['JEFE_PRODUCCION', 'JEFE_TALLER', 'SUPERVISOR_GENERAL'].includes(r.codigo),
    ),
    areas: areas.data ?? [],
    sedes: sedes.data ?? [],
  }
}

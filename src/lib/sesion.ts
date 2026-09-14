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
  /** Su área del taller. La hoja de avance le propone la suya al armar la lista. */
  area_id: string | null
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
      'id, nombres, apellidos, correo, cargo, activo, es_operario, sede_id, area_id, rol:roles!inner(codigo, nombre, nivel, roles_permisos(permiso_codigo))',
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
    area_id: data.area_id,
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

/**
 * Si el usuario tiene el permiso. Cuando se pasan varios basta con uno: hay
 * pantallas que miran distintas áreas —la orden de servicio la emite logística,
 * la acepta calidad y la mira costos— y a todas les sirve la misma lista.
 */
export function puede(perfil: PerfilSesion | null, permiso: string | string[]): boolean {
  if (!perfil) return false
  if (perfil.rol.codigo === 'ADMIN') return true
  const pedidos = Array.isArray(permiso) ? permiso : [permiso]
  return pedidos.some((p) => perfil.permisos.includes(p))
}

/**
 * Si esta persona puede meterse en la hoja de un área: la suya siempre, las
 * demás solo con `produccion.cualquier_area` —el jefe de producción, el de
 * taller y Gerencia—.
 *
 * Es el gemelo exacto de `public.puede_hoja_de_area(uuid)` en la base, y tiene
 * que seguir siéndolo: si la pantalla dejara pasar lo que la política rechaza,
 * el INSERT afectaría cero filas sin error y la pantalla diría «listo» sin
 * haber hecho nada. Acá se comprueba para dar un mensaje que se entienda; quien
 * manda es el RLS.
 */
export function puedeHojaDeArea(perfil: PerfilSesion | null, areaId: string | null): boolean {
  if (!perfil) return false
  if (puede(perfil, 'produccion.cualquier_area')) return true
  return areaId !== null && perfil.area_id === areaId
}

/** Los tres reportes del día: la hoja por área, el avance con foto y el trabajo sin orden. */
export type ClaseReporte = 'hoja' | 'orden' | 'flota'

function diaAnterior(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Si esta persona ve «Corregir» en un reporte del día. Gemelo de las políticas
 * de UPDATE de las tres tablas y del disparador de la migración 097:
 *
 *   · Aprobado queda firme.
 *   · La hoja por área la corrige quien reporta en esa área.
 *   · El avance con foto y el trabajo sin orden, su autor: hasta el día
 *     siguiente, o cuando el jefe se lo observó, aunque sea de hace días.
 *
 * Y una regla que es solo de la pantalla: el jefe no reescribe lo ajeno, lo
 * observa. La base lo dejaría, pero un «Corregir» al lado de «Aprobar» en cada
 * reporte del taller es una tentación que borra lo que el supervisor escribió.
 */
export function puedeCorregirReporte(
  perfil: PerfilSesion | null,
  r: { clase: ClaseReporte; revision: string | null; autor: string | null; fecha: string; areaId?: string | null },
  hoy: string,
): boolean {
  if (!perfil) return false
  const aprueba = puede(perfil, 'produccion.aprobar_reportes')
  const esAutor = r.autor === perfil.id
  if (r.revision === 'APROBADO' && !aprueba) return false
  if (aprueba && !esAutor) return false

  if (r.clase === 'hoja') {
    return puede(perfil, 'produccion.registrar') && puedeHojaDeArea(perfil, r.areaId ?? null)
  }
  const aTiempo = r.fecha >= diaAnterior(hoy) || r.revision === 'OBSERVADO'
  if (r.clase === 'flota') return esAutor && aTiempo && puedeHojaDeArea(perfil, r.areaId ?? null)
  return esAutor && aTiempo
}

/**
 * Si esta persona ve «Eliminar» en un reporte del día. Gemelo de las políticas
 * de DELETE de la migración 099: el jefe borra cualquiera; el autor, mientras
 * no esté aprobado. El avance con foto que movió una etapa no se borra —lo
 * impide un disparador—, así que ni se ofrece.
 */
export function puedeEliminarReporte(
  perfil: PerfilSesion | null,
  r: { revision: string | null; autor: string | null; movioEtapa?: boolean },
): boolean {
  if (!perfil || r.movioEtapa) return false
  if (puede(perfil, 'produccion.aprobar_reportes')) return true
  return r.autor === perfil.id && r.revision !== 'APROBADO'
}

/**
 * Si esta persona ve «Quitar» en una cotización en PDF. Gemelo de la política
 * de DELETE y del disparador de la migración 102: la quita quien la subió o
 * Gerencia, mientras esté por revisar o rechazada, y nunca si de ella salió una
 * orden —aunque se haya anulado—, que es su rastro.
 */
export function puedeQuitarCotizacion(
  perfil: PerfilSesion | null,
  c: { estado: string | null; registrado_por: string | null; tuvo_orden: boolean | null },
): boolean {
  if (!perfil || c.tuvo_orden !== false) return false
  if (c.estado !== 'POR_REVISAR' && c.estado !== 'RECHAZADA') return false
  return c.registrado_por === perfil.id || puede(perfil, 'cotizaciones.revisar')
}

/**
 * Si esta persona ve «Subir corrección» en una cotización. Gemelo de la
 * política de UPDATE y del disparador de la migración 103: la rechazada la
 * corrige quien la subió. Gerencia no reescribe el papel del vendedor.
 */
export function puedeCorregirCotizacion(
  perfil: PerfilSesion | null,
  c: { estado: string | null; registrado_por: string | null },
): boolean {
  if (!perfil || c.estado !== 'RECHAZADA') return false
  return c.registrado_por === perfil.id || perfil.rol.codigo === 'ADMIN'
}

/** Las áreas cuya hoja puede escribir: la suya, o todas si tiene el permiso. */
export function areasDeSuMano<T extends { id: string }>(
  perfil: PerfilSesion | null,
  areas: T[],
): T[] {
  if (!perfil) return []
  if (puede(perfil, 'produccion.cualquier_area')) return areas
  return areas.filter((a) => a.id === perfil.area_id)
}

/**
 * Si esta persona puede armar la lista de actividades de un área. Gemelo de
 * `public.puede_armar_hoja_de_area` (migración 106): Diseño desglosa la unidad y
 * arma la de cualquier área; el jefe y el supervisor, la de su mano.
 */
export function puedeArmarHoja(perfil: PerfilSesion | null, areaId: string | null): boolean {
  if (!perfil) return false
  if (puede(perfil, 'diseno.planos')) return true
  return puede(perfil, 'produccion.actividades') && puedeHojaDeArea(perfil, areaId)
}

/** Las áreas cuya lista de actividades puede armar. */
export function areasParaArmar<T extends { id: string }>(perfil: PerfilSesion | null, areas: T[]): T[] {
  if (!perfil) return []
  if (puede(perfil, 'diseno.planos')) return areas
  if (!puede(perfil, 'produccion.actividades')) return []
  return areasDeSuMano(perfil, areas)
}

/**
 * Si esta persona ve «Resolver» en una observación de la orden. Gemelo de
 * `resolver_observacion_ot` (migración 106): el área a la que va, quien la
 * anotó o el jefe de producción, y solo mientras esté abierta.
 */
export function puedeResolverObservacion(
  perfil: PerfilSesion | null,
  o: { abierta: boolean; registrado_por: string; area_id: string },
): boolean {
  if (!perfil || !o.abierta) return false
  if (puede(perfil, 'produccion.aprobar_reportes')) return true
  return o.registrado_por === perfil.id || (perfil.area_id !== null && perfil.area_id === o.area_id)
}

/** Corta la petición con 403 si el usuario no tiene el permiso indicado. */
export async function exigirPermiso(permiso: string | string[]): Promise<PerfilSesion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, permiso)) redirect('/sin-permiso')
  return perfil
}

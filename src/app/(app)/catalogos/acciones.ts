'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const entrada = z.object({
  tipo: z.enum(['cliente', 'unidad', 'carroceria']),
  id: z.string().uuid(),
  activo: z.enum(['true', 'false']).transform((v) => v === 'true'),
})

function rutas(tipo: 'cliente' | 'unidad' | 'carroceria') {
  return tipo === 'cliente' ? ['/clientes'] : tipo === 'unidad' ? ['/unidades', '/clientes'] : ['/carrocerias', '/cotizaciones/pdf']
}

export async function cambiarEstadoCatalogo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = entrada.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar el registro.' }
  const { tipo, id, activo } = analisis.data
  // El mismo permiso que acepta la política de cada tabla: carrocerías,
  // Diseño (o Ventas por su función); unidades, Ventas o Diseño; clientes, Ventas.
  const permiso = tipo === 'carroceria'
    ? puede(perfil, ['diseno.carrocerias', 'cotizaciones.crear'])
    : tipo === 'unidad'
      ? puede(perfil, ['clientes.editar', 'diseno.unidades'])
      : puede(perfil, 'clientes.editar')
  if (!permiso) return { ok: false, error: 'Tu perfil no puede cambiar el estado de este registro.' }

  const supabase = await createClient()
  if (tipo === 'carroceria' && !puede(perfil, 'diseno.carrocerias')) {
    const { data: actual, error: lectura } = await supabase.from('tipos_carroceria').select('nombre, descripcion').eq('id', id).maybeSingle()
    if (lectura) return { ok: false, error: mensajeDeError(lectura) }
    if (!actual) return { ok: false, error: NO_TOCO_NADA }
    const { data, error } = await supabase.rpc('editar_carroceria_ventas', {
      p_id: id,
      p_nombre: actual.nombre,
      p_descripcion: actual.descripcion ?? '',
      p_activo: activo,
    })
    if (error) return { ok: false, error: mensajeDeError(error) }
    if (!data) return { ok: false, error: NO_TOCO_NADA }
  } else {
    const tabla = tipo === 'cliente' ? 'clientes' : tipo === 'unidad' ? 'unidades' : 'tipos_carroceria'
    const { data, error } = await supabase.from(tabla).update({ activo }).eq('id', id).select('id').maybeSingle()
    if (error) return { ok: false, error: mensajeDeError(error) }
    if (!data) return { ok: false, error: NO_TOCO_NADA }
  }

  for (const ruta of rutas(tipo)) revalidatePath(ruta)
  return { ok: true, mensaje: activo ? 'Registro reactivado.' : 'Registro desactivado; su historial se conserva.' }
}

export async function eliminarCatalogo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (perfil.rol.codigo !== 'ADMIN') return { ok: false, error: 'Solo Administración puede eliminar físicamente un registro.' }
  const analisis = z.object({ tipo: z.enum(['cliente', 'unidad', 'carroceria']), id: z.string().uuid() }).safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar el registro.' }
  const { tipo, id } = analisis.data
  const tabla = tipo === 'cliente' ? 'clientes' : tipo === 'unidad' ? 'unidades' : 'tipos_carroceria'
  const supabase = await createClient()
  const { data, error } = await supabase.from(tabla).delete().eq('id', id).select('id').maybeSingle()
  if (error) {
    if (error.code === '23503') return { ok: false, error: 'Este registro tiene historial o elementos relacionados. Desactívalo para conservar toda la información.' }
    return { ok: false, error: mensajeDeError(error) }
  }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  for (const ruta of rutas(tipo)) revalidatePath(ruta)
  return { ok: true, mensaje: 'Registro eliminado.' }
}

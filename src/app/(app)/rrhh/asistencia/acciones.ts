'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { editaComoRrhh, exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/** El portero marca el ingreso o la salida de una persona. Mismo permiso que `marcar_asistencia`. */
export async function marcarAsistencia(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'asistencia.marcar')) return { ok: false, error: 'La asistencia la marca la portería.' }

  const analisis = z
    .object({
      marca_id: z.guid(),
      trabajador_id: z.guid(),
      tipo: z.enum(['INGRESO', 'SALIDA']),
      observacion: z.string().max(300, 'La observación pasa de 300 caracteres.'),
    })
    .safeParse({
      marca_id: dato(formulario, 'marca_id'),
      trabajador_id: dato(formulario, 'trabajador_id'),
      tipo: dato(formulario, 'tipo'),
      observacion: dato(formulario, 'observacion'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('marcar_asistencia', {
    p_id: d.marca_id,
    p_trabajador_id: d.trabajador_id,
    p_tipo: d.tipo,
    p_observacion: d.observacion || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.marca_id) return { ok: false, error: 'La marca no quedó registrada. Recarga la pantalla.' }

  revalidatePath('/rrhh/asistencia')
  revalidatePath('/rrhh/tardanzas')
  return { ok: true, mensaje: d.tipo === 'INGRESO' ? 'Ingreso marcado.' : 'Salida marcada.' }
}

/**
 * Una marca equivocada se anula con motivo. Mismo permiso que `anular_asistencia`:
 * RR. HH., cualquier día; la portería, las de hoy (la base mira el día).
 */
export async function anularAsistencia(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.personal') && !editaComoRrhh(perfil, 'asistencia.marcar'))
    return { ok: false, error: 'Las marcas las anula Recursos Humanos; la portería, solo las de hoy.' }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_asistencia', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La marca no se anuló. Recarga la pantalla.' }

  revalidatePath('/rrhh/asistencia')
  revalidatePath('/rrhh/tardanzas')
  return { ok: true, mensaje: 'Marca anulada. Queda con su motivo.' }
}

/**
 * La portería escribe los 8 dígitos del DNI y la base le dice quién es, sin
 * que el número de nadie llegue al celular (migración 20261020165000). Mismo
 * permiso que `asistencia_buscar_por_dni`.
 */
export async function buscarPorDni(dni: string): Promise<{ id: string | null; error?: string }> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['asistencia.marcar', 'rrhh.personal'])) return { id: null, error: 'Busca por nombre o apellido.' }
  const limpio = dni.replace(/\s/g, '')
  if (!/^\d{8}$/.test(limpio)) return { id: null, error: 'Escribe los 8 dígitos del DNI.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('asistencia_buscar_por_dni', { p_dni: limpio })
  if (error) return { id: null, error: mensajeDeError(error) }
  return { id: data ?? null }
}

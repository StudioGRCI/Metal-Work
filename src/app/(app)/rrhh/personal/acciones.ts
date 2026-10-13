'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { TIPOS_CUENTA } from '@/lib/dominio/rrhh'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const SIN_PERMISO = 'La ficha del personal la lleva Recursos Humanos.'
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/** Registra o corrige la ficha de una persona. Mismo permiso que `rrhh_guardar_trabajador`. */
export async function guardarTrabajador(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.string().uuid(),
      nombres: z.string().min(2, 'Escribe los nombres.').max(80, 'Los nombres pasan de 80 caracteres.'),
      apellidos: z.string().min(2, 'Escribe los apellidos.').max(80, 'Los apellidos pasan de 80 caracteres.'),
      dni: z.string().regex(/^\d{8}$/, 'El DNI lleva 8 dígitos.'),
      cargo: z.string().max(80, 'El cargo pasa de 80 caracteres.'),
      area_id: z.union([z.literal(''), z.string().uuid()]),
      hora_entrada: z.string().regex(HORA, 'Elige la hora de entrada.'),
      hora_salida: z.string().regex(HORA, 'Elige la hora de salida.'),
      banco: z.string().min(2, 'Escribe el banco.').max(60, 'El banco pasa de 60 caracteres.'),
      tipo_cuenta: z.enum(TIPOS_CUENTA, { message: 'Elige el tipo de cuenta.' }),
      numero_cuenta: z.string().regex(/^[0-9-]{6,30}$/, 'El número de cuenta lleva solo dígitos y guiones (de 6 a 30).'),
      cci: z.union([z.literal(''), z.string().regex(/^\d{20}$/, 'El CCI lleva 20 dígitos.')]),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      nombres: dato(formulario, 'nombres'),
      apellidos: dato(formulario, 'apellidos'),
      dni: dato(formulario, 'dni').replace(/\s/g, ''),
      cargo: dato(formulario, 'cargo'),
      area_id: dato(formulario, 'area_id'),
      hora_entrada: dato(formulario, 'hora_entrada'),
      hora_salida: dato(formulario, 'hora_salida'),
      banco: dato(formulario, 'banco'),
      tipo_cuenta: dato(formulario, 'tipo_cuenta'),
      numero_cuenta: dato(formulario, 'numero_cuenta').replace(/\s/g, ''),
      cci: dato(formulario, 'cci').replace(/\s/g, ''),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la ficha.' }
  const d = analisis.data
  if (d.hora_salida <= d.hora_entrada) return { ok: false, error: 'La hora de salida tiene que ser posterior a la de entrada.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_guardar_trabajador', {
    p_id: d.id,
    p_nombres: d.nombres,
    p_apellidos: d.apellidos,
    p_dni: d.dni,
    p_cargo: d.cargo || null,
    p_area_id: d.area_id || null,
    p_hora_entrada: d.hora_entrada,
    p_hora_salida: d.hora_salida,
    p_banco: d.banco,
    p_tipo_cuenta: d.tipo_cuenta,
    p_numero_cuenta: d.numero_cuenta,
    p_cci: d.cci || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La ficha no quedó guardada. Recarga la pantalla.' }

  revalidatePath('/rrhh/personal')
  revalidatePath('/rrhh/asistencia')
  return { ok: true, mensaje: `${d.nombres} ${d.apellidos} queda en el personal.` }
}

/** Da de baja o vuelve a dar de alta. Mismo permiso que `rrhh_cambiar_estado_trabajador`. */
export async function cambiarEstadoTrabajador(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({ id: z.string().uuid(), activo: z.enum(['si', 'no']) })
    .safeParse({ id: dato(formulario, 'id'), activo: dato(formulario, 'activo') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }
  const activo = analisis.data.activo === 'si'

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_cambiar_estado_trabajador', { p_id: analisis.data.id, p_activo: activo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se pudo cambiar el estado. Recarga la pantalla.' }

  revalidatePath('/rrhh/personal')
  revalidatePath('/rrhh/asistencia')
  return { ok: true, mensaje: activo ? 'Vuelve a estar de alta.' : 'Queda de baja: el portero ya no le marca.' }
}

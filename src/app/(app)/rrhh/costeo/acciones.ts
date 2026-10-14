'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { horasCortas } from '@/lib/dominio/rrhh'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const SIN_PERMISO = 'El tareo lo lleva Recursos Humanos.'

/** Carga las horas de una persona a un código interno. Mismo permiso que `rrhh_registrar_tareo`. */
export async function registrarTareo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      trabajador_id: z.guid({ message: 'Elige a la persona.' }),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige el día trabajado.'),
      codigo_interno: z.string().min(2, 'Escribe el código interno.').max(60, 'El código interno pasa de 60 caracteres.'),
      horas: z.coerce.number('Escribe las horas.').positive('Las horas van de 0,25 a 16.').max(16, 'Las horas van de 0,25 a 16.'),
      labor: z.string().max(200, 'La labor pasa de 200 caracteres.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      trabajador_id: dato(formulario, 'trabajador_id'),
      fecha: dato(formulario, 'fecha'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      horas: dato(formulario, 'horas').replace(',', '.'),
      labor: dato(formulario, 'labor'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa las horas.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_registrar_tareo', {
    p_id: d.id,
    p_trabajador_id: d.trabajador_id,
    p_fecha: d.fecha,
    p_codigo_interno: d.codigo_interno,
    p_horas: d.horas,
    p_labor: d.labor || undefined,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'Las horas no quedaron cargadas. Recarga la pantalla.' }

  revalidatePath('/rrhh/costeo')
  return { ok: true, mensaje: `${horasCortas(d.horas)} cargadas a ${d.codigo_interno.toUpperCase()}.` }
}

/** Unas horas mal cargadas se anulan con motivo. Mismo permiso que `rrhh_anular_tareo`. */
export async function anularTareo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_anular_tareo', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'Las horas no se anularon. Recarga la pantalla.' }

  revalidatePath('/rrhh/costeo')
  return { ok: true, mensaje: 'Horas anuladas. Quedan con su motivo.' }
}

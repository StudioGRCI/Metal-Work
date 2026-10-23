'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { MOTIVOS_OBSERVACION, TIPOS_OBSERVACION, TIPO_OBSERVACION } from '@/lib/dominio/rrhh'
import { editaComoRrhh, exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const SIN_PERMISO = 'No tienes permiso para registrar ni anular observaciones o amonestaciones.'

/** Registra una observación, amonestación o suspensión. Mismo permiso que `rrhh_registrar_observacion`. */
export async function registrarObservacion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      trabajador_id: z.guid({ message: 'Elige a la persona.' }),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige el día en que pasó.'),
      tipo: z.enum(TIPOS_OBSERVACION, { message: 'Elige si es observación, amonestación o suspensión.' }),
      motivo: z.enum(MOTIVOS_OBSERVACION, { message: 'Elige el motivo.' }),
      detalle: z.string().min(10, 'Cuenta qué pasó, en al menos 10 caracteres.').max(1000, 'El detalle pasa de 1000 caracteres.'),
      codigo_interno: z.union([z.literal(''), z.string().min(2, 'El código interno va de 2 a 60 caracteres.').max(60, 'El código interno va de 2 a 60 caracteres.')]),
      dias_suspension: z.union([z.literal(''), z.coerce.number().int('Los días van enteros.').min(1, 'Una suspensión va de 1 a 30 días.').max(30, 'Una suspensión va de 1 a 30 días.')]),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      trabajador_id: dato(formulario, 'trabajador_id'),
      fecha: dato(formulario, 'fecha'),
      tipo: dato(formulario, 'tipo'),
      motivo: dato(formulario, 'motivo'),
      detalle: dato(formulario, 'detalle'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      dias_suspension: dato(formulario, 'dias_suspension'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la observación.' }
  const d = analisis.data
  if (d.tipo === 'SUSPENSION' && d.dias_suspension === '') return { ok: false, error: 'Una suspensión lleva sus días: de 1 a 30.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_registrar_observacion', {
    p_id: d.id,
    p_trabajador_id: d.trabajador_id,
    p_fecha: d.fecha,
    p_tipo: d.tipo,
    p_motivo: d.motivo,
    p_detalle: d.detalle,
    p_codigo_interno: d.codigo_interno || undefined,
    p_dias_suspension: d.tipo === 'SUSPENSION' && d.dias_suspension !== '' ? d.dias_suspension : undefined,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'No quedó registrada. Recarga la pantalla.' }

  revalidatePath('/rrhh/observaciones')
  return { ok: true, mensaje: `${TIPO_OBSERVACION[d.tipo]?.etiqueta ?? 'Observación'} registrada.` }
}

/** Una observación equivocada se anula con motivo. Mismo permiso que `rrhh_anular_observacion`. */
export async function anularObservacion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_anular_observacion', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se anuló. Recarga la pantalla.' }

  revalidatePath('/rrhh/observaciones')
  return { ok: true, mensaje: 'Anulada. Queda con su motivo.' }
}

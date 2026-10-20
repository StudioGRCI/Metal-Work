'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { editaComoRrhh, exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const SIN_PERMISO = 'Las horas extras las decide Recursos Humanos.'
const MOTIVO = z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.')

function repintar() {
  revalidatePath('/rrhh/horas-extras')
  revalidatePath('/planilla-diaria')
}

/**
 * RR. HH. decide las horas extras de una persona en un día: se pagan (entran a
 * la próxima planilla diaria con su recargo) o se reservan (pasan a su saldo).
 * Mismo permiso que `rrhh_decidir_horas_extras` (`planilla_diaria.preparar`).
 */
export async function decidirHorasExtras(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'planilla_diaria.preparar')) return { ok: false, error: SIN_PERMISO }
  const analisis = z
    .object({ id: z.guid(), trabajador_id: z.guid(), fecha: z.iso.date(), decision: z.enum(['PAGAR', 'RESERVAR']) })
    .safeParse({
      id: dato(formulario, 'id'),
      trabajador_id: dato(formulario, 'trabajador_id'),
      fecha: dato(formulario, 'fecha'),
      decision: dato(formulario, 'decision'),
    })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_decidir_horas_extras', {
    p_id: d.id,
    p_trabajador_id: d.trabajador_id,
    p_fecha: d.fecha,
    p_decision: d.decision,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'No quedó decidido. Recarga la pantalla.' }

  repintar()
  return {
    ok: true,
    mensaje: d.decision === 'PAGAR' ? 'Se pagan: entran a la próxima planilla diaria.' : 'Reservadas: pasan a su saldo de horas.',
  }
}

/** Anular una decisión equivocada: las horas vuelven a esperar. Mismo permiso que `rrhh_anular_decision_horas_extras`. */
export async function anularDecisionHorasExtras(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'planilla_diaria.preparar')) return { ok: false, error: SIN_PERMISO }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_anular_decision_horas_extras', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se anuló. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Anulada: esas horas vuelven a esperar tu decisión.' }
}

/** Usar horas del saldo en otra ocasión (un permiso, un descanso). Mismo permiso que `rrhh_usar_saldo_horas`. */
export async function usarSaldoHoras(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'planilla_diaria.preparar')) return { ok: false, error: SIN_PERMISO }
  const analisis = z
    .object({
      id: z.guid(),
      trabajador_id: z.guid('Elige a la persona.'),
      fecha: z.iso.date('Elige el día en que usa las horas.'),
      horas: z.coerce.number('Escribe las horas que usa.').min(0.25, 'Las horas van de 0,25 a 8.').max(8, 'Las horas van de 0,25 a 8.'),
      motivo: z.string().min(10, 'Cuenta para qué usa las horas, en al menos 10 caracteres.').max(300, 'El motivo pasa de 300 caracteres.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      trabajador_id: dato(formulario, 'trabajador_id'),
      fecha: dato(formulario, 'fecha'),
      horas: dato(formulario, 'horas').replace(',', '.'),
      motivo: dato(formulario, 'motivo'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el formulario.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_usar_saldo_horas', {
    p_id: d.id,
    p_trabajador_id: d.trabajador_id,
    p_fecha: d.fecha,
    p_horas: d.horas,
    p_motivo: d.motivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'No quedó registrado. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Horas descontadas de su saldo.' }
}

/** Anular un uso del saldo: las horas vuelven al saldo. Mismo permiso que `rrhh_anular_uso_saldo`. */
export async function anularUsoSaldo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'planilla_diaria.preparar')) return { ok: false, error: SIN_PERMISO }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_anular_uso_saldo', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se anuló. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Anulado: las horas vuelven a su saldo.' }
}

/** RR. HH. ajusta la regla de las horas extras, sin bajar de la ley. Mismo permiso que `rrhh_guardar_regla_horas_extras`. */
export async function guardarReglaHorasExtras(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'planilla_diaria.preparar')) return { ok: false, error: 'La regla de las horas extras la ajusta Recursos Humanos.' }
  const analisis = z
    .object({
      horas_tramo1: z.coerce.number().min(0, 'Las horas con el primer recargo van de 0 a 2.').max(2, 'Las horas con el primer recargo van de 0 a 2: la ley paga las siguientes con el segundo.'),
      recargo_tramo1: z.coerce.number().min(25, 'La ley no deja pagar menos de 25 % en el primer recargo.').max(200, 'El recargo va hasta 200 %.'),
      recargo_tramo2: z.coerce.number().min(35, 'La ley no deja pagar menos de 35 % en el segundo recargo.').max(200, 'El recargo va hasta 200 %.'),
    })
    .safeParse({
      horas_tramo1: dato(formulario, 'horas_tramo1').replace(',', '.'),
      recargo_tramo1: dato(formulario, 'recargo_tramo1').replace(',', '.'),
      recargo_tramo2: dato(formulario, 'recargo_tramo2').replace(',', '.'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la regla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('rrhh_guardar_regla_horas_extras', {
    p_horas_tramo1: analisis.data.horas_tramo1,
    p_recargo_tramo1: analisis.data.recargo_tramo1,
    p_recargo_tramo2: analisis.data.recargo_tramo2,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  repintar()
  return { ok: true, mensaje: 'Regla guardada. Vale para lo que decidas y envíes desde ahora; lo ya enviado no cambia.' }
}

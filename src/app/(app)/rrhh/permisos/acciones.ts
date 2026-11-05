'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { TIPOS_REPORTE_PERMISO } from '@/lib/dominio/rrhh'
import { editaComoRrhh, exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const SIN_PERMISO = 'No tienes permiso para gestionar los permisos del personal.'

/**
 * El saldo de horas extras cambia con cada justificación, y lo descontado entra
 * al próximo pago: se repintan las pantallas que lo muestran.
 */
function repintar() {
  revalidatePath('/rrhh/permisos')
  revalidatePath('/rrhh/horas-extras')
  revalidatePath('/rrhh/observaciones')
  revalidatePath('/rrhh/pagos-oficina')
  revalidatePath('/planilla-diaria')
}

/** RR. HH. registra el permiso que pidió una persona. Mismo permiso que `rrhh_registrar_permiso` (`rrhh.permisos`). */
export async function registrarPermiso(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.permisos')) return { ok: false, error: SIN_PERMISO }
  const analisis = z
    .object({
      id: z.guid(),
      trabajador_id: z.guid('Elige a la persona.'),
      fecha: z.iso.date('Elige el día del permiso.'),
      horas: z.coerce.number('Escribe cuántas horas pidió.').min(0.25, 'Las horas van de 0,25 a 8 por día.').max(8, 'Las horas van de 0,25 a 8 por día: un permiso de varios días se registra día por día.'),
      motivo: z.string().min(10, 'Cuenta para qué pidió el permiso, en al menos 10 caracteres.').max(300, 'El motivo pasa de 300 caracteres.'),
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
  const { data, error } = await supabase.rpc('rrhh_registrar_permiso', {
    p_id: d.id,
    p_trabajador_id: d.trabajador_id,
    p_fecha: d.fecha,
    p_horas: d.horas,
    p_motivo: d.motivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El permiso no quedó registrado. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Permiso registrado. Queda por justificar con sus horas extras.' }
}

/**
 * Justificar un permiso con las horas extras reservadas de la persona: el
 * canje. Sin horas, usa todo lo que su saldo alcanza a cubrir. Mismo permiso
 * que `rrhh_justificar_permiso`.
 */
export async function justificarPermiso(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.permisos')) return { ok: false, error: SIN_PERMISO }
  const analisis = z
    .object({
      id: z.guid(),
      permiso_id: z.guid(),
      horas: z.coerce.number('Escribe cuántas horas se justifican.').min(0.25, 'Se justifica desde 0,25 h.').max(8, 'Un permiso no pasa de 8 h.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      permiso_id: dato(formulario, 'permiso_id'),
      horas: dato(formulario, 'horas').replace(',', '.'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_justificar_permiso', { p_id: d.id, p_permiso_id: d.permiso_id, p_horas: d.horas })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'No quedó justificado. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Justificado con sus horas extras: salen de su saldo.' }
}

/**
 * Descontar lo que falta justificar de un permiso que ya pasó: en taller esas
 * horas no se pagan, en la oficina se restan de su próximo pago. Mismo permiso
 * que `rrhh_descontar_permiso` (`rrhh.permisos`).
 */
export async function descontarPermiso(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.permisos')) return { ok: false, error: SIN_PERMISO }
  const analisis = z.object({ id: z.guid(), permiso_id: z.guid() }).safeParse({ id: dato(formulario, 'id'), permiso_id: dato(formulario, 'permiso_id') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_descontar_permiso', { p_id: d.id, p_permiso_id: d.permiso_id })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'No quedó descontado. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Descontado: se resta en su próximo pago.' }
}

/**
 * Reportar un permiso que no se justificó: queda en las observaciones de la
 * persona con el motivo «Permiso sin justificar». Mismo permiso que
 * `rrhh_reportar_permiso` (`rrhh.permisos`).
 */
export async function reportarPermiso(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.permisos')) return { ok: false, error: SIN_PERMISO }
  const analisis = z
    .object({
      id: z.guid(),
      permiso_id: z.guid(),
      tipo: z.enum(TIPOS_REPORTE_PERMISO, 'Elige si queda como observación o como amonestación.'),
      nota: z.string().max(500, 'La nota pasa de 500 caracteres.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      permiso_id: dato(formulario, 'permiso_id'),
      tipo: dato(formulario, 'tipo'),
      nota: dato(formulario, 'nota'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_reportar_permiso', {
    p_id: d.id,
    p_permiso_id: d.permiso_id,
    p_tipo: d.tipo,
    p_nota: d.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'No quedó reportado. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Reportado: queda en sus observaciones.' }
}

/** Anular un permiso con su motivo: lo justificado vuelve al saldo. Mismo permiso que `rrhh_anular_permiso`. */
export async function anularPermiso(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.permisos')) return { ok: false, error: SIN_PERMISO }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_anular_permiso', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se anuló. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Permiso anulado. Lo justificado volvió a su saldo de horas y, si ya se restó algo por él, se devuelve en su próximo pago.' }
}

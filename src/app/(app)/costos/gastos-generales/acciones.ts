'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

const SOLO_ADMINISTRACION = 'Los gastos del local y de operación los registra Administración.'

/**
 * Un gasto del mes que no es de una OT —luz, agua, internet, depreciación— y
 * cómo se reparte entre las OT trabajadas ese mes. `registrar_gasto_general`
 * exige `costos.gastos_generales`, el mismo permiso que se pide aquí.
 */
export async function registrarGastoGeneral(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.gastos_generales')) return { ok: false, error: SOLO_ADMINISTRACION }

  const reparto = dato(formulario, 'reparto')
  const v = z.object({
    operacion_id: z.string().uuid(),
    mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    concepto: z.string().regex(/^[A-Z_]{2,40}$/),
    descripcion: z.string().trim().min(3).max(300),
    monto: z.coerce.number().positive().max(9999999999).multipleOf(0.01),
    moneda: z.enum(['PEN', 'USD']),
    reparto: z.enum(['TASA', 'PARTES_IGUALES']),
    tasa: z.coerce.number().positive().max(100).multipleOf(0.001).nullable(),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    mes: dato(formulario, 'mes'),
    concepto: dato(formulario, 'concepto'),
    descripcion: dato(formulario, 'descripcion'),
    monto: dato(formulario, 'monto'),
    moneda: dato(formulario, 'moneda'),
    reparto,
    tasa: reparto === 'TASA' ? dato(formulario, 'tasa') : null,
  })
  if (!v.success) {
    return { ok: false, error: 'Revisa mes, concepto, detalle (3 a 300 caracteres), importe y cómo se reparte (tasa de 0 a 100 %, o partes iguales).' }
  }

  const db = await createClient()
  const { data, error } = await db.rpc('registrar_gasto_general', {
    p_id: v.data.operacion_id,
    p_periodo: `${v.data.mes}-01`,
    p_concepto: v.data.concepto,
    p_descripcion: v.data.descripcion,
    p_monto: v.data.monto,
    p_moneda: v.data.moneda,
    p_reparto: v.data.reparto,
    // Con partes iguales la base exige la tasa nula.
    p_tasa: v.data.tasa,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.operacion_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/costos/gastos-generales')
  return { ok: true, mensaje: 'Gasto registrado. Llega al costeo de cada OT trabajada ese mes cuando RR.HH. cierra su planilla.' }
}

/** Anular, nunca borrar: el gasto queda a la vista con el motivo, quién y cuándo. */
export async function anularGastoGeneral(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.gastos_generales')) return { ok: false, error: SOLO_ADMINISTRACION }

  const v = z.object({
    id: z.string().uuid(),
    motivo: z.string().trim().min(5).max(300),
  }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!v.success) return { ok: false, error: 'Escribe el motivo de la anulación (de 5 a 300 caracteres).' }

  const db = await createClient()
  const { data, error } = await db.rpc('anular_gasto_general', { p_id: v.data.id, p_motivo: v.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/costos/gastos-generales')
  return { ok: true, mensaje: 'Gasto anulado. Deja de sumar en el costeo de las OT.' }
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * Tesorería paga los recibos por honorarios que sube Administración
 * (migración 20261015221000). Las dos exigen `subcontratos.pagar`, el mismo
 * permiso que piden las funciones de la base.
 */

const NO_PAGA = 'Los recibos por honorarios los paga Tesorería.'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

function repintar(subcontratoId: string) {
  revalidatePath('/tesoreria/recibos-por-honorarios')
  revalidatePath('/subcontratos')
  revalidatePath(`/subcontratos/${subcontratoId}`)
}

/**
 * Registrar el pago del neto de un recibo con su voucher, ya subido a Storage:
 * a Administración le llega el aviso. Mismo permiso que
 * `registrar_pago_recibo_honorarios`. El id llega de la pantalla: un reintento
 * no registra otro.
 */
export async function registrarPagoRecibo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'subcontratos.pagar')) return { ok: false, error: NO_PAGA }
  const analisis = z
    .object({
      id: z.guid(),
      recibo_id: z.guid(),
      subcontrato_id: z.guid(),
      fecha_pago: z.iso.date('Elige el día del pago.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el voucher.').max(200),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      recibo_id: dato(formulario, 'recibo_id'),
      subcontrato_id: dato(formulario, 'subcontrato_id'),
      fecha_pago: dato(formulario, 'fecha_pago'),
      operacion: dato(formulario, 'operacion'),
      ruta: dato(formulario, 'ruta'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el pago.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_pago_recibo_honorarios', {
    p_id: d.id,
    p_recibo_id: d.recibo_id,
    p_fecha_pago: d.fecha_pago,
    p_operacion: d.operacion || null,
    p_ruta: d.ruta,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El pago no quedó registrado. Recarga la pantalla.' }

  repintar(d.subcontrato_id)
  return { ok: true, mensaje: 'Pago registrado con su voucher: Administración recibe el aviso.' }
}

/** Anular un pago mal registrado: el recibo vuelve a quedar por pagar. Mismo permiso que `anular_pago_recibo_honorarios`. */
export async function anularPagoRecibo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'subcontratos.pagar')) return { ok: false, error: NO_PAGA }
  const analisis = z
    .object({
      id: z.guid(),
      subcontrato_id: z.guid(),
      motivo: z.string().trim().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), subcontrato_id: dato(formulario, 'subcontrato_id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_pago_recibo_honorarios', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }

  repintar(analisis.data.subcontrato_id)
  return { ok: true, mensaje: 'Pago anulado: el recibo vuelve a quedar por pagar.' }
}

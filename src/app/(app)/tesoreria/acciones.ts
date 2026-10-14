'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirPermiso, exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const dinero = z.coerce.number().positive().multipleOf(0.01)
const movimiento = z.object({ id: z.guid(), fecha: z.iso.date(), monto: dinero, referencia: z.string().trim().min(3).max(120) })

/**
 * Un cobro de una factura por cobrar. La cuenta la crea Contabilidad al enviar
 * la factura (migración 20261015120000); Tesorería registra lo que entra.
 * Mismo permiso que la política de `cobros_ot` (`tesoreria.registrar_cobros`).
 */
export async function registrarCobro(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('tesoreria.registrar_cobros')
  const v = movimiento.safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'Indica la fecha, el importe y la referencia bancaria del cobro.' }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cobros_ot')
    .insert({ cuenta_id: v.data.id, fecha: v.data.fecha, monto: v.data.monto, referencia: v.data.referencia })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/tesoreria/por-cobrar')
  return { ok: true, mensaje: 'Cobro registrado y saldo actualizado.' }
}

/** Un pago de un comprobante a crédito que registró Contabilidad. Mismo permiso que la política de `pagos_adquisicion`. */
export async function registrarPago(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('tesoreria.registrar_pagos')
  const v = movimiento.safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'Indica la fecha, el importe y la referencia bancaria del pago.' }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pagos_adquisicion')
    .insert({ adquisicion_id: v.data.id, fecha: v.data.fecha, monto: v.data.monto, referencia: v.data.referencia })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/tesoreria/por-pagar')
  return { ok: true, mensaje: 'Pago registrado y saldo actualizado.' }
}

const NO_PAGA_SERVICIOS = 'Los pagos de servicio los registra Tesorería.'

/**
 * Tesorería paga una orden de servicio aprobada, con su comprobante ya subido a
 * `pagos-servicio/{orden de servicio}/…`. Mismo permiso que
 * `registrar_pago_servicio` (`tesoreria.pagar_servicios`). El id llega de la
 * pantalla: un reintento no registra otro.
 */
export async function registrarPagoServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.pagar_servicios')) return { ok: false, error: NO_PAGA_SERVICIOS }
  const analisis = z
    .object({
      id: z.guid(),
      orden_servicio_id: z.guid(),
      fecha_pago: z.iso.date('Elige el día del pago.'),
      monto: z.coerce.number('Escribe lo que se pagó.').positive('Escribe lo que se pagó.').multipleOf(0.01, 'El importe va en dos decimales.'),
      cancela: z.enum(['si', 'no'], 'Indica si este pago cancela la orden de servicio.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      comprobante: z.string().max(30, 'El número del comprobante del proveedor pasa de 30 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el comprobante del pago.').max(200),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      orden_servicio_id: dato(formulario, 'orden_servicio_id'),
      fecha_pago: dato(formulario, 'fecha_pago'),
      monto: dato(formulario, 'monto'),
      cancela: dato(formulario, 'cancela'),
      operacion: dato(formulario, 'operacion'),
      comprobante: dato(formulario, 'comprobante'),
      ruta: dato(formulario, 'ruta'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el pago.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_pago_servicio', {
    p_id: d.id,
    p_orden_servicio: d.orden_servicio_id,
    p_fecha_pago: d.fecha_pago,
    p_monto: d.monto,
    p_cancela: d.cancela === 'si',
    p_operacion: d.operacion || null,
    p_comprobante: d.comprobante || null,
    p_ruta: d.ruta,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El pago no se registró. Recarga la pantalla.' }

  revalidatePath('/tesoreria/pagos-de-servicio')
  revalidatePath('/compras/servicios')
  return { ok: true, mensaje: d.cancela === 'si' ? 'Pago registrado: la orden de servicio queda cancelada.' : 'Pago a cuenta registrado.' }
}

/** Anular con su motivo un pago de servicio mal registrado. Mismo permiso que `anular_pago_servicio`. */
export async function anularPagoServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.pagar_servicios')) return { ok: false, error: NO_PAGA_SERVICIOS }
  const analisis = z
    .object({ id: z.guid(), motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.') })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_pago_servicio', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }

  revalidatePath('/tesoreria/pagos-de-servicio')
  revalidatePath('/compras/servicios')
  return { ok: true, mensaje: 'Pago anulado: la orden de servicio vuelve a quedar por pagar.' }
}

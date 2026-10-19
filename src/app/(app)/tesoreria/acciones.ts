'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { camposDeLaCuenta, leerCuenta, montoDeLaCuenta, SIN_CAJA } from '@/lib/caja-del-pago'
import { cajaTrasElPago } from '@/lib/datos/caja'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const NO_COBRA = 'Los cobros los registra Tesorería.'
const MOTIVO = z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.')

function repintarCobros() {
  revalidatePath('/tesoreria/por-cobrar')
  revalidatePath('/tesoreria/caja-diaria')
  revalidatePath('/contabilidad/facturacion')
  revalidatePath('/cotizaciones/pdf')
  revalidatePath('/codigos-internos')
}

/**
 * Tesorería registra un cobro de una factura de venta, con su voucher ya subido
 * a `cobros-venta/{factura}/…` (migración 20261015124000), en la cuenta de la
 * caja que eligió: la base deja ahí su ingreso (migración 20261019100000).
 * Mismo permiso que `registrar_cobro_factura` (`tesoreria.registrar_cobros`).
 * El id llega de la pantalla: un reintento no registra otro.
 */
export async function registrarCobroFactura(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_cobros')) return { ok: false, error: NO_COBRA }
  if (!puede(perfil, 'tesoreria.caja')) return { ok: false, error: SIN_CAJA }
  const analisis = z
    .object({
      id: z.guid(),
      factura_id: z.guid(),
      fecha: z.iso.date('Elige el día del cobro.'),
      monto: z.coerce.number('Escribe lo que se cobró.').positive('Escribe lo que se cobró.').multipleOf(0.01, 'El importe va en dos decimales.'),
      cancela: z.enum(['si', 'no'], 'Indica si con este cobro la factura queda cancelada.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el voucher del cobro.').max(200),
      ...camposDeLaCuenta('cobro'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      factura_id: dato(formulario, 'factura_id'),
      fecha: dato(formulario, 'fecha'),
      monto: dato(formulario, 'monto'),
      cancela: dato(formulario, 'cancela'),
      operacion: dato(formulario, 'operacion'),
      ruta: dato(formulario, 'ruta'),
      ...leerCuenta(formulario),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el cobro.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_cobro_factura', {
    p_id: d.id,
    p_factura: d.factura_id,
    p_fecha: d.fecha,
    p_monto: d.monto,
    p_cancela: d.cancela === 'si',
    p_operacion: d.operacion || null,
    p_ruta: d.ruta,
    p_caja: d.caja_id,
    p_monto_cuenta: montoDeLaCuenta(d.monto_cuenta),
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El cobro no se registró. Recarga la pantalla.' }

  const caja = await cajaTrasElPago('COBRO_FACTURA_VENTA', d.id, d.caja_id, d.fecha, 'cobro')
  repintarCobros()
  return { ok: true, mensaje: `Cobro registrado con su voucher. ${caja}`.trim() }
}

/** Anular con su motivo un cobro mal registrado: la factura vuelve a su saldo. Mismo permiso que `anular_cobro_factura`. */
export async function anularCobroFactura(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_cobros')) return { ok: false, error: NO_COBRA }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_cobro_factura', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El cobro no se anuló. Recarga la pantalla.' }
  repintarCobros()
  return { ok: true, mensaje: 'Cobro anulado: la factura vuelve a su saldo.' }
}

const NO_PAGA_FACTURAS = 'Los pagos de las facturas los registra Tesorería.'

/**
 * Tesorería paga una factura de compra registrada en Adquisiciones, al contado
 * o a crédito, con su voucher ya subido a `pagos-facturas/{factura}/…`
 * (migración 20261015122000), desde la cuenta de la caja que eligió: la base
 * deja ahí su egreso (migración 20261019100000). Mismo permiso que
 * `registrar_pago_factura` (`tesoreria.registrar_pagos`). El id llega de la
 * pantalla: un reintento no registra otro.
 */
export async function registrarPagoFactura(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_FACTURAS }
  if (!puede(perfil, 'tesoreria.caja')) return { ok: false, error: SIN_CAJA }
  const analisis = z
    .object({
      id: z.guid(),
      adquisicion_id: z.guid(),
      fecha: z.iso.date('Elige el día del pago.'),
      monto: z.coerce.number('Escribe lo que se pagó.').positive('Escribe lo que se pagó.').multipleOf(0.01, 'El importe va en dos decimales.'),
      referencia: z.string().min(3, 'Escribe el número de operación del banco.').max(120, 'El número de operación pasa de 120 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el voucher del pago.').max(200),
      ...camposDeLaCuenta('pago'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      adquisicion_id: dato(formulario, 'adquisicion_id'),
      fecha: dato(formulario, 'fecha'),
      monto: dato(formulario, 'monto'),
      referencia: dato(formulario, 'referencia'),
      ruta: dato(formulario, 'ruta'),
      ...leerCuenta(formulario),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el pago.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_pago_factura', {
    p_id: d.id,
    p_adquisicion: d.adquisicion_id,
    p_fecha: d.fecha,
    p_monto: d.monto,
    p_referencia: d.referencia,
    p_ruta: d.ruta,
    p_caja: d.caja_id,
    p_monto_cuenta: montoDeLaCuenta(d.monto_cuenta),
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El pago no se registró. Recarga la pantalla.' }

  const caja = await cajaTrasElPago('PAGO_ADQUISICION', d.id, d.caja_id, d.fecha, 'pago')
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/caja-diaria')
  return { ok: true, mensaje: `Pago registrado y saldo actualizado. ${caja}`.trim() }
}

/** Anular con su motivo un pago de factura mal registrado. Mismo permiso que `anular_pago_factura`. */
export async function anularPagoFactura(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_FACTURAS }
  const analisis = z
    .object({ id: z.guid(), motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.') })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_pago_factura', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }

  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/caja-diaria')
  return { ok: true, mensaje: 'Pago anulado: la factura vuelve a su saldo.' }
}

const NO_PAGA_SERVICIOS = 'Los pagos de servicio los registra Tesorería.'

/**
 * Tesorería paga una orden de servicio aprobada, con su comprobante ya subido a
 * `pagos-servicio/{orden de servicio}/…`, desde la cuenta de la caja que eligió:
 * la base deja ahí su egreso (migración 20261019100000). Mismo permiso que
 * `registrar_pago_servicio` (`tesoreria.pagar_servicios`). El id llega de la
 * pantalla: un reintento no registra otro.
 */
export async function registrarPagoServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.pagar_servicios')) return { ok: false, error: NO_PAGA_SERVICIOS }
  if (!puede(perfil, 'tesoreria.caja')) return { ok: false, error: SIN_CAJA }
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
      ...camposDeLaCuenta('pago'),
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
      ...leerCuenta(formulario),
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
    p_caja: d.caja_id,
    p_monto_cuenta: montoDeLaCuenta(d.monto_cuenta),
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El pago no se registró. Recarga la pantalla.' }

  const caja = await cajaTrasElPago('PAGO_ORDEN_SERVICIO', d.id, d.caja_id, d.fecha_pago, 'pago')
  revalidatePath('/tesoreria/pagos-de-servicio')
  revalidatePath('/compras/servicios')
  revalidatePath('/tesoreria/caja-diaria')
  const pagado = d.cancela === 'si' ? 'Pago registrado: la orden de servicio queda cancelada.' : 'Pago a cuenta registrado.'
  return { ok: true, mensaje: `${pagado} ${caja}`.trim() }
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
  revalidatePath('/tesoreria/caja-diaria')
  return { ok: true, mensaje: 'Pago anulado: la orden de servicio vuelve a quedar por pagar.' }
}

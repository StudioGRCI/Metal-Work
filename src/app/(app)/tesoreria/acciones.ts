'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { camposDeLaCuenta, leerCuenta, montoDeLaCuenta, SIN_CAJA } from '@/lib/caja-del-pago'
import { cajaTrasAnular, cajaTrasElPago } from '@/lib/datos/caja'
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
  const caja = await cajaTrasAnular('COBRO_FACTURA_VENTA', analisis.data.id, 'cobro')
  repintarCobros()
  return { ok: true, mensaje: `Cobro anulado: la factura vuelve a su saldo. ${caja}`.trim() }
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
  const caja = await cajaTrasAnular('PAGO_ADQUISICION', analisis.data.id, 'pago')
  revalidatePath('/tesoreria/caja-diaria')
  return { ok: true, mensaje: `Pago anulado: la factura vuelve a su saldo. ${caja}`.trim() }
}

const NO_PAGA_COMPRAS = 'Los pagos de las OC con boleta los registra Tesorería.'

function repintarPagosDeCompra() {
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/adquisiciones')
  revalidatePath('/compras/ordenes')
  revalidatePath('/tesoreria/caja-diaria')
}

/**
 * Tesorería paga una OC con boleta directo, como una OS (migración
 * 20261020210000): con su voucher ya subido a `pagos-compras/{oc}/…`, desde la
 * cuenta de la caja que eligió. Mismo permiso que `registrar_pago_compra`
 * (`tesoreria.registrar_pagos`). El id llega de la pantalla: un reintento no
 * registra otro.
 */
export async function registrarPagoCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  if (!puede(perfil, 'tesoreria.caja')) return { ok: false, error: SIN_CAJA }
  const analisis = z
    .object({
      id: z.guid(),
      orden_compra_id: z.guid(),
      fecha_pago: z.iso.date('Elige el día del pago.'),
      monto: z.coerce.number('Escribe lo que se pagó.').positive('Escribe lo que se pagó.').multipleOf(0.01, 'El importe va en dos decimales.'),
      cancela: z.enum(['si', 'no'], 'Indica si este pago cancela la OC.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      comprobante: z.string().max(30, 'El número de la boleta pasa de 30 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el voucher del pago.').max(200),
      ...camposDeLaCuenta('pago'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      orden_compra_id: dato(formulario, 'orden_compra_id'),
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
  const { data, error } = await supabase.rpc('registrar_pago_compra', {
    p_id: d.id,
    p_orden_compra: d.orden_compra_id,
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

  // El pago que completa el total cancela la OC aunque se marcara «a cuenta»: lo dice la fila guardada.
  // Si no se pudo leer, no se adivina con lo que marcó el formulario.
  const [guardado, caja] = await Promise.all([
    supabase.from('pagos_orden_compra').select('cancela').eq('id', d.id).maybeSingle(),
    cajaTrasElPago('PAGO_ORDEN_COMPRA', d.id, d.caja_id, d.fecha_pago, 'pago'),
  ])
  repintarPagosDeCompra()
  const pagado =
    guardado.error || !guardado.data
      ? 'Pago registrado.'
      : guardado.data.cancela
        ? 'Pago registrado: la OC queda pagada.'
        : 'Pago a cuenta registrado.'
  return { ok: true, mensaje: `${pagado} ${caja}`.trim() }
}

/**
 * La OC con boleta de antes de la migración 20261020210000 se dio por pagada
 * fuera del sistema. Si no se pagó, Tesorería la pasa a su lista y se paga como
 * las de ahora. Mismo permiso que `pasar_compra_a_tesoreria`
 * (`tesoreria.registrar_pagos`).
 */
export async function pasarCompraATesoreria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  const analisis = z.object({ id: z.guid() }).safeParse({ id: dato(formulario, 'id') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('pasar_compra_a_tesoreria', { p_compra: analisis.data.id })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La OC no pasó a Cuentas por pagar. Recarga la pantalla.' }
  repintarPagosDeCompra()
  return { ok: true, mensaje: 'La OC pasó a Cuentas por pagar: ahí la pagas con su voucher.' }
}

/** Anular con su motivo un pago de OC con boleta mal registrado. Mismo permiso que `anular_pago_compra`. */
export async function anularPagoCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_pago_compra', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }
  const [caja, comprobante] = await Promise.all([
    cajaTrasAnular('PAGO_ORDEN_COMPRA', analisis.data.id, 'pago'),
    comprobanteDeLaCompraDelPago(supabase, analisis.data.id),
  ])
  repintarPagosDeCompra()
  // Si a la OC le llegó su comprobante, ya no vuelve a pagarse aquí; si no se pudo leer, no se adivina.
  const queda =
    comprobante === undefined
      ? 'Pago anulado.'
      : comprobante
        ? `Pago anulado: la OC se paga por su comprobante ${comprobante} en «Facturas por pagar» cuando Contabilidad lo registre.`
        : 'Pago anulado: la OC vuelve a quedar por pagar.'
  return { ok: true, mensaje: `${queda} ${caja}`.trim() }
}

/** El comprobante en camino de la OC de ese pago, `null` si no hay, `undefined` si no se pudo leer. */
async function comprobanteDeLaCompraDelPago(supabase: Awaited<ReturnType<typeof createClient>>, pagoId: string) {
  const { data: pago, error } = await supabase.from('pagos_orden_compra').select('orden_compra_id').eq('id', pagoId).maybeSingle()
  if (error || !pago) return undefined
  const { data: lista, error: errorLista } = await supabase.rpc('compras_con_boleta_por_pagar')
  if (errorLista) return undefined
  return lista?.find((f) => f.id === pago.orden_compra_id)?.comprobante_en_camino ?? null
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
  const caja = await cajaTrasAnular('PAGO_ORDEN_SERVICIO', analisis.data.id, 'pago')
  revalidatePath('/tesoreria/caja-diaria')
  return { ok: true, mensaje: `Pago anulado: la orden de servicio vuelve a quedar por pagar. ${caja}`.trim() }
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { camposDeLaCuenta, leerCuenta, montoDeLaCuenta, SIN_CAJA } from '@/lib/caja-del-pago'
import { cajaTrasAnular, cajaTrasElPago } from '@/lib/datos/caja'
import { moneda } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

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
  const [caja, quedo] = await Promise.all([
    cajaTrasAnular('PAGO_ADQUISICION', analisis.data.id, 'pago'),
    comoQuedaLaFactura(supabase, analisis.data.id),
  ])
  revalidatePath('/tesoreria/caja-diaria')
  return { ok: true, mensaje: `${quedo} ${caja}`.trim() }
}

/**
 * Lo que dice el aviso después de anular un pago de la factura, leído de la
 * base: si la OC con boleta de la factura se había pagado de más por su boleta,
 * la factura toma ahora ese pago (migración 20261020210000) y no vuelve a deber
 * todo. Si no se pudo leer, no se adivina.
 */
async function comoQuedaLaFactura(supabase: Awaited<ReturnType<typeof createClient>>, pagoId: string): Promise<string> {
  const { data: pago, error } = await supabase.from('pagos_adquisicion').select('adquisicion_id').eq('id', pagoId).maybeSingle()
  if (error || !pago) {
    if (error) console.error('No se pudo leer cómo quedó la factura del pago anulado', error)
    return 'Pago anulado. No se pudo leer cómo quedó la factura: mírala en «Facturas por pagar».'
  }
  const [cuenta, deLaBoleta] = await Promise.all([
    supabase.from('v_cuentas_pagar').select('saldo, moneda').eq('id', pago.adquisicion_id).maybeSingle(),
    supabase
      .from('pagos_adquisicion')
      .select('id', { count: 'exact', head: true })
      .eq('adquisicion_id', pago.adquisicion_id)
      .not('pago_orden_compra_id', 'is', null)
      .is('anulado_en', null),
  ])
  if (cuenta.error || !cuenta.data || deLaBoleta.error) {
    console.error('No se pudo leer cómo quedó la factura del pago anulado', cuenta.error ?? deLaBoleta.error)
    return 'Pago anulado. No se pudo leer cómo quedó la factura: mírala en «Facturas por pagar».'
  }
  const saldo = Number(cuenta.data.saldo ?? 0)
  const m = cuenta.data.moneda === 'USD' ? 'USD' : 'PEN'
  const falta = saldo > 0 ? `le faltan ${moneda(saldo, m)}` : 'queda pagada'
  return (deLaBoleta.count ?? 0) > 0
    ? `Pago anulado: la factura toma lo que se pagó por la boleta de su OC y ${falta}.`
    : `Pago anulado: a la factura ${saldo > 0 ? `le faltan ${moneda(saldo, m)}` : 'no le falta nada'}.`
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

/**
 * Anular con su motivo un pago de OC con boleta mal registrado: el que no salió,
 * o salió de otra cuenta o por otro monto. El que el proveedor devolvió no se
 * anula (lo que salió, salió): se registra la devolución. La ventana lo pregunta
 * primero y la acción no acepta otra respuesta, porque la pantalla no es la
 * única puerta. Mismo permiso que `anular_pago_compra`.
 */
export async function anularPagoCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  const analisis = z
    .object({ id: z.guid(), que_paso: z.literal('no_salio', 'Elige qué pasó con el pago.'), motivo: MOTIVO })
    .safeParse({ id: dato(formulario, 'id'), que_paso: dato(formulario, 'que_paso'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_pago_compra', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }
  const [caja, situacion] = await Promise.all([
    cajaTrasAnular('PAGO_ORDEN_COMPRA', analisis.data.id, 'pago'),
    situacionDeLaCompraDelPago(supabase, analisis.data.id),
  ])
  repintarPagosDeCompra()
  return { ok: true, mensaje: `${queQuedaTrasAnular(situacion)} ${caja}`.trim() }
}

type SituacionDePago = Database['public']['Functions']['situacion_de_pago_de_compra']['Returns'][number]

/** Cómo quedó el pago de la OC de ese pago, leído de la base; `null` si no se pudo leer. */
async function situacionDeLaCompraDelPago(supabase: Awaited<ReturnType<typeof createClient>>, pagoId: string) {
  const { data: pago, error } = await supabase.from('pagos_orden_compra').select('orden_compra_id').eq('id', pagoId).maybeSingle()
  if (error || !pago) return null
  return situacionDeLaCompra(supabase, pago.orden_compra_id)
}

/** Cómo quedó el pago de esa OC, leído de la base; `null` si no se pudo leer. */
async function situacionDeLaCompra(supabase: Awaited<ReturnType<typeof createClient>>, compraId: string) {
  const { data, error } = await supabase.rpc('situacion_de_pago_de_compra', { p_compra: compraId })
  if (error) {
    console.error('No se pudo leer cómo quedó el pago de la OC', error)
    return null
  }
  return data?.[0] ?? null
}

/**
 * Lo que dice el aviso después de anular un pago de OC con boleta: lo que la
 * base dejó, no lo que se esperaba. Si su factura había tomado ese pago, deja de
 * tomarlo y vuelve a deber lo que no cubren los otros pagos (migración
 * 20261020210000). Si no se pudo leer, no se adivina.
 */
function queQuedaTrasAnular(s: SituacionDePago | null): string {
  if (!s) return 'Pago anulado.'
  const m = s.moneda === 'USD' ? 'USD' : 'PEN'
  // La factura que Logística anexó es de otras OC y no alcanza para esta: la OC
  // se sigue pagando por su boleta cuando se anule ese anexo.
  if (s.en_camino && s.en_camino_origen === 'REGISTRADA' && s.en_camino_alcanza === false) {
    return `Pago anulado. Ojo: la factura ${s.en_camino} anexada a esta OC, que Contabilidad registró para otras OC, no alcanza para ella; la OC se paga por su boleta cuando Logística anule ese anexo.`
  }
  // Lo que queda pagado por la boleta espera a su factura en otra moneda: o se lo pasa al cambio, o se registra la devolución.
  if (s.otra_moneda) {
    return `Pago anulado, pero quedan ${moneda(Number(s.sin_tomar ?? 0), m)} pagados por la boleta sin pasar a su factura ${s.otra_factura ?? s.factura}: en «OC con boleta», «La factura lo toma al cambio» o «Registrar devolución».`
  }
  // La factura en otra moneda no toma nada de un pago anulado (lo que tomaba al cambio se deshizo con él): le falta en su moneda.
  if (Number(s.otra_saldo ?? 0) > 0 && s.otra_factura) {
    const otra = s.moneda === 'USD' ? 'PEN' : 'USD'
    return `Pago anulado: su factura ${s.otra_factura} ya no toma nada de este pago y le faltan ${moneda(Number(s.otra_saldo), otra)}, que se pagan en «Facturas por pagar».`
  }
  if (s.factura) {
    const deMas = Number(s.de_mas ?? 0)
    if (deMas > 0) {
      return `Pago anulado, pero la OC sigue pagada de más: ${moneda(deMas, m)}. Cuando el proveedor los devuelva, regístralo con «Registrar devolución».`
    }
    const saldo = Number(s.factura_saldo ?? 0)
    if (saldo <= 0) return `Pago anulado: la OC sigue pagada por su factura ${s.factura}.`
    return `Pago anulado: su factura ${s.factura} ya no toma ese pago y le faltan ${moneda(saldo, m)}: se pagan en «Facturas por pagar».`
  }
  const n = s.pagos_vigentes ?? 0
  // El comprobante que el proveedor entregó y Contabilidad todavía no registra: registrado, toma los pagos que queden.
  if (s.en_camino) {
    const quien = s.en_camino_origen === 'BORRADOR' ? 'Contabilidad lo tiene en borrador' : 'Logística lo anexó'
    return `Pago anulado: la OC se paga por su comprobante ${s.en_camino} (${quien}) en «Facturas por pagar» cuando Contabilidad lo registre.${
      n > 0 ? ' Registrado, toma lo que queda pagado por la boleta.' : ''
    }`
  }
  if (s.cancelada) {
    return Number(s.saldo ?? 0) <= 0
      ? 'Pago anulado. La OC sigue pagada: sus otros pagos cubren el total.'
      : 'Pago anulado. La OC sigue pagada: otro de sus pagos la dio por cancelada.'
  }
  return `Pago anulado: a la OC le quedan ${moneda(Number(s.saldo ?? 0), m)} por pagar.`
}

/**
 * Tesorería registra lo que el proveedor de una OC con boleta le devolvió de lo
 * pagado por la boleta (undécima vuelta): con su constancia ya subida a
 * `pagos-compras/{oc}/…` y la cuenta a la que entró; la base deja ahí su
 * ingreso y rehace lo que la factura toma. Mismo permiso que
 * `registrar_devolucion_compra` (`tesoreria.registrar_pagos`, y
 * `tesoreria.caja`, que mueve la caja). El id llega de la pantalla: un
 * reintento no registra otra.
 */
export async function registrarDevolucionCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  if (!puede(perfil, 'tesoreria.caja')) return { ok: false, error: SIN_CAJA }
  const analisis = z
    .object({
      id: z.guid(),
      orden_compra_id: z.guid(),
      fecha: z.iso.date('Elige el día en que entró la devolución.'),
      monto: z.coerce
        .number('Escribe lo que devolvió el proveedor.')
        .positive('Escribe lo que devolvió el proveedor.')
        .multipleOf(0.01, 'El importe va en dos decimales.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      ruta: z.string().min(1, 'Adjunta la constancia de la devolución.').max(200),
      ...camposDeLaCuenta('devolucion'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      orden_compra_id: dato(formulario, 'orden_compra_id'),
      fecha: dato(formulario, 'fecha'),
      monto: dato(formulario, 'monto'),
      operacion: dato(formulario, 'operacion'),
      ruta: dato(formulario, 'ruta'),
      ...leerCuenta(formulario),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la devolución.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_devolucion_compra', {
    p_id: d.id,
    p_orden_compra: d.orden_compra_id,
    p_fecha: d.fecha,
    p_monto: d.monto,
    p_operacion: d.operacion || null,
    p_ruta: d.ruta,
    p_caja: d.caja_id,
    p_monto_cuenta: montoDeLaCuenta(d.monto_cuenta),
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La devolución no se registró. Recarga la pantalla.' }

  const [caja, situacion] = await Promise.all([
    cajaTrasElPago('DEVOLUCION_ORDEN_COMPRA', d.id, d.caja_id, d.fecha, 'devolucion'),
    situacionDeLaCompra(supabase, d.orden_compra_id),
  ])
  repintarPagosDeCompra()
  return { ok: true, mensaje: `Devolución registrada. ${queQuedaTrasDevolver(situacion)} ${caja}`.trim() }
}

/** Anular con su motivo una devolución mal registrada: su ingreso sale de la caja. Mismo permiso que `anular_devolucion_compra`. */
export async function anularDevolucionCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_devolucion_compra', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La devolución no se anuló. Recarga la pantalla.' }
  const { data: devolucion } = await supabase.from('devoluciones_orden_compra').select('orden_compra_id').eq('id', analisis.data.id).maybeSingle()
  const [caja, situacion] = await Promise.all([
    cajaTrasAnular('DEVOLUCION_ORDEN_COMPRA', analisis.data.id, 'devolucion'),
    devolucion ? situacionDeLaCompra(supabase, devolucion.orden_compra_id) : Promise.resolve(null),
  ])
  repintarPagosDeCompra()
  return { ok: true, mensaje: `Devolución anulada. ${queQuedaTrasDevolver(situacion)} ${caja}`.trim() }
}

/**
 * Lo que dice el aviso después de registrar o anular una devolución, leído de
 * la base: lo pagado de más que queda, lo que le falta a su factura o, sin
 * factura, lo que le queda por pagar a la OC. Si no se pudo leer, no se adivina.
 */
function queQuedaTrasDevolver(s: SituacionDePago | null): string {
  if (!s) return ''
  const m = s.moneda === 'USD' ? 'USD' : 'PEN'
  const deMas = Number(s.de_mas ?? 0)
  if (deMas > 0) return `Quedan ${moneda(deMas, m)} pagados de más.`
  if (s.otra_moneda) {
    return `Quedan ${moneda(Number(s.sin_tomar ?? 0), m)} pagados por la boleta sin pasar a su factura ${s.otra_factura ?? s.factura}.`
  }
  if (s.factura) {
    const saldo = Number(s.factura_saldo ?? 0)
    return saldo > 0
      ? `Su factura ${s.factura} ahora toma ${moneda(Number(s.aplicado ?? 0), m)} y le faltan ${moneda(saldo, m)}, que se pagan en «Facturas por pagar».`
      : 'Ya no queda nada pagado de más.'
  }
  return s.cancelada ? 'La OC sigue pagada.' : `A la OC le quedan ${moneda(Number(s.saldo ?? 0), m)} por pagar.`
}

/**
 * Tesorería pasa a una factura lo pagado por la boleta (undécima vuelta): a su
 * factura en otra moneda, al cambio que reconoce el proveedor, o a otra factura
 * suya en que descuenta lo pagado de más. No mueve la caja: el dinero ya salió.
 * Mismo permiso que `tomar_pago_de_la_boleta` (`tesoreria.registrar_pagos`). El
 * id llega de la pantalla: un reintento no lo pasa dos veces.
 */
export async function tomarPagoDeLaBoleta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  const importe = (que: string) =>
    z.coerce.number(`Escribe ${que}.`).positive(`Escribe ${que}.`).multipleOf(0.01, 'Los importes van en dos decimales.')
  const analisis = z
    .object({
      id: z.guid(),
      orden_compra_id: z.guid(),
      factura_id: z.guid('Elige la factura.'),
      monto_boleta: importe('lo que sale de lo pagado por la boleta'),
      monto_factura: importe('lo que toma la factura'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      orden_compra_id: dato(formulario, 'orden_compra_id'),
      factura_id: dato(formulario, 'factura_id'),
      monto_boleta: dato(formulario, 'monto_boleta'),
      monto_factura: dato(formulario, 'monto_factura'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los montos.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('tomar_pago_de_la_boleta', {
    p_id: d.id,
    p_compra: d.orden_compra_id,
    p_factura: d.factura_id,
    p_monto_boleta: d.monto_boleta,
    p_monto_factura: d.monto_factura,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La factura no tomó lo pagado por la boleta. Recarga la pantalla.' }
  repintarPagosDeCompra()
  return { ok: true, mensaje: await loQueTomoLaFactura(supabase, d) }
}

/** Lo que dice el aviso después de pasar lo pagado por la boleta a una factura, leído de la base. */
async function loQueTomoLaFactura(
  supabase: Awaited<ReturnType<typeof createClient>>,
  d: { factura_id: string; orden_compra_id: string; monto_boleta: number; monto_factura: number },
): Promise<string> {
  const [factura, cuenta, oc] = await Promise.all([
    supabase.from('adquisiciones').select('numero_documento, moneda').eq('id', d.factura_id).maybeSingle(),
    supabase.from('v_cuentas_pagar').select('saldo').eq('id', d.factura_id).maybeSingle(),
    supabase.from('ordenes_compra_materiales').select('moneda').eq('id', d.orden_compra_id).maybeSingle(),
  ])
  const error = factura.error ?? cuenta.error ?? oc.error
  if (error || !factura.data || !cuenta.data || !oc.data) {
    if (error) console.error('No se pudo leer cómo quedó la factura que tomó lo pagado por la boleta', error)
    return 'Listo: la factura tomó lo pagado por la boleta. Mírala en «Facturas por pagar».'
  }
  const mf = factura.data.moneda === 'USD' ? 'USD' : 'PEN'
  const mo = oc.data.moneda === 'USD' ? 'USD' : 'PEN'
  // En otra moneda, con el cambio que salió de los dos montos: soles por dólar.
  const cambio =
    mf === mo
      ? ''
      : ` (${moneda(d.monto_boleta, mo)}, a S/ ${(mf === 'USD' ? d.monto_boleta / d.monto_factura : d.monto_factura / d.monto_boleta).toFixed(3)} por dólar)`
  const saldo = Number(cuenta.data.saldo ?? 0)
  const resto = saldo > 0 ? ` Le faltan ${moneda(saldo, mf)}: se pagan en «Facturas por pagar».` : ' Queda pagada.'
  return `La factura ${factura.data.numero_documento} toma ${moneda(d.monto_factura, mf)} de lo pagado por la boleta${cambio}.${resto}`
}

/**
 * Deshacer lo que Tesorería pasó a mano de la boleta a una factura: la factura
 * vuelve a deberlo y lo pagado por la boleta queda sin pasar a ninguna. Mismo
 * permiso que `soltar_pago_de_la_boleta` (`tesoreria.registrar_pagos`).
 */
export async function soltarPagoDeLaBoleta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA_COMPRAS }
  const analisis = z
    .object({ orden_compra_id: z.guid(), factura_id: z.guid(), motivo: z.string().min(10, 'Cuenta por qué se deshace, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.') })
    .safeParse({ orden_compra_id: dato(formulario, 'orden_compra_id'), factura_id: dato(formulario, 'factura_id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('soltar_pago_de_la_boleta', { p_compra: d.orden_compra_id, p_factura: d.factura_id, p_motivo: d.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.factura_id) return { ok: false, error: 'La toma no se deshizo. Recarga la pantalla.' }
  repintarPagosDeCompra()
  const [factura, cuenta] = await Promise.all([
    supabase.from('adquisiciones').select('numero_documento, moneda').eq('id', d.factura_id).maybeSingle(),
    supabase.from('v_cuentas_pagar').select('saldo').eq('id', d.factura_id).maybeSingle(),
  ])
  if (factura.error || cuenta.error || !factura.data || !cuenta.data) {
    return { ok: true, mensaje: 'Toma deshecha: lo pagado por la boleta queda sin pasar a ninguna factura.' }
  }
  const m = factura.data.moneda === 'USD' ? 'USD' : 'PEN'
  return {
    ok: true,
    mensaje: `Toma deshecha: la factura ${factura.data.numero_documento} vuelve a deber ${moneda(Number(cuenta.data.saldo ?? 0), m)}, y lo pagado por la boleta queda sin pasar a ninguna factura.`,
  }
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

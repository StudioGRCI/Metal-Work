'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { camposDeLaCuenta, leerCuenta, montoDeLaCuenta, SIN_CAJA } from '@/lib/caja-del-pago'
import { cajaTrasAnular, cajaTrasElPago } from '@/lib/datos/caja'
import { moneda } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const NO_PAGA = 'No tienes permiso para registrar ni anular el pago de las boletas de una parte.'
const MOTIVO = z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.')

function repintar() {
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/adquisiciones')
  revalidatePath('/compras/ordenes')
  revalidatePath('/tesoreria/caja-diaria')
}

/**
 * Tesorería paga la boleta de una parte de la OC que llega en partes (migración
 * 20261022200000), hasta su monto, con su voucher ya subido a
 * `pagos-compras/{oc}/…` y desde la cuenta de la caja que eligió. Mismo permiso
 * que `registrar_pago_parte_con_boleta` (`tesoreria.registrar_pagos`). El id
 * llega de la pantalla: un reintento no registra otro.
 */
export async function registrarPagoParte(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA }
  if (!puede(perfil, 'tesoreria.caja')) return { ok: false, error: SIN_CAJA }
  const analisis = z
    .object({
      id: z.guid(),
      documento_id: z.guid(),
      fecha_pago: z.iso.date('Elige el día del pago.'),
      monto: z.coerce.number('Escribe lo que se pagó.').positive('Escribe lo que se pagó.').multipleOf(0.01, 'El importe va en dos decimales.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el voucher del pago.').max(200),
      ...camposDeLaCuenta('pago'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      documento_id: dato(formulario, 'documento_id'),
      fecha_pago: dato(formulario, 'fecha_pago'),
      monto: dato(formulario, 'monto'),
      operacion: dato(formulario, 'operacion'),
      ruta: dato(formulario, 'ruta'),
      ...leerCuenta(formulario),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el pago.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_pago_parte_con_boleta', {
    p_id: d.id,
    p_documento: d.documento_id,
    p_fecha_pago: d.fecha_pago,
    p_monto: d.monto,
    p_operacion: d.operacion || null,
    p_ruta: d.ruta,
    p_caja: d.caja_id,
    p_monto_cuenta: montoDeLaCuenta(d.monto_cuenta),
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El pago no se registró. Recarga la pantalla.' }

  // Cuánto le queda a la boleta lo dice la base; si no se pudo leer, no se adivina.
  const [fila, caja] = await Promise.all([
    supabase.rpc('partes_con_boleta_por_pagar').then((r) => (r.error ? null : r.data?.find((x) => x.documento_id === d.documento_id) ?? null)),
    cajaTrasElPago('PAGO_PARTE_BOLETA', d.id, d.caja_id, d.fecha_pago, 'pago'),
  ])
  repintar()
  const saldo = Number(fila?.saldo ?? 0)
  const pagado = !fila
    ? 'Pago registrado.'
    : saldo > 0
      ? `Pago a cuenta registrado: a la boleta ${fila.boleta} le quedan ${moneda(saldo, fila.moneda === 'USD' ? 'USD' : 'PEN')}.`
      : `Pago registrado: la boleta ${fila.boleta} queda pagada.`
  return { ok: true, mensaje: `${pagado} ${caja}`.trim() }
}

/** Anular con su motivo un pago de la boleta de una parte mal registrado: la boleta vuelve a deberlo. */
export async function anularPagoParte(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_pago_parte_con_boleta', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }
  const caja = await cajaTrasAnular('PAGO_PARTE_BOLETA', analisis.data.id, 'pago')
  repintar()
  return { ok: true, mensaje: `Pago anulado: la boleta vuelve a deberlo. ${caja}`.trim() }
}

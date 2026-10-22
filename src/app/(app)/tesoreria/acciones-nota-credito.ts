'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { camposDeLaCuenta, leerCuenta, montoDeLaCuenta, SIN_CAJA } from '@/lib/caja-del-pago'
import { cajaTrasAnular, cajaTrasElPago } from '@/lib/datos/caja'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * Lo que Tesorería hace con lo que queda a favor de una nota de crédito del
 * proveedor (decisiones de DKS del 22/10, migración 20261022190000):
 * descontarlo de otra factura suya, que no mueve la caja, o registrar que el
 * proveedor lo devolvió, que entra a la cuenta de la caja que elija. Y deshacer
 * cada cosa con su motivo. Mismo permiso que las funciones de la base:
 * `tesoreria.registrar_pagos`, y la caja para lo que entra.
 */

const NO_PAGA = 'Lo que queda a favor de una nota de crédito lo maneja Tesorería.'
const MOTIVO = z.string().min(10, 'Cuenta por qué, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.')
const MONTO = z.coerce.number('Escribe el importe.').positive('Escribe el importe.').multipleOf(0.01, 'El importe va en dos decimales.')

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

function repintar() {
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/tesoreria/caja-diaria')
  revalidatePath('/adquisiciones')
}

/** Descuenta de otra factura del mismo proveedor y moneda parte de lo que la nota tiene a favor. */
export async function descontarNotaCredito(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA }
  const analisis = z
    .object({ nota: z.guid(), factura: z.guid('Elige la factura de la que se descuenta.'), monto: MONTO })
    .safeParse({ nota: dato(formulario, 'nota'), factura: dato(formulario, 'factura'), monto: dato(formulario, 'monto') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el descuento.' }
  const d = analisis.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('descontar_nota_credito', { p_nota: d.nota, p_factura: d.factura, p_monto: d.monto })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'El descuento no se registró. Recarga la pantalla.' }
  repintar()
  return { ok: true, mensaje: 'Descuento registrado: la factura debe eso menos, y la caja no se mueve porque no salió dinero.' }
}

/** Quita lo que la nota descontó de otra factura: la factura vuelve a deberlo y la nota lo vuelve a tener a favor. */
export async function quitarDescuentoNotaCredito(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('quitar_descuento_nota_credito', { p_pago: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: 'Descuento quitado: la factura vuelve a deberlo y la nota lo vuelve a tener a favor.' }
}

/** El proveedor devolvió el dinero de la nota: entra a la cuenta elegida con su constancia. El id llega de la pantalla. */
export async function registrarReembolsoNotaCredito(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA }
  if (!puede(perfil, 'tesoreria.caja')) return { ok: false, error: SIN_CAJA }
  const analisis = z
    .object({
      id: z.guid(),
      nota: z.guid(),
      fecha: z.iso.date('Elige el día en que entró el dinero.'),
      monto: MONTO,
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      ruta: z.string().min(1, 'Adjunta la constancia de la devolución.').max(200),
      ...camposDeLaCuenta('devolucion'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      nota: dato(formulario, 'nota'),
      fecha: dato(formulario, 'fecha'),
      monto: dato(formulario, 'monto'),
      operacion: dato(formulario, 'operacion'),
      ruta: dato(formulario, 'ruta'),
      ...leerCuenta(formulario),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la devolución.' }
  const d = analisis.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_reembolso_nota_credito', {
    p_id: d.id,
    p_nota: d.nota,
    p_fecha: d.fecha,
    p_monto: d.monto,
    // Sin número de operación (efectivo) la base recibe null: el tipo generado no lo dice.
    p_operacion: (d.operacion || null) as string,
    p_ruta: d.ruta,
    p_caja: d.caja_id,
    p_monto_cuenta: montoDeLaCuenta(d.monto_cuenta) as number,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La devolución no se registró. Recarga la pantalla.' }
  const caja = await cajaTrasElPago('REEMBOLSO_NOTA_CREDITO', d.id, d.caja_id, d.fecha, 'devolucion')
  repintar()
  return { ok: true, mensaje: `Devolución registrada. ${caja}`.trim() }
}

/** Anula con su motivo una devolución mal registrada: su ingreso sale de la caja y la nota lo vuelve a tener a favor. */
export async function anularReembolsoNotaCredito(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.registrar_pagos')) return { ok: false, error: NO_PAGA }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_reembolso_nota_credito', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La devolución no se anuló. Recarga la pantalla.' }
  const caja = await cajaTrasAnular('REEMBOLSO_NOTA_CREDITO', analisis.data.id, 'devolucion')
  repintar()
  return { ok: true, mensaje: `Devolución anulada: la nota vuelve a tenerlo a favor. ${caja}`.trim() }
}

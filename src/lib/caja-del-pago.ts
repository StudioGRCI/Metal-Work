import 'server-only'

import { z } from 'zod'

import { MONTO, normalizarMonto } from '@/lib/dominio/caja'
import { fecha as textoFecha } from '@/lib/format'
import type { createClient } from '@/lib/supabase/server'

/*
 * La cuenta de la caja que pide cada pago y cada cobro del sistema (migración
 * 20261017220000): la eligen en el formulario y la base deja ahí su movimiento.
 * Lo comparten las acciones de Tesorería, de recibos por honorarios y de la
 * planilla diaria, para que las cinco lean y avisen lo mismo.
 */

type Tipo = 'pago' | 'cobro'

/** Lo que dice la acción a quien paga o cobra sin llevar la caja: la base lo rechazaría igual (`tesoreria.caja`). */
export const SIN_CAJA =
  'Los pagos y los cobros se registran en una cuenta de la caja diaria, y tu cuenta no lleva la caja: pídele a Administración ese permiso.'

/** Los dos campos que agrega la cuenta al formulario: cuál y, si es de otra moneda, cuánto salió o entró en ella. */
export function camposDeLaCuenta(tipo: Tipo) {
  const verbo = tipo === 'cobro' ? 'entró a' : 'salió de'
  return {
    caja_id: z.guid(tipo === 'cobro' ? 'Elige la cuenta a la que entró el cobro.' : 'Elige la cuenta de la que salió el pago.'),
    monto_cuenta: z.string().regex(/^(\d{1,9}(\.\d{1,2})?)?$/, `Escribe con números lo que ${verbo} la cuenta, como 3750.00.`),
  }
}

/** Los dos campos tal como llegan del formulario: el monto, con su coma o su punto. */
export function leerCuenta(formulario: FormData) {
  const valor = (nombre: string) => {
    const v = formulario.get(nombre)
    return typeof v === 'string' ? v.trim() : ''
  }
  return { caja_id: valor('caja_id'), monto_cuenta: normalizarMonto(valor('monto_cuenta')) }
}

/** Lo que se le pasa a la base: el monto de la cuenta solo si se escribió (va cuando la cuenta es de otra moneda). */
export function montoDeLaCuenta(monto: string): number | null {
  return monto && MONTO.test(monto) && Number(monto) > 0 ? Number(monto) : null
}

/** El tipo del movimiento que deja cada cosa: el cobro entra, el pago sale. La devolución de una anulación es del otro tipo. */
const tipoDelMovimiento = (tipo: Tipo) => (tipo === 'cobro' ? 'INGRESO' : 'EGRESO')

/**
 * Cómo quedó la caja después del pago o el cobro, para decirlo en el aviso: de
 * qué cuenta salió, o por qué no se movió. Lo lee de la base —el movimiento que
 * dejó, con su cuenta, o que no dejó—, no lo adivina: en un reintento con otra
 * cuenta elegida, el pago ya estaba en la primera.
 */
export async function cajaTrasElPago(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origen: string,
  id: string,
  cajaId: string,
  dia: string,
  tipo: Tipo,
): Promise<string> {
  const mov = await supabase
    .from('movimientos_caja')
    .select('caja_id')
    .eq('origen', origen)
    .eq('origen_id', id)
    .eq('tipo', tipoDelMovimiento(tipo))
    .is('anulado_en', null)
    .maybeSingle()
  if (mov.error) return ''
  const caja = await supabase.from('cajas').select('nombre, fecha_inicio').eq('id', mov.data?.caja_id ?? cajaId).maybeSingle()
  const nombre = caja.data?.nombre
  if (caja.error || !nombre) return ''
  if (mov.data) return tipo === 'cobro' ? `Entró a ${nombre}.` : `Salió de ${nombre}.`
  const inicio = caja.data?.fecha_inicio
  if (!inicio || dia >= inicio) return ''
  return `La caja no se movió: la cuenta ${nombre} lleva la caja desde el ${textoFecha(inicio)} y este ${tipo} ya está en su saldo inicial.`
}

/**
 * Tras anular un pago o un cobro: si había movido la caja, que su movimiento
 * quedó anulado o, si su día ya estaba cerrado, que la devolución entró hoy.
 */
export async function cajaTrasAnular(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origen: string,
  id: string,
  tipo: Tipo,
): Promise<string> {
  const { data, error } = await supabase
    .from('movimientos_caja')
    .select('tipo, anulado_en, cajas(nombre)')
    .eq('origen', origen)
    .eq('origen_id', id)
  if (error || !data?.length) return ''
  const propio = tipoDelMovimiento(tipo)
  const devolucion = data.find((m) => m.tipo !== propio && !m.anulado_en)
  if (devolucion) {
    const cuenta = devolucion.cajas?.nombre ?? 'su cuenta'
    return tipo === 'cobro'
      ? `Su día ya estaba cerrado en la caja: hoy sale de ${cuenta} lo que entró con el cobro.`
      : `Su día ya estaba cerrado en la caja: hoy vuelve a ${cuenta} lo que salió con el pago.`
  }
  if (!data.some((m) => m.tipo === propio && m.anulado_en)) return ''
  return tipo === 'cobro' ? 'Su ingreso en la caja diaria también quedó anulado.' : 'Su egreso en la caja diaria también quedó anulado.'
}

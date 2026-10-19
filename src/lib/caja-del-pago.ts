import 'server-only'

import { z } from 'zod'

import { MONTO, normalizarMonto } from '@/lib/dominio/caja'
import { fecha as textoFecha } from '@/lib/format'
import type { createClient } from '@/lib/supabase/server'

/*
 * La cuenta de la caja que pide cada pago y cada cobro del sistema (migración
 * 20261019100000): la eligen en el formulario y la base deja ahí su movimiento.
 * Lo comparten las acciones de Tesorería, de recibos por honorarios y de la
 * planilla diaria, para que las cinco lean y avisen lo mismo.
 */

type Tipo = 'pago' | 'cobro'

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

/**
 * Cómo quedó la caja después del pago o el cobro, para decirlo en el aviso: de
 * qué cuenta salió, o por qué no se movió. Lo lee de la base —el movimiento que
 * dejó o no dejó—, no lo adivina.
 */
export async function cajaTrasElPago(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origen: string,
  id: string,
  cajaId: string,
  dia: string,
  tipo: Tipo,
): Promise<string> {
  const [mov, caja] = await Promise.all([
    supabase.from('movimientos_caja').select('id').eq('origen', origen).eq('origen_id', id).is('anulado_en', null).maybeSingle(),
    supabase.from('cajas').select('nombre, fecha_inicio').eq('id', cajaId).maybeSingle(),
  ])
  const nombre = caja.data?.nombre
  if (!nombre) return ''
  if (mov.data) return tipo === 'cobro' ? `Entró a ${nombre}.` : `Salió de ${nombre}.`
  const inicio = caja.data?.fecha_inicio
  if (!inicio || dia >= inicio) return ''
  return `La caja no se movió: la cuenta ${nombre} empieza el ${textoFecha(inicio)} y este ${tipo} ya está en su saldo inicial.`
}

/** Tras anular un pago o un cobro: si había movido la caja, que su movimiento quedó anulado. */
export async function cajaTrasAnular(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origen: string,
  id: string,
  tipo: Tipo,
): Promise<string> {
  const { data } = await supabase.from('movimientos_caja').select('id').eq('origen', origen).eq('origen_id', id).not('anulado_en', 'is', null).limit(1)
  if (!data?.length) return ''
  return tipo === 'cobro' ? 'Su ingreso en la caja diaria también quedó anulado.' : 'Su egreso en la caja diaria también quedó anulado.'
}

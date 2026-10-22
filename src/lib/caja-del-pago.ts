import 'server-only'

import { z } from 'zod'

import { MONTO, normalizarMonto, type TipoDeLaCaja } from '@/lib/dominio/caja'

/*
 * La cuenta de la caja que pide cada pago y cada cobro del sistema (migración
 * 20261019100000): la eligen en el formulario y la base deja ahí su movimiento.
 * Lo comparten las acciones de Tesorería, de recibos por honorarios y de la
 * planilla diaria, para que todas lean y avisen lo mismo. La devolución del
 * proveedor de una OC con boleta también entra a una cuenta (migración
 * 20261020210000).
 */

const ELIGE: Record<TipoDeLaCaja, string> = {
  pago: 'Elige la cuenta de la que salió el pago.',
  cobro: 'Elige la cuenta a la que entró el cobro.',
  devolucion: 'Elige la cuenta a la que entró la devolución.',
}

/** Los dos campos que agrega la cuenta al formulario: cuál y, si es de otra moneda, cuánto salió o entró en ella. */
export function camposDeLaCuenta(tipo: TipoDeLaCaja) {
  const verbo = tipo === 'pago' ? 'salió de' : 'entró a'
  return {
    caja_id: z.guid(ELIGE[tipo]),
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

/** Pagar o cobrar mueve una cuenta de la caja: la base pide también `tesoreria.caja`, y la acción lo exige antes. */
export const SIN_CAJA = 'Los pagos y los cobros mueven la caja diaria: los registra quien lleva la caja.'

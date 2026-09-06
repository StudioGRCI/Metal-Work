import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type PagoCliente = {
  id: string
  tipo: 'ADELANTO' | 'PARCIAL' | 'SALDO'
  fecha: string
  monto: number
  medio: string
  referencia: string | null
  observaciones: string | null
  registrado: { nombres: string; apellidos: string } | null
}

export type ResumenPagos = {
  cotizacion_id: string
  moneda: 'PEN' | 'USD'
  precio_venta: number | null
  plazo_arranca_en: string | null
  pagado: number
  saldo: number
  pagado_pct: number | null
  pagos: number
  primer_pago: string | null
}

/**
 * Lo que el cliente pagó de una cotización, y lo que falta.
 *
 * El resumen sale de la vista y no se calcula acá: el saldo y el porcentaje son
 * los mismos números que mira Tesorería en la base, y tenerlos en dos sitios es
 * tenerlos distintos el día que alguien anule un pago.
 */
export async function pagosDeCotizacion(cotizacionId: string): Promise<{
  pagos: PagoCliente[]
  resumen: ResumenPagos | null
}> {
  const supabase = await createClient()

  const [pagos, resumen] = await Promise.all([
    supabase
      .from('pagos_cliente')
      .select(
        'id, tipo, fecha, monto, medio, referencia, observaciones, registrado:usuarios(nombres, apellidos)',
      )
      .eq('cotizacion_id', cotizacionId)
      .order('fecha')
      .limit(100),
    supabase
      .from('v_pagos_cotizacion')
      .select(
        'cotizacion_id, moneda, precio_venta, plazo_arranca_en, pagado, saldo, pagado_pct, pagos, primer_pago',
      )
      .eq('cotizacion_id', cotizacionId)
      .maybeSingle(),
  ])

  if (pagos.error) throw new Error(`No se pudieron leer los pagos: ${pagos.error.message}`)

  return {
    pagos: (pagos.data ?? []) as unknown as PagoCliente[],
    resumen: (resumen.data ?? null) as unknown as ResumenPagos | null,
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * El pago del cliente lo anota quien lo recibe: Tesorería o Administración.
 * `pagos.registrar` es el mismo permiso que exige la política de
 * `pagos_cliente`, cruzado a propósito.
 *
 * Lo que pasa después no lo decide esta acción sino la base: el primer pago
 * sella el día desde el que corre el plazo y reprograma las catorce etapas de
 * la orden. Por eso acá no se escribe ninguna fecha de arranque —duplicarla
 * sería tener dos verdades— y por eso la pantalla se revalida entera.
 */
const REGLAS: Record<string, string> = {
  uq_pago_referencia: 'Ya hay un pago de esta cotización con ese número de operación.',
  pagos_cliente_monto_check: 'El monto tiene que ser mayor que cero.',
}

const esquemaPago = z.object({
  cotizacion_id: z.string().uuid(),
  tipo: z.enum(['ADELANTO', 'PARCIAL', 'SALDO']).default('ADELANTO'),
  fecha: z.string().min(1, 'Falta la fecha del pago'),
  monto: z.coerce.number().positive('El monto tiene que ser mayor que cero'),
  medio: z.enum(['TRANSFERENCIA', 'DEPOSITO', 'CHEQUE', 'EFECTIVO', 'LETRA', 'OTRO']),
  referencia: z.string().trim().optional(),
  observaciones: z.string().trim().optional(),
})

export async function registrarPago(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'pagos.registrar')) {
    return { ok: false, error: 'El pago lo registra Tesorería o Administración.' }
  }

  const analisis = esquemaPago.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del pago.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // La orden, si ya existe, para poder mirar los pagos desde la OT sin pasar
  // por la cotización. Si todavía no está —el adelanto es lo que hace que se
  // emita—, queda vacía y no pasa nada.
  const { data: orden } = await supabase
    .from('ordenes_trabajo')
    .select('id')
    .eq('cotizacion_id', v.cotizacion_id)
    .not('estado', 'in', '("ANULADA")')
    .maybeSingle()

  const { data, error } = await supabase
    .from('pagos_cliente')
    .insert({
      cotizacion_id: v.cotizacion_id,
      orden_id: orden?.id ?? null,
      tipo: v.tipo,
      fecha: v.fecha,
      monto: v.monto,
      medio: v.medio,
      referencia: v.referencia && v.referencia.length > 0 ? v.referencia : null,
      observaciones: v.observaciones && v.observaciones.length > 0 ? v.observaciones : null,
      registrado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    for (const [regla, texto] of Object.entries(REGLAS)) {
      if (error.message.includes(regla)) return { ok: false, error: texto }
    }
    return { ok: false, error: mensajeDeError(error) }
  }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  if (orden?.id) revalidatePath(`/ordenes/${orden.id}`)

  return { ok: true, mensaje: 'Pago registrado.' }
}

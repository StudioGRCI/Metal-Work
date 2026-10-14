'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Administración envía a Contabilidad la cotización aprobada que ya tiene su
 * OT, para que la facture (migración 20261015120000). Mismo permiso que
 * `enviar_cotizacion_a_contabilidad` (`cotizaciones.enviar_contabilidad`). Un
 * segundo toque no envía otra.
 */
export async function enviarCotizacionAContabilidad(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.enviar_contabilidad')) {
    return { ok: false, error: 'La cotización la envía a Contabilidad Administración.' }
  }
  const cotizacionId = z.guid().safeParse(formulario.get('cotizacion_id'))
  if (!cotizacionId.success) return { ok: false, error: 'No se pudo identificar la cotización. Recarga la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('enviar_cotizacion_a_contabilidad', { p_cotizacion: cotizacionId.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó el envío. Recarga antes de volver a intentar.' }

  revalidatePath('/cotizaciones/pdf')
  revalidatePath('/contabilidad/facturacion')
  return { ok: true, mensaje: 'Enviada a Contabilidad: le llega el aviso para facturarla.' }
}

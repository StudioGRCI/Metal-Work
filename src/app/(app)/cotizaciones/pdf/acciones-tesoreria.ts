'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const ES_UUID = z.string().uuid()

export async function liberarCotizacionATesoreria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.liberar_tesoreria')) {
    return { ok: false, error: 'La liberación de la cotización corresponde a Administración.' }
  }
  const cotizacionId = ES_UUID.safeParse(formulario.get('cotizacion_id'))
  if (!cotizacionId.success) return { ok: false, error: 'No se pudo identificar la cotización.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('liberar_cotizacion_a_tesoreria', {
    p_cotizacion: cotizacionId.data,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó la liberación. Recarga antes de volver a intentar.' }

  revalidatePath('/cotizaciones/pdf')
  revalidatePath('/tesoreria')
  return { ok: true, mensaje: 'Cotización aprobada liberada a Tesorería para su observación.' }
}

export async function registrarObservacionCotizacionTesoreria(
  _previo: unknown,
  formulario: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.ver_documentos')) {
    return { ok: false, error: 'Solo Tesorería puede registrar observaciones financieras.' }
  }
  const datos = z.object({
    cotizacion_id: z.string().uuid(),
    observacion: z.string().trim().min(3).max(2000),
  }).safeParse(Object.fromEntries(formulario))
  if (!datos.success) return { ok: false, error: 'Escribe una observación de al menos 3 caracteres (máximo 2000).' }

  const supabase = await createClient()
  const { error } = await supabase.from('cotizaciones_pdf_observaciones_tesoreria').insert({
    cotizacion_pdf_id: datos.data.cotizacion_id,
    observacion: datos.data.observacion,
    registrado_por: perfil.id,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/tesoreria')
  revalidatePath('/cotizaciones/pdf')
  return { ok: true, mensaje: 'Observación guardada en el historial de Tesorería.' }
}

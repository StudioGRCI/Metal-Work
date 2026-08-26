'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Arma la cadena de firmas de un documento. El orden de la lista es el orden en
 * que se firma: el segundo no puede decidir mientras el primero no lo haya hecho.
 */
export async function pedirFirmas(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['documentos.subir', 'documentos.aprobar'])) {
    return { ok: false, error: 'No tienes permiso para pedir la firma de un documento.' }
  }

  const analisis = z
    .object({
      documento_id: z.string().uuid(),
      aprobadores: z.string().min(1, 'Elige al menos una persona que firme'),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Elige quién firma.' }
  }

  const aprobadores = analisis.data.aprobadores.split(',').filter(Boolean)
  if (aprobadores.length === 0) return { ok: false, error: 'Elige quién firma el documento.' }
  if (new Set(aprobadores).size !== aprobadores.length) {
    return { ok: false, error: 'Una misma persona no puede firmar dos veces el mismo documento.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('solicitar_firmas', {
    p_documento: analisis.data.documento_id,
    p_aprobadores: aprobadores,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/documentos')
  revalidatePath('/firmas')
  return {
    ok: true,
    mensaje:
      aprobadores.length === 1
        ? 'Firma solicitada.'
        : `Cadena de ${aprobadores.length} firmas solicitada.`,
  }
}

/** Registra la decisión de quien firma: aprobar, observar o rechazar. */
export async function firmar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  await exigirSesion()

  const analisis = z
    .object({
      aprobacion_id: z.string().uuid(),
      estado: z.enum(['APROBADO', 'OBSERVADO', 'RECHAZADO']),
      comentario: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const v = analisis.data
  if (v.estado !== 'APROBADO' && !v.comentario?.trim()) {
    return {
      ok: false,
      error:
        v.estado === 'OBSERVADO'
          ? 'Para observar hay que decir qué está mal.'
          : 'Para rechazar hay que decir por qué.',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('firmar_documento', {
    p_aprobacion: v.aprobacion_id,
    p_estado: v.estado,
    p_comentario: v.comentario?.trim() || undefined,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/firmas')
  revalidatePath('/documentos')

  const mensaje = {
    APROBADO: 'Documento firmado.',
    OBSERVADO: 'Documento observado: vuelve a quien lo subió.',
    RECHAZADO: 'Documento rechazado.',
  }[v.estado]

  return { ok: true, mensaje }
}

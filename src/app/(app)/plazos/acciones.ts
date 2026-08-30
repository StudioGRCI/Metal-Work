'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const esquemaReporte = z.object({
  etapa_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  texto: z
    .string()
    .trim()
    .min(3, 'Escribe qué falta o qué trabó el trabajo')
    .max(2000, 'El reporte es demasiado largo'),
})

/**
 * El área reporta cómo va su etapa.
 *
 * Exige `produccion.registrar` —el mismo permiso con el que se carga un parte
 * diario— que es exactamente el que acepta la política de `ot_etapa_reportes`.
 * Si acá se pidiera otro, el INSERT afectaría cero filas, Postgres no daría
 * error y la pantalla diría «reportado» sin haber reportado nada.
 *
 * Quién escribe no viaja en el formulario: lo sella la base con la sesión.
 */
export async function reportarAvance(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para reportar el avance de tu área.' }
  }

  const analisis = esquemaReporte.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_etapa_reportes')
    .insert({ etapa_id: v.etapa_id, orden_id: v.orden_id, texto: v.texto })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) {
    return {
      ok: false,
      error: 'No se pudo guardar el reporte: no tienes esa etapa a la vista.',
    }
  }

  revalidatePath('/plazos')
  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Reporte enviado.' }
}

const esquemaVerificacion = z.object({
  reporte_id: z.string().uuid(),
})

/**
 * Administración da por leído y cierto lo que reportó el área.
 *
 * Verificar no es aprobar el trabajo: es dejar constancia de que alguien de
 * Administración lo leyó. Sin ese paso el informe semanal vuelve a ser una
 * persona recopilando a mano, que es justo de lo que se quiere salir.
 *
 * `ordenes.editar` es el permiso que exige esta acción y el que acepta la
 * política de la tabla. Y quién verifica se toma de la sesión, no del
 * formulario: mandarlo por el formulario dejaría firmar en nombre de otro.
 */
export async function verificarReporte(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.editar')) {
    return { ok: false, error: 'Solo Administración verifica los reportes de las áreas.' }
  }

  const analisis = esquemaVerificacion.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Solicitud inválida.' }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_etapa_reportes')
    .update({ verificado_por: perfil.id, verificado_en: new Date().toISOString() })
    .eq('id', analisis.data.reporte_id)
    // Un reporte ya verificado no se vuelve a verificar: el filtro hace que una
    // carrera —dos personas verificando a la vez— termine en cero filas y no en
    // una segunda firma que pisa a la primera.
    .is('verificado_en', null)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) {
    return { ok: false, error: 'Ese reporte ya estaba verificado, o no lo tienes a la vista.' }
  }

  revalidatePath('/plazos')
  return { ok: true, mensaje: 'Reporte verificado.' }
}

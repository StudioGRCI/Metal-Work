'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { compilacionDelServidor, esDeOtroDespliegue } from '@/lib/compilacion'
import { exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

type Leido = ResultadoAccion<{ otroDespliegue: boolean }>

/**
 * Pone al día la campana y la lista con lo leído, salvo en una pantalla de otro
 * despliegue (`deLaPestana`): ahí Next no repinta, recarga el documento entero,
 * y «Marcar todos leídos» se llevaba el reporte diario a medio llenar y dejaba
 * suelta su foto (trigesimoprimera pasada). Entonces lo leído lo pinta la
 * propia pestaña (`useAvisos`).
 */
function ponerAlDia(deLaPestana: unknown): Leido {
  const otroDespliegue = esDeOtroDespliegue(deLaPestana)
  if (!otroDespliegue) revalidatePath('/', 'layout')
  return { ok: true, datos: { otroDespliegue } }
}

/**
 * Marcar un aviso como leído.
 *
 * No se le pasa el usuario: la política de la tabla solo deja tocar los propios,
 * así que un identificador ajeno no encuentra fila. Se pide `select` de vuelta
 * justamente para notarlo —un UPDATE que no afecta a nadie no es un error en
 * Postgres, y sin esto la pantalla diría «listo» sin haber hecho nada—.
 */
export async function marcarAvisoLeido(id: string, deLaPestana?: string | null): Promise<Leido> {
  await exigirSesion()
  if (!z.guid().safeParse(id).success) return { ok: false, error: 'El aviso no es válido.' }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notificaciones')
    .update({ leida_en: new Date().toISOString() })
    .eq('id', id)
    .is('leida_en', null)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  // Sin fila puede ser que ya estuviera leído, que no es un fallo.
  if (!data) {
    const { data: existente, error: consultaError } = await supabase.from('notificaciones').select('id, leida_en').eq('id', id).maybeSingle()
    if (consultaError) return { ok: false, error: mensajeDeError(consultaError) }
    if (!existente?.leida_en) return { ok: false, error: 'Este aviso ya no está disponible para tu cuenta.' }
  }

  return ponerAlDia(deLaPestana)
}

/**
 * Cuántos avisos sin leer tiene esta cuenta ahora mismo, y de qué despliegue es
 * el servidor. Lo pregunta la pantalla cada minuto y al volver
 * (`RefrescoAlVolver`) para saber si vale la pena repintar, y si todavía se
 * puede: es una cuenta de cabecera, no trae filas.
 *
 * Con otro nombre que la de antes (`contarAvisosSinLeer`, que devolvía solo el
 * número): una pestaña de antes de este cambio llamaba a la misma acción, el
 * objeto siempre era distinto de su número y la recargaba entera en el primer
 * minuto. Ahora esa pestaña recibe que la acción no existe, y lo calla
 * (trigesimoprimera pasada).
 */
export async function contarAvisosYDespliegue(): Promise<{ sinLeer: number; compilacion: string | null }> {
  await exigirSesion()
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .is('leida_en', null)
  if (error) throw new Error(mensajeDeError(error))
  return { sinLeer: count ?? 0, compilacion: compilacionDelServidor() }
}

/** Todos de una vez, que es lo que se hace después de mirarlos por encima. */
export async function marcarTodosLeidos(deLaPestana?: string | null): Promise<Leido> {
  await exigirSesion()
  const supabase = await createClient()

  const { error } = await supabase
    .from('notificaciones')
    .update({ leida_en: new Date().toISOString() })
    .is('leida_en', null)

  if (error) return { ok: false, error: mensajeDeError(error) }

  return ponerAlDia(deLaPestana)
}

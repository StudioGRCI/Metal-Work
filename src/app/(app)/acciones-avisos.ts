'use server'

import { revalidatePath } from 'next/cache'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Marcar un aviso como leído.
 *
 * No se le pasa el usuario: la política de la tabla solo deja tocar los propios,
 * así que un identificador ajeno no encuentra fila. Se pide `select` de vuelta
 * justamente para notarlo —un UPDATE que no afecta a nadie no es un error en
 * Postgres, y sin esto la pantalla diría «listo» sin haber hecho nada—.
 */
export async function marcarAvisoLeido(id: string): Promise<ResultadoAccion> {
  await exigirSesion()
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
  if (!data) return { ok: true }

  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Todos de una vez, que es lo que se hace después de mirarlos por encima. */
export async function marcarTodosLeidos(): Promise<ResultadoAccion> {
  await exigirSesion()
  const supabase = await createClient()

  const { error } = await supabase
    .from('notificaciones')
    .update({ leida_en: new Date().toISOString() })
    .is('leida_en', null)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/', 'layout')
  return { ok: true }
}

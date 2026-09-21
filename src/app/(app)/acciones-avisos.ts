'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

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
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'El aviso no es válido.' }
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

  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Cuántos avisos sin leer tiene esta cuenta ahora mismo. Lo pregunta la
 * pantalla cada minuto (`RefrescoAlVolver`) para saber si vale la pena
 * repintar: es una cuenta de cabecera, no trae filas.
 */
export async function contarAvisosSinLeer(): Promise<number> {
  await exigirSesion()
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .is('leida_en', null)
  if (error) throw new Error(mensajeDeError(error))
  return count ?? 0
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

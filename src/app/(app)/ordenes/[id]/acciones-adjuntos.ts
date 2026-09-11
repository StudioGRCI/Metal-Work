'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Los archivos de la orden (migración 099): el PDF de la orden de trabajo y el
 * Excel del cronograma. El archivo viaja del navegador a Storage; acá solo se
 * anota en la orden. Los permisos son los mismos que piden la política de
 * `ot_adjuntos` y las de Storage: quien arma la hoja, la oficina que hace
 * órdenes, y quien las abre desde el taller.
 */
const PUEDEN_SUBIR = ['produccion.actividades', 'ordenes.editar', 'ordenes.crear', 'ordenes.abrir_taller']

const esquemaAdjunto = z.object({
  orden_id: z.string().uuid(),
  tipo: z.enum(['ORDEN', 'CRONOGRAMA']),
  nombre_archivo: z.string().trim().min(1).max(200),
  ruta_storage: z.string().min(1),
  mime_type: z.string().max(120).optional(),
  tamano_bytes: z.coerce.number().int().min(0).optional(),
})

export async function registrarAdjunto(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, PUEDEN_SUBIR)) {
    return { ok: false, error: 'No tienes permiso para subir archivos a la orden.' }
  }

  const analisis = esquemaAdjunto.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo leer el archivo.' }
  const v = analisis.data

  // La base lo exige con un check; acá se dice antes para que el mensaje sea claro.
  if (!v.ruta_storage.startsWith(`ot/${v.orden_id}/`)) {
    return { ok: false, error: 'Ese archivo no es de esta orden.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ot_adjuntos')
    .insert({
      orden_id: v.orden_id,
      tipo: v.tipo,
      nombre_archivo: v.nombre_archivo,
      ruta_storage: v.ruta_storage,
      mime_type: v.mime_type ?? null,
      tamano_bytes: v.tamano_bytes ?? null,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: v.tipo === 'ORDEN' ? 'PDF guardado en la orden.' : 'Excel guardado en la orden.' }
}

const esquemaQuitar = z.object({ id: z.string().uuid(), orden_id: z.string().uuid() })

/**
 * Quitar un archivo: la fila y el archivo. Primero la fila, que es la que dice
 * si se puede —la política deja a quien lo subió, a la oficina y al jefe—; el
 * archivo después, con la ruta leída antes.
 */
export async function quitarAdjunto(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  await exigirSesion()

  const analisis = esquemaQuitar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar el archivo.' }
  const v = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ot_adjuntos')
    .delete()
    .eq('id', v.id)
    .select('ruta_storage')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se pudo quitar: lo quita quien lo subió, la oficina o el jefe.' }

  await supabase.storage.from('adjuntos-ot').remove([data.ruta_storage])

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Archivo quitado.' }
}

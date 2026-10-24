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
// Diseño carga el cronograma y guarda su Excel, no el PDF de la orden (migración 20261022113000).
const PUEDEN_SUBIR_CRONOGRAMA = [...PUEDEN_SUBIR, 'diseno.planos']

const esquemaAdjunto = z.object({
  orden_id: z.guid(),
  tipo: z.enum(['ORDEN', 'CRONOGRAMA']),
  nombre_archivo: z.string().trim().min(1).max(200),
  ruta_storage: z.string().min(1),
  mime_type: z.string().max(120).optional(),
  tamano_bytes: z.coerce.number({ error: 'Falta el tamaño del archivo: vuelve a elegirlo.' }).int().min(1, 'El archivo está vacío: elige otro.'),
})

export async function registrarAdjunto(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = esquemaAdjunto.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    const vacio = analisis.error.issues.find((i) => i.path[0] === 'tamano_bytes')
    return { ok: false, error: vacio?.message ?? 'No se pudo leer el archivo.' }
  }
  const v = analisis.data

  if (!puede(perfil, v.tipo === 'CRONOGRAMA' ? PUEDEN_SUBIR_CRONOGRAMA : PUEDEN_SUBIR)) {
    return { ok: false, error: 'No tienes permiso para subir archivos a la orden.' }
  }

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
      tamano_bytes: v.tamano_bytes,
    })
    .select('id')
    .maybeSingle()

  const guardado = v.tipo === 'ORDEN' ? 'PDF guardado en la orden.' : 'Excel guardado en la orden.'
  if (error) {
    // La misma subida otra vez: la primera respuesta se perdió y la pantalla
    // preguntó de nuevo (`anotarSinDejarloSuelto`). Si su ruta —única, con un
    // uuid de esta subida— ya está anotada en esta orden, por quien sube y con
    // este archivo, quedó: se dice como la primera vez, sin duplicarla.
    if (error.code === '23505') {
      const { data: ya } = await supabase
        .from('ot_adjuntos')
        .select('orden_id, tipo, subido_por, nombre_archivo, tamano_bytes')
        .eq('ruta_storage', v.ruta_storage)
        .maybeSingle()
      if (ya && ya.orden_id === v.orden_id && ya.tipo === v.tipo && ya.subido_por === perfil.id
        && ya.nombre_archivo === v.nombre_archivo && Number(ya.tamano_bytes) === v.tamano_bytes) {
        revalidatePath(`/ordenes/${v.orden_id}`)
        return { ok: true, mensaje: guardado }
      }
    }
    return { ok: false, error: mensajeDeError(error) }
  }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: guardado }
}

const esquemaQuitar = z.object({ id: z.guid(), orden_id: z.guid() })

/**
 * Quitar un archivo: la fila y el archivo. Primero la fila, que es la que dice
 * si se puede —la política deja a quien lo subió, a la oficina y al jefe—; el
 * archivo después, con la ruta leída antes.
 */
/** `datos.archivoQuedo`: la fila se quitó pero el archivo no; la tarjeta lo avisa. */
export async function quitarAdjunto(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ archivoQuedo: boolean }>> {
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
  if (!data) return { ok: false, error: 'No se pudo quitar el archivo: verifica tus permisos y el estado de la orden.' }

  // La fila ya se fue; si el archivo no se pudo retirar se dice, en vez de
  // dejarlo suelto en el almacenamiento sin que nadie lo sepa.
  // Si la política de Storage no lo deja, no hay error: la lista sale vacía.
  const { data: retirados, error: errorArchivo } = await supabase.storage.from('adjuntos-ot').remove([data.ruta_storage])

  revalidatePath(`/ordenes/${v.orden_id}`)
  if (errorArchivo || !retirados?.length) {
    return {
      ok: true,
      mensaje: 'Se quitó de la orden, pero el archivo quedó guardado: avisa al administrador para retirarlo.',
      datos: { archivoQuedo: true },
    }
  }
  return { ok: true, mensaje: 'Archivo quitado.', datos: { archivoQuedo: false } }
}

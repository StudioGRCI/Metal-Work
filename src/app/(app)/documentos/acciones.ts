'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'

const esquemaDocumento = z.object({
  tipo_documento_id: z.string().uuid('Selecciona el tipo de documento'),
  titulo: z.string().trim().min(3, 'Ponle un título al documento'),
  descripcion: z.string().trim().optional(),
  numero_externo: z.string().trim().optional(),
  fecha_documento: z.string().optional(),
  entidad_tabla: z.string().trim().min(1),
  entidad_id: z.string().uuid(),
  orden_id: z.string().uuid().optional().or(z.literal('')),
  // Datos del archivo que el navegador ya subió a Storage.
  bucket: z.string().trim().min(1),
  ruta_storage: z.string().trim().min(1),
  nombre_archivo: z.string().trim().min(1),
  extension: z.string().trim().min(1),
  tamano_bytes: z.coerce.number().int().positive(),
  mime_type: z.string().trim().optional(),
  comentario: z.string().trim().optional(),
})

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

/**
 * Registra en la base un archivo que el navegador ya subió a Storage.
 * Se hace en dos pasos a propósito: el archivo viaja directo del navegador a
 * Storage sin pasar por el servidor de la aplicación.
 */
export async function registrarDocumento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'documentos.subir')) {
    return { ok: false, error: 'No tienes permiso para adjuntar documentos.' }
  }

  const analisis = esquemaDocumento.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data: documento, error } = await supabase
    .from('documentos')
    .insert({
      tipo_documento_id: v.tipo_documento_id,
      titulo: v.titulo,
      descripcion: nulo(v.descripcion),
      numero_externo: nulo(v.numero_externo),
      fecha_documento: nulo(v.fecha_documento),
      entidad_tabla: v.entidad_tabla,
      entidad_id: v.entidad_id,
      orden_id: nulo(v.orden_id),
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  const { error: errorVersion } = await supabase.from('documento_versiones').insert({
    documento_id: documento.id,
    bucket: v.bucket,
    ruta_storage: v.ruta_storage,
    nombre_archivo: v.nombre_archivo,
    extension: v.extension,
    tamano_bytes: v.tamano_bytes,
    mime_type: nulo(v.mime_type),
    comentario: nulo(v.comentario),
  })

  if (errorVersion) {
    // El documento quedó sin archivo: se elimina para no dejar una ficha vacía
    // que confunda al usuario y bloquee el cierre de la orden.
    await supabase.from('documentos').delete().eq('id', documento.id)
    return { ok: false, error: mensajeDeError(errorVersion) }
  }

  if (v.orden_id) revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/documentos')
  return { ok: true, mensaje: 'Documento adjuntado.' }
}

const esquemaVersion = z.object({
  documento_id: z.string().uuid(),
  orden_id: z.string().uuid().optional().or(z.literal('')),
  bucket: z.string().trim().min(1),
  ruta_storage: z.string().trim().min(1),
  nombre_archivo: z.string().trim().min(1),
  extension: z.string().trim().min(1),
  tamano_bytes: z.coerce.number().int().positive(),
  mime_type: z.string().trim().optional(),
  comentario: z.string().trim().min(3, 'Explica qué cambió en esta versión'),
})

export async function agregarVersion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'documentos.subir')) {
    return { ok: false, error: 'No tienes permiso para subir versiones.' }
  }

  const analisis = esquemaVersion.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase.from('documento_versiones').insert({
    documento_id: v.documento_id,
    bucket: v.bucket,
    ruta_storage: v.ruta_storage,
    nombre_archivo: v.nombre_archivo,
    extension: v.extension,
    tamano_bytes: v.tamano_bytes,
    mime_type: nulo(v.mime_type),
    comentario: v.comentario,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  if (v.orden_id) revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/documentos')
  return { ok: true, mensaje: 'Nueva versión registrada.' }
}

/**
 * Devuelve una URL temporal para descargar un archivo privado y deja constancia
 * del acceso, que es parte de la trazabilidad documental.
 */
export async function urlDeDescarga(
  bucket: string,
  ruta: string,
  documentoId?: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'documentos.ver')) {
    return { ok: false, error: 'No tienes permiso para descargar documentos.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, 300)

  if (error || !data) {
    return { ok: false, error: 'No se pudo generar el enlace de descarga.' }
  }

  if (documentoId) {
    await supabase.rpc('registrar_acceso_documento', {
      p_documento_id: documentoId,
      p_tipo_acceso: 'DESCARGA',
    })
  }

  return { ok: true, url: data.signedUrl }
}

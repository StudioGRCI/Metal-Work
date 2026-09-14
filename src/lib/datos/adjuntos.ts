import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type Adjunto = {
  id: string
  orden_id: string
  tipo: 'ORDEN' | 'CRONOGRAMA'
  nombre_archivo: string
  ruta_storage: string
  mime_type: string | null
  tamano_bytes: number | null
  subido_por: string | null
  creado_en: string
  /** Enlace temporal para abrirlo: el bucket es privado. */
  url: string | null
}

/**
 * Los archivos de una orden —el PDF de la orden y el Excel del cronograma—, el
 * más reciente primero, cada uno con su enlace para abrirlo (migración 099).
 */
export async function adjuntosDeOrden(ordenId: string): Promise<Adjunto[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ot_adjuntos')
    .select('id, orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, creado_en')
    .eq('orden_id', ordenId)
    .order('creado_en', { ascending: false })
    .limit(50)

  if (error) throw new Error(`No se pudieron leer los archivos de la orden: ${error.message}`)
  const filas = data ?? []
  if (filas.length === 0) return []

  // Sin enlaces la lista igual sirve: se ve qué hay aunque no se pueda abrir.
  const { data: firmados } = await supabase.storage
    .from('adjuntos-ot')
    .createSignedUrls(
      filas.map((f) => f.ruta_storage),
      600,
    )
  const enlaces = new Map((firmados ?? []).map((f) => [f.path, f.signedUrl]))

  return filas.map((f) => ({
    ...f,
    tipo: f.tipo as Adjunto['tipo'],
    url: enlaces.get(f.ruta_storage) ?? null,
  }))
}

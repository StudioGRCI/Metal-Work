import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Vistas } from '@/types/database'

export type DocumentoCompraTesoreria = Vistas<'v_documentos_compra_tesoreria'> & {
  url: string | null
}

/** Archivos de compra visibles para Tesorería y Logística, con enlaces temporales. */
export async function documentosDeCompraParaTesoreria(): Promise<DocumentoCompraTesoreria[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_documentos_compra_tesoreria')
    .select('id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, creado_en, proveedor, referencia, fecha_estimada, orden_id, numero_ot, area_destino')
    .order('creado_en', { ascending: false })
    .limit(500)

  if (error) throw new Error(`No se pudieron cargar los documentos de compras: ${error.message}`)
  const documentos = data ?? []
  const rutas = documentos.flatMap((d) => d.ruta_storage ? [d.ruta_storage] : [])
  const urls = new Map<string, string>()
  if (rutas.length > 0) {
    const { data: enlaces, error: errorEnlaces } = await supabase
      .storage.from('documentos-compras').createSignedUrls(rutas, 600)
    if (errorEnlaces) throw new Error('No se pudieron preparar los enlaces temporales de los documentos. Recarga la página para volver a intentar.')
    for (const enlace of enlaces ?? []) {
      if (enlace.path && enlace.signedUrl) urls.set(enlace.path, enlace.signedUrl)
    }
  }

  return documentos.map((d) => ({ ...d, url: d.ruta_storage ? urls.get(d.ruta_storage) ?? null : null }))
}

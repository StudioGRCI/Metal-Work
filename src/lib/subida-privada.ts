import type { ResultadoAccion } from '@/lib/acciones'
import { createClient } from '@/lib/supabase/client'

/** El archivo nunca viaja dentro de una Server Action. La acción recibe solo
 * metadatos y valida el objeto antes de enlazarlo al documento de negocio. */
export async function subirArchivoPrivado({ bucket, ruta, archivo, contentType, registrar }: {
  bucket: string
  ruta: string
  archivo: File
  contentType: string
  registrar: () => Promise<ResultadoAccion>
}): Promise<ResultadoAccion> {
  const supabase = createClient()
  try {
    const { error } = await supabase.storage.from(bucket).upload(ruta, archivo, { contentType, upsert: false })
    // La misma ruta permite reintentar una carga cuyo resultado no llegó.
    // El servidor comprueba el objeto; no se sobrescribe un archivo existente.
    if (error && error.statusCode !== '409') {
      return { ok: false, error: 'No se pudo cargar el archivo. Revisa tu conexión y vuelve a intentar.' }
    }
    const resultado = await registrar()
    if (!resultado.ok) {
      const { error: limpieza } = await supabase.storage.from(bucket).remove([ruta])
      if (limpieza) return { ok: false, error: `${resultado.error} El archivo no se pudo retirar; vuelve a cargar la pantalla antes de reintentar.` }
    }
    return resultado
  } catch {
    // Una respuesta perdida puede haber registrado el documento. No borrar
    // a ciegas: el reintento con el mismo ID confirma el resultado guardado.
    return { ok: false, error: 'No se confirmó el registro. Conserva el archivo seleccionado y vuelve a intentar; no se duplicará.' }
  }
}

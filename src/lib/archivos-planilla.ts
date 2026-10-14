import type { ResultadoAccion } from '@/lib/acciones'
import { BUCKET_PLANILLA_DIARIA, MAXIMO_MB_PLANILLA, TIPOS_ARCHIVO_PLANILLA } from '@/lib/dominio/planilla-diaria'
import { createClient } from '@/lib/supabase/client'

/**
 * Subir un comprobante de pago o una boleta de la planilla diaria, desde el
 * navegador (migración 20261014202000).
 *
 * El archivo va directo a Storage —bucket `planilla-diaria`, ruta
 * `{planilla}/{archivo}`, que es de donde la política saca de qué planilla es—
 * y después `anotar` lo registra con la ruta. Si la anotación falla, o se cae
 * por el camino, el archivo se quita: un archivo que ninguna fila nombra no lo
 * ve nadie y no lo borra nadie (ver `src/lib/adjuntos.ts`).
 */
export async function subirArchivoPlanilla(
  planillaId: string,
  archivo: File,
  anotar: (ruta: string) => Promise<ResultadoAccion>,
): Promise<ResultadoAccion> {
  const extension = TIPOS_ARCHIVO_PLANILLA[archivo.type]
  if (!extension) return { ok: false, error: 'Adjunta un PDF o una foto (JPG, PNG o WEBP).' }
  if (archivo.size > MAXIMO_MB_PLANILLA * 1024 * 1024) return { ok: false, error: `El archivo pesa más de ${MAXIMO_MB_PLANILLA} MB.` }

  const ruta = `${planillaId}/${crypto.randomUUID()}.${extension}`
  const supabase = createClient()
  const { error } = await supabase.storage.from(BUCKET_PLANILLA_DIARIA).upload(ruta, archivo, { contentType: archivo.type, upsert: false })
  if (error) return { ok: false, error: 'No se pudo subir el archivo. Revisa la señal y vuelve a intentar.' }

  try {
    const resultado = await anotar(ruta)
    if (!resultado.ok) await supabase.storage.from(BUCKET_PLANILLA_DIARIA).remove([ruta])
    return resultado
  } catch {
    await supabase.storage.from(BUCKET_PLANILLA_DIARIA).remove([ruta])
    return { ok: false, error: 'No se pudo registrar el archivo. Vuelve a intentar.' }
  }
}

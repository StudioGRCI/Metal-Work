import { motivoDeSubida, type ResultadoAccion } from '@/lib/acciones'
import { MAXIMO_MB_FINANZAS } from '@/lib/dominio/finanzas'
import { createClient } from '@/lib/supabase/client'

/**
 * Subir la factura de venta (Contabilidad) o el comprobante de un pago de
 * servicio (Tesorería), desde el navegador (migración 20261015120000).
 *
 * El archivo va directo a Storage, a `{carpeta}/{archivo}.{extensión}`: la
 * carpeta es el id de la factura o de la orden de servicio, y la base comprueba
 * que el archivo esté ahí, que sea de quien lo anota y de qué tipo es. Después
 * `anotar` lo registra con la ruta. Si la base dice que no, el archivo se
 * quita: un archivo que ninguna fila nombra no lo ve nadie y no lo borra nadie.
 * Si no llega la respuesta, no se toca: la fila pudo entrar, y quitarlo la
 * dejaría nombrando un archivo que no existe (ver `src/lib/adjuntos.ts`).
 */
export async function subirArchivoFinanzas(
  bucket: string,
  carpeta: string,
  archivo: File,
  tipos: Record<string, string>,
  anotar: (ruta: string) => Promise<ResultadoAccion>,
): Promise<ResultadoAccion> {
  const extension = tipos[archivo.type]
  if (!extension) {
    return { ok: false, error: Object.keys(tipos).length === 1 ? 'Adjunta el PDF.' : 'Adjunta un PDF o una foto (JPG, PNG o WEBP).' }
  }
  if (archivo.size > MAXIMO_MB_FINANZAS * 1024 * 1024) return { ok: false, error: `El archivo pesa más de ${MAXIMO_MB_FINANZAS} MB.` }

  const ruta = `${carpeta}/${crypto.randomUUID()}.${extension}`
  const supabase = createClient()
  const { error } = await supabase.storage.from(bucket).upload(ruta, archivo, { contentType: archivo.type, upsert: false })
  if (error) return { ok: false, error: `No se pudo subir el archivo. ${motivoDeSubida(error)}` }

  try {
    const resultado = await anotar(ruta)
    if (!resultado.ok) await supabase.storage.from(bucket).remove([ruta])
    return resultado
  } catch {
    return { ok: false, error: 'No llegó la respuesta. Recarga la pantalla y mira si quedó registrado antes de volver a intentar.' }
  }
}

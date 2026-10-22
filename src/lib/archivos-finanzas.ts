import { motivoDeSubida, type ResultadoAccion } from '@/lib/acciones'
import { MAXIMO_MB_FINANZAS } from '@/lib/dominio/finanzas'
import { SIN_RESPUESTA } from '@/lib/envio'
import { subirARutaNueva } from '@/lib/ruta-nueva'
import { createClient } from '@/lib/supabase/client'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'

/**
 * Subir la factura de venta (Contabilidad) o el comprobante de un pago de
 * servicio (Tesorería), desde el navegador (migración 20261015120000).
 *
 * El archivo va directo a Storage, a `{carpeta}/{archivo}.{extensión}`: la
 * carpeta es el id de la factura o de la orden de servicio, y la base comprueba
 * que el archivo esté ahí, que sea de quien lo anota y de qué tipo es. Después
 * `anotar` lo registra con la ruta. Si la base dice que no, el archivo se
 * quita: un archivo que ninguna fila nombra no lo ve nadie y no lo borra nadie.
 * Si no llega la respuesta, se pregunta otra vez y solo se quita si sigue
 * suelto (ver `anotarSinDejarloSuelto`): la fila pudo entrar.
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
  if (archivo.size === 0) return { ok: false, error: 'El archivo está vacío: elige otro.' }
  if (archivo.size > MAXIMO_MB_FINANZAS * 1024 * 1024) return { ok: false, error: `El archivo pesa más de ${MAXIMO_MB_FINANZAS} MB.` }

  const ruta = `${carpeta}/${crypto.randomUUID()}.${extension}`
  const supabase = createClient()
  const { error } = await subirARutaNueva(supabase.storage.from(bucket), ruta, archivo, archivo.type)
  if (error) return { ok: false, error: `No se pudo subir el archivo. ${motivoDeSubida(error)}` }

  return anotarSinDejarloSuelto({
    bucket,
    ruta,
    anotar: () => anotar(ruta),
    sinRespuesta: SIN_RESPUESTA,
  })
}

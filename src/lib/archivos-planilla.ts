import { motivoDeSubida, type ResultadoAccion } from '@/lib/acciones'
import { BUCKET_PLANILLA_DIARIA, MAXIMO_MB_PLANILLA, TIPOS_ARCHIVO_PLANILLA } from '@/lib/dominio/planilla-diaria'
import { seguirConLaCuentaDeLaPestana, SIN_RESPUESTA } from '@/lib/envio'
import { subirARutaNueva } from '@/lib/ruta-nueva'
import { createClient } from '@/lib/supabase/client'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'

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
  if (archivo.size === 0) return { ok: false, error: 'El archivo está vacío: elige otro.' }
  if (archivo.size > MAXIMO_MB_PLANILLA * 1024 * 1024) return { ok: false, error: `El archivo pesa más de ${MAXIMO_MB_PLANILLA} MB.` }

  const ruta = `${planillaId}/${crypto.randomUUID()}.${extension}`
  const supabase = createClient()
  // La cadena pudo empezar con la cuenta de la pantalla y llegar aquí con la
  // de otra pestaña: el archivo saldría a su nombre (`seguirConLaCuentaDeLaPestana`).
  seguirConLaCuentaDeLaPestana()
  const { error } = await subirARutaNueva(supabase.storage.from(BUCKET_PLANILLA_DIARIA), ruta, archivo, archivo.type)
  if (error) {
    // Un rechazo con la sesión de otra cuenta no es «No tienes permiso»: es el corte.
    seguirConLaCuentaDeLaPestana()
    return { ok: false, error: `No se pudo subir el archivo. ${motivoDeSubida(error)}` }
  }

  // Sin respuesta, antes se quitaba a ciegas: si la fila había entrado, la
  // política no lo dejaba, pero la pantalla decía «No se pudo registrar».
  return anotarSinDejarloSuelto({
    bucket: BUCKET_PLANILLA_DIARIA,
    ruta,
    anotar: () => anotar(ruta),
    sinRespuesta: SIN_RESPUESTA,
  })
}

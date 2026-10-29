import { motivoDeSubida, type ResultadoAccion } from '@/lib/acciones'
import { BUCKET_SUBCONTRATOS, MAXIMO_MB_SUBCONTRATOS, TIPOS_ARCHIVO_SUBCONTRATOS } from '@/lib/dominio/subcontratos'
import { laPestanaEsDeLaVersionAnterior, quitarConLaCuenta, SE_ACTUALIZO_EL_SISTEMA, seguirConLaCuentaDeLaPestana, SIN_RESPUESTA } from '@/lib/envio'
import { subirARutaNueva } from '@/lib/ruta-nueva'
import { createClient } from '@/lib/supabase/client'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'

/**
 * Subir un recibo por honorarios (Administración) o un voucher de pago
 * (Tesorería), desde el navegador (migración 20261015221000).
 *
 * El archivo va directo a Storage —bucket `subcontratos`, ruta
 * `{subcontrato}/{archivo}`, que es de donde la política saca de qué
 * subcontrato es— y después `anotar` lo registra con la ruta. Si la anotación
 * falla, o se cae por el camino, el archivo se quita: un archivo que ninguna
 * fila nombra no lo ve nadie y no lo borra nadie (ver `src/lib/adjuntos.ts`).
 */
export async function subirArchivoSubcontrato(
  subcontratoId: string,
  archivo: File,
  anotar: (ruta: string) => Promise<ResultadoAccion>,
): Promise<ResultadoAccion> {
  const extension = TIPOS_ARCHIVO_SUBCONTRATOS[archivo.type]
  if (!extension) return { ok: false, error: 'Adjunta un PDF o una foto (JPG, PNG o WEBP).' }
  if (archivo.size === 0) return { ok: false, error: 'El archivo está vacío: elige otro.' }
  if (archivo.size > MAXIMO_MB_SUBCONTRATOS * 1024 * 1024) return { ok: false, error: `El archivo pesa más de ${MAXIMO_MB_SUBCONTRATOS} MB.` }

  const ruta = `${subcontratoId}/${crypto.randomUUID()}.${extension}`
  const supabase = createClient()
  // La cadena pudo empezar con la cuenta de la pantalla y llegar aquí con la
  // de otra pestaña: el archivo saldría a su nombre (`seguirConLaCuentaDeLaPestana`).
  seguirConLaCuentaDeLaPestana()
  // La pestaña ya se sabe de antes del último despliegue: la acción que lo
  // anotaría no va a entrar, así que ni se sube (trigésima pasada).
  if (laPestanaEsDeLaVersionAnterior()) return { ok: false, error: SE_ACTUALIZO_EL_SISTEMA }
  const { error } = await subirARutaNueva(supabase.storage.from(BUCKET_SUBCONTRATOS), ruta, archivo, archivo.type, quitarConLaCuenta)
  if (error) {
    // Un rechazo con la sesión de otra cuenta no es «No tienes permiso»: es el corte.
    seguirConLaCuentaDeLaPestana()
    return { ok: false, error: `No se pudo subir el archivo. ${motivoDeSubida(error)}` }
  }

  // Sin respuesta, antes se quitaba a ciegas: si la fila había entrado, la
  // política no lo dejaba, pero la pantalla decía «No se pudo registrar».
  return anotarSinDejarloSuelto({
    bucket: BUCKET_SUBCONTRATOS,
    ruta,
    anotar: () => anotar(ruta),
    sinRespuesta: SIN_RESPUESTA,
  })
}

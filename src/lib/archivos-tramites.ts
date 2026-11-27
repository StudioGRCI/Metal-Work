import { motivoDeSubida, type ResultadoAccion } from '@/lib/acciones'
import { BUCKET_TRAMITES, MAXIMO_MB_TRAMITES, TIPOS_ARCHIVO_TRAMITES } from '@/lib/dominio/tramites'
import { laPestanaEsDeLaVersionAnterior, quitarConLaCuenta, SE_ACTUALIZO_EL_SISTEMA, seguirConLaCuentaDeLaPestana, SIN_RESPUESTA } from '@/lib/envio'
import { subirARutaNueva } from '@/lib/ruta-nueva'
import { createClient } from '@/lib/supabase/client'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'

/**
 * Subir un archivo al expediente de un trámite —el cargo, un recibo, otro
 * documento o el documento final que lo cierra—, desde el navegador (migración
 * 20261127002000).
 *
 * El archivo va directo a Storage —bucket `tramites`, ruta
 * `{trámite}/{archivo}`, que es de donde la política saca de qué trámite es— y
 * después `anotar` lo registra con la ruta. Si la anotación falla, el archivo se
 * quita: un archivo que ninguna fila nombra no lo ve nadie y no lo borra nadie.
 * Si no llega la respuesta, se pregunta otra vez y solo se quita si sigue suelto
 * (`anotarSinDejarloSuelto`): la fila pudo entrar.
 */
export async function subirArchivoTramite(
  tramiteId: string,
  archivo: File,
  anotar: (ruta: string) => Promise<ResultadoAccion>,
): Promise<ResultadoAccion> {
  const extension = TIPOS_ARCHIVO_TRAMITES[archivo.type]
  if (!extension) return { ok: false, error: 'Adjunta un PDF o una foto (JPG, PNG o WEBP).' }
  if (archivo.size === 0) return { ok: false, error: 'El archivo está vacío: elige otro.' }
  if (archivo.size > MAXIMO_MB_TRAMITES * 1024 * 1024) return { ok: false, error: `El archivo pesa más de ${MAXIMO_MB_TRAMITES} MB.` }

  const ruta = `${tramiteId}/${crypto.randomUUID()}.${extension}`
  const supabase = createClient()
  // La cadena pudo empezar con la cuenta de la pantalla y llegar aquí con la
  // de otra pestaña: el archivo saldría a su nombre (`seguirConLaCuentaDeLaPestana`).
  seguirConLaCuentaDeLaPestana()
  // La pestaña ya se sabe de antes del último despliegue: la acción que lo
  // anotaría no va a entrar, así que ni se sube.
  if (laPestanaEsDeLaVersionAnterior()) return { ok: false, error: SE_ACTUALIZO_EL_SISTEMA }
  const { error } = await subirARutaNueva(supabase.storage.from(BUCKET_TRAMITES), ruta, archivo, archivo.type, quitarConLaCuenta)
  if (error) {
    // Un rechazo con la sesión de otra cuenta no es «No tienes permiso»: es el corte.
    seguirConLaCuentaDeLaPestana()
    // Quien llegó a esta ventana lleva los trámites: si la política no lo deja
    // subir, lo más probable es que el trámite se anuló con la ficha abierta.
    if (/row-level security|permission|unauthorized|not allowed/i.test(error.message)) {
      return { ok: false, error: 'No se pudo subir el archivo: el trámite cambió (pudo anularse) o tu cuenta ya no lleva los trámites. Recarga la ficha.' }
    }
    return { ok: false, error: `No se pudo subir el archivo. ${motivoDeSubida(error)}` }
  }

  return anotarSinDejarloSuelto({
    bucket: BUCKET_TRAMITES,
    ruta,
    anotar: () => anotar(ruta),
    sinRespuesta: SIN_RESPUESTA,
  })
}

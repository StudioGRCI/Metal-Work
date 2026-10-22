import { motivoDeSubida, type ResultadoAccion } from '@/lib/acciones'
import { createClient } from '@/lib/supabase/client'

/** Con esto empieza el error cuando lo que falló es el archivo y no el registro: la pantalla lo pone en su campo. */
export const NO_SE_CARGO_EL_ARCHIVO = 'No se pudo cargar el archivo.'

/** Sin respuesta dos veces, y el archivo ya no estaba suelto: ninguna fila lo nombraba, así que no quedó. */
export const NO_QUEDO_SIN_RESPUESTA = 'No quedó registrado: no llegó la respuesta. Vuelve a intentar.'

/** Lo que dice `subirArchivoPrivado` cuando no se sabe si quedó: en la misma ventana, el reintento no duplica. */
export const NO_SE_CONFIRMO = 'No se confirmó el registro. Conserva el archivo seleccionado y vuelve a intentar; no se duplicará.'

/** Después de una respuesta perdida se eligió otro archivo, y en Storage puede estar el primero. */
export const OTRO_ARCHIVO_EN_LA_RUTA =
  'Con este formulario ya se subió otro archivo y no se sabe si quedó: recarga la pantalla y mira si está antes de volver a intentar.'

/** Lo que se espera antes de preguntar otra vez: lo justo para que un corte breve pase. */
const PAUSA_ANTES_DE_PREGUNTAR_MS = 1500

/**
 * Anotar en la base un archivo que el navegador ya subió a Storage, sin que
 * quede suelto. Si la base dice que no, el archivo se quita. Si la respuesta
 * no llega, la fila pudo entrar o no: se pregunta otra vez con la misma ruta.
 * Si la primera entró, la ruta —única en cada tabla— o el mismo id no dejan
 * duplicarla; si no entró, entra ahora. Si ni así hay un sí, se intenta quitar
 * el archivo: la política de cada bucket deja quitar solo el que ninguna fila
 * nombra (`…_quitar_suelto`), así que el anotado se queda y el suelto se va.
 * Antes, sin respuesta, unas pantallas lo dejaban suelto para siempre y otras
 * lo quitaban a ciegas.
 *
 * `sinRespuesta` es lo que se dice cuando no se pudo saber: el archivo sigue
 * ahí porque una fila lo nombra o porque no hubo señal ni para quitarlo.
 * `siNoSeRetira` se suma al rechazo de la base cuando el archivo no se pudo
 * quitar.
 */
export async function anotarSinDejarloSuelto<T = never>({
  bucket,
  ruta,
  anotar,
  sinRespuesta,
  siNoSeRetira,
}: {
  bucket: string
  ruta: string
  anotar: () => Promise<ResultadoAccion<T>>
  sinRespuesta: string
  siNoSeRetira?: string
}): Promise<ResultadoAccion<T>> {
  const supabase = createClient()
  // Un archivo que la política no deja quitar vuelve sin error y sin nada
  // quitado: por eso se cuenta lo que volvió.
  const quitarSiSuelto = async (): Promise<'quitado' | 'se queda' | 'sin respuesta'> => {
    try {
      const { data, error } = await supabase.storage.from(bucket).remove([ruta])
      if (error) return 'sin respuesta'
      return (data?.length ?? 0) > 0 ? 'quitado' : 'se queda'
    } catch {
      return 'sin respuesta'
    }
  }

  let primera: ResultadoAccion<T>
  try {
    primera = await anotar()
  } catch {
    await new Promise((listo) => setTimeout(listo, PAUSA_ANTES_DE_PREGUNTAR_MS))
    let otraVez: ResultadoAccion<T> | null
    try {
      otraVez = await anotar()
    } catch {
      otraVez = null
    }
    if (otraVez?.ok) return otraVez
    // Quitado quiere decir que ninguna fila lo nombraba: no quedó, y lo que
    // dijo la base la segunda vez es el motivo de verdad.
    if ((await quitarSiSuelto()) === 'quitado') return otraVez ?? { ok: false, error: NO_QUEDO_SIN_RESPUESTA }
    return { ok: false, error: sinRespuesta }
  }
  // Si una subida de adentro ya dijo que no se sabe, o que no se pudo retirar,
  // no se repite ni se le contradice («vuelve a cargar» cambiaría el id).
  const yaLoDijo = !primera.ok && [sinRespuesta, siNoSeRetira].some((t) => t && primera.error.includes(t))
  if (!primera.ok && (await quitarSiSuelto()) === 'sin respuesta' && siNoSeRetira && !yaLoDijo) {
    return { ok: false, error: `${primera.error} ${siNoSeRetira}` }
  }
  return primera
}

// Qué archivo intentó subir esta pestaña a cada ruta. La ruta sale del id del
// formulario, así que un 409 es el mismo envío repetido... salvo que, después de
// una respuesta perdida, se haya elegido otro archivo: ese no es el que está en
// Storage, y anotarlo confirmaría un archivo que no es el elegido.
const intentados = new Map<string, string>()
const huellaDe = (archivo: File) => `${archivo.name}|${archivo.size}|${archivo.lastModified}`

/** El archivo nunca viaja dentro de una Server Action. La acción recibe solo
 * metadatos y valida el objeto antes de enlazarlo al documento de negocio. */
export async function subirArchivoPrivado({ bucket, ruta, archivo, contentType, registrar }: {
  bucket: string
  ruta: string
  archivo: File
  contentType: string
  registrar: () => Promise<ResultadoAccion>
}): Promise<ResultadoAccion> {
  // Una respuesta perdida puede haber registrado el documento: el reintento
  // con el mismo ID confirma el resultado guardado.
  const sinRespuesta = NO_SE_CONFIRMO
  const supabase = createClient()
  const clave = `${bucket}/${ruta}`
  const antes = intentados.get(clave)
  if (!antes) intentados.set(clave, huellaDe(archivo))
  try {
    const { error } = await supabase.storage.from(bucket).upload(ruta, archivo, { contentType, upsert: false })
    if (!error) intentados.set(clave, huellaDe(archivo))
    // La misma ruta permite reintentar una carga cuyo resultado no llegó.
    // El servidor comprueba el objeto; no se sobrescribe un archivo existente.
    if (error && error.statusCode !== '409') {
      return { ok: false, error: `${NO_SE_CARGO_EL_ARCHIVO} ${motivoDeSubida(error)}` }
    }
    if (error && antes && antes !== huellaDe(archivo)) {
      return { ok: false, error: OTRO_ARCHIVO_EN_LA_RUTA }
    }
  } catch {
    return { ok: false, error: sinRespuesta }
  }
  return anotarSinDejarloSuelto({
    bucket,
    ruta,
    anotar: registrar,
    sinRespuesta,
    siNoSeRetira: 'El archivo no se pudo retirar; vuelve a cargar la pantalla antes de reintentar.',
  })
}

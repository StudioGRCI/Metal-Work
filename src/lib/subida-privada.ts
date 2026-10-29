import { motivoDeSubida, type ResultadoAccion } from '@/lib/acciones'
import { cuandoVuelvaLaCuenta, laPestanaEsDeOtraCuenta, OtraCuentaEnLaPestana, seguirConLaCuentaDeLaPestana } from '@/lib/envio'
import { noGuardoNada } from '@/lib/ruta-nueva'
import { createClient } from '@/lib/supabase/client'

/** Con esto empieza el error cuando lo que falló es el archivo y no el registro: la pantalla lo pone en su campo. */
export const NO_SE_CARGO_EL_ARCHIVO = 'No se pudo cargar el archivo.'

/** Sin respuesta dos veces, y el archivo ya no estaba suelto: ninguna fila lo nombraba, así que no quedó. */
export const NO_QUEDO_SIN_RESPUESTA = 'No quedó registrado: no llegó la respuesta. Vuelve a intentar.'

/**
 * Lo que dice `subirArchivoPrivado` cuando no se sabe si quedó: en la misma
 * ventana y con el mismo archivo, el reintento no duplica, y si trae otra cosa
 * la base dice que ya quedó. Empieza como `SIN_RESPUESTA`: era una tercera
 * frase para lo mismo (decimotercera pasada).
 */
export const NO_SE_CONFIRMO = 'No llegó la respuesta. Vuelve a intentar ahora, con el mismo archivo: si ya había quedado, no se duplica.'

// Sin «desde esta ventana»: el plano de Diseño se carga sin ventana (decimoquinta pasada).
const YA_SE_SUBIO = 'Antes ya se subió '

/**
 * Después de una respuesta perdida se eligió otro archivo, y en Storage sigue
 * el primero: una fila lo nombra (quedó), o no hubo señal para quitarlo. Si
 * quedó, es un «ya quedó» como los de la base (`yaEntroLaPrimeraVez`): la
 * ventana ofrece solo «Cerrar» y el envío siguiente lleva otro id. Antes el id
 * se quedaba y cada documento siguiente de la compra volvía a esa ruta.
 */
export function otroArchivoEnLaRuta(nombre: string, quedo: boolean) {
  return quedo
    ? `${YA_SE_SUBIO}${nombre} y quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.`
    : `${YA_SE_SUBIO}${nombre} y no se sabe si quedó: recarga la pantalla y mira si está antes de volver a intentar.`
}

export const esOtroArchivoEnLaRuta = (error: string) => error.startsWith(YA_SE_SUBIO)

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
  alQuitarlo,
}: {
  bucket: string
  ruta: string
  anotar: () => Promise<ResultadoAccion<T>>
  sinRespuesta: string
  siNoSeRetira?: string
  /** Se llama cuando el archivo se quitó: quien sube recuerda que la ruta quedó vacía. */
  alQuitarlo?: () => void
}): Promise<ResultadoAccion<T>> {
  const supabase = createClient()
  // Un archivo que la política no deja quitar vuelve sin error y sin nada
  // quitado: por eso se cuenta lo que volvió.
  const quitarSiSuelto = async (): Promise<'quitado' | 'se queda' | 'sin respuesta'> => {
    // Con la sesión de otra cuenta el borrado vuelve vacío, como si una fila lo nombrara.
    if (laPestanaEsDeOtraCuenta()) return 'sin respuesta'
    try {
      const { data, error } = await supabase.storage.from(bucket).remove([ruta])
      if (error) return 'sin respuesta'
      if ((data?.length ?? 0) === 0) return 'se queda'
      alQuitarlo?.()
      return 'quitado'
    } catch {
      return 'sin respuesta'
    }
  }

  // La sesión cambió en otra pestaña mientras el archivo subía: lo que se anote
  // ahora entraría a nombre de la otra cuenta, y Storage no la deja quitar el
  // archivo de esta. No se anota, y el archivo se quita si vuelve la cuenta de
  // la pantalla (vigesimotercera pasada).
  if (laPestanaEsDeOtraCuenta()) {
    cuandoVuelvaLaCuenta(() => void quitarSiSuelto())
    seguirConLaCuentaDeLaPestana()
  }
  let primera: ResultadoAccion<T>
  try {
    primera = await anotar()
  } catch {
    await new Promise((listo) => setTimeout(listo, PAUSA_ANTES_DE_PREGUNTAR_MS))
    // En la pausa entró otra cuenta: no se pregunta con ella, y no se sabe si la
    // primera quedó. El archivo se mira cuando vuelva la cuenta de la pantalla:
    // Storage solo deja quitar el que ninguna fila nombra, así que si la primera
    // quedó, se queda. Antes se quedaba suelto para siempre (vigesimoquinta pasada).
    if (laPestanaEsDeOtraCuenta()) {
      cuandoVuelvaLaCuenta(() => void quitarSiSuelto())
      return { ok: false, error: sinRespuesta }
    }
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

// Qué archivo subió esta pestaña a cada ruta, según la última respuesta de
// Storage. La ruta sale del id del formulario, así que un 409 es el mismo envío
// repetido... salvo que, después de una respuesta perdida, se haya elegido otro
// archivo: ese no es el que está en Storage, y anotarlo confirmaría un archivo
// que no es el elegido.
const intentados = new Map<string, { huella: string; nombre: string }>()
// El último archivo que Storage dio por subido en cada ruta. Una vez que una
// fila nombra la ruta, ahí no entra otro: si la fila nombra algo, es ese.
const confirmados = new Map<string, { huella: string; nombre: string }>()
// Las rutas que esta pestaña sabe vacías: quitó lo que había (el borrado lo
// devolvió) o Storage rechazó la subida a una ruta que ya estaba vacía, y no
// intentó otra desde entonces. Rechazó es un 4xx que no es el 409: un 5xx (la
// pasarela que no esperó, un 502 o un 504) puede llegar con el archivo ya
// guardado detrás. Un borrado que vuelve vacío no distingue «una
// fila lo nombra» de «no hay nada»: esto sí.
const vacias = new Set<string>()
// La última ruta de cada documento, que es la ruta sin su extensión: el mismo
// documento con otro tipo de archivo (un contrato en PDF y después en foto) va
// a otra ruta, y el de antes quedaba suelto en la suya. La memoria de cada ruta
// sigue aparte: si se vuelve a la primera, lo que hay ahí es lo que se recuerda.
const rutaDelDocumento = new Map<string, string>()
// Las rutas de otro tipo de cada documento que una fila nombraba cuando se
// intentó quitarlas: el borrado volvió vacío y Storage las había dado por
// subidas (`confirmados`), así que no es que no hubiera nada. Si después la
// acción cambia la ruta del documento (la caja reemplaza su captura), se
// vuelven a quitar tras el ok, aunque llegue en otro envío que el del cambio de
// tipo.
const porQuitarTrasOk = new Map<string, Set<string>>()
const huellaDe = (archivo: File) => `${archivo.name}|${archivo.size}|${archivo.lastModified}`

/** El archivo nunca viaja dentro de una Server Action. La acción recibe solo
 * metadatos y valida el objeto antes de enlazarlo al documento de negocio. */
export async function subirArchivoPrivado<T = never>({ bucket, ruta, archivo, contentType, registrar }: {
  bucket: string
  ruta: string
  archivo: File
  contentType: string
  registrar: () => Promise<ResultadoAccion<T>>
}): Promise<ResultadoAccion<T>> {
  // Una respuesta perdida puede haber registrado el documento: el reintento
  // con el mismo ID confirma el resultado guardado.
  const sinRespuesta = NO_SE_CONFIRMO
  // Antes de tocar Storage: la cadena pudo empezar con la cuenta de la pantalla
  // y llegar aquí con la de otra pestaña.
  seguirConLaCuentaDeLaPestana()
  const supabase = createClient()
  const clave = `${bucket}/${ruta}`
  const documento = `${bucket}/${ruta.replace(/\.[^./]+$/, '')}`
  const este = { huella: huellaDe(archivo), nombre: archivo.name }
  const subir = () => supabase.storage.from(bucket).upload(ruta, archivo, { contentType, upsert: false })
  const antes = intentados.get(clave)
  // Hasta que Storage conteste, no se sabe qué hay en la ruta: lo recordado no
  // coincide con ningún archivo, así el próximo 409 pasa por el reemplazo y no
  // anota un nombre con otro archivo adentro.
  const sinSaber = (nombre: string) => intentados.set(clave, { huella: '', nombre })
  const otraRuta = rutaDelDocumento.get(documento)
  // Antes de subir: si la ruta estaba vacía, lo que haya después es este archivo o nada.
  const estabaVacia = vacias.has(clave) || !antes
  const siLaRechazo = (rechazo: { statusCode?: string } | null) => {
    // Un rechazo de Storage (413, 403…) no deja nada: la ruta sigue como estaba.
    if (noGuardoNada(rechazo) && estabaVacia) vacias.add(clave)
  }
  try {
    // Otro tipo de archivo, otra ruta: lo de antes quedó en la suya. Si ninguna
    // fila lo nombra, la política deja quitarlo; si una lo nombra, no se quita, y
    // la acción dirá que ese envío ya quedó con otro archivo. La que se sabe
    // vacía no se toca.
    const otraClave = `${bucket}/${otraRuta}`
    if (otraRuta && otraRuta !== ruta && !vacias.has(otraClave)) {
      const quitado = await supabase.storage.from(bucket).remove([otraRuta])
      if (quitado.error) {
        return { ok: false, error: otroArchivoEnLaRuta(intentados.get(otraClave)?.nombre ?? este.nombre, false) }
      }
      if ((quitado.data?.length ?? 0) > 0) {
        confirmados.delete(otraClave)
        vacias.add(otraClave)
        porQuitarTrasOk.get(documento)?.delete(otraRuta)
      } else if (confirmados.has(otraClave)) {
        // Al final, aunque ya estuviera: la última que se anotó es la que se nombra.
        const yaAnotadas = [...(porQuitarTrasOk.get(documento) ?? [])].filter((r) => r !== otraRuta)
        porQuitarTrasOk.set(documento, new Set([...yaAnotadas, otraRuta]))
      }
    }
    rutaDelDocumento.set(documento, ruta)
    vacias.delete(clave)
    sinSaber(estabaVacia ? este.nombre : (antes?.nombre ?? este.nombre))
    let { error } = await subir()
    siLaRechazo(error)
    // La misma ruta permite reintentar una carga cuyo resultado no llegó.
    // El servidor comprueba el objeto; no se sobrescribe un archivo existente.
    if (error && error.statusCode === '409' && antes && antes.huella !== este.huella) {
      // Lo que está en Storage es el archivo de antes, o uno cuya subida no
      // contestó. Si ninguna fila lo nombra, la política deja quitarlo y el
      // elegido entra en su lugar; si una lo nombra, quedó: si es el elegido,
      // es el mismo envío y se anota; si no, se dice cuál.
      const quitado = await supabase.storage.from(bucket).remove([ruta])
      if (quitado.error) return { ok: false, error: otroArchivoEnLaRuta(antes.nombre, false) }
      if ((quitado.data?.length ?? 0) > 0) {
        confirmados.delete(clave)
        sinSaber(este.nombre)
        ;({ error } = await subir())
        if (noGuardoNada(error)) vacias.add(clave)
      } else {
        const quedo = confirmados.get(clave)
        if (quedo?.huella !== este.huella) {
          intentados.set(clave, antes)
          return { ok: false, error: otroArchivoEnLaRuta(quedo?.nombre ?? antes.nombre, true) }
        }
      }
    }
    if (error && error.statusCode !== '409') {
      // Un rechazo con la sesión de otra cuenta no es «No tienes permiso»: es el corte.
      seguirConLaCuentaDeLaPestana()
      return { ok: false, error: `${NO_SE_CARGO_EL_ARCHIVO} ${motivoDeSubida(error)}` }
    }
    if (!error) confirmados.set(clave, este)
    intentados.set(clave, este)
  } catch (e) {
    if (e instanceof OtraCuentaEnLaPestana) throw e
    return { ok: false, error: sinRespuesta }
  }
  const resultado = await anotarSinDejarloSuelto({
    bucket,
    ruta,
    anotar: registrar,
    sinRespuesta,
    siNoSeRetira: 'El archivo no se pudo retirar; vuelve a cargar la pantalla antes de reintentar.',
    alQuitarlo: () => {
      confirmados.delete(clave)
      vacias.add(clave)
      porQuitarTrasOk.get(documento)?.delete(ruta)
    },
  })
  const deOtroTipo = [...(porQuitarTrasOk.get(documento) ?? [])].filter((r) => r !== ruta)
  // «No quedó» habla de este archivo. Si una fila nombraba la ruta de otro tipo
  // del mismo documento, el documento pudo quedar con aquel: se dice cuál, sin
  // afirmar que quedó.
  if (!resultado.ok && resultado.error === NO_QUEDO_SIN_RESPUESTA && deOtroTipo.length > 0) {
    return { ok: false, error: otroArchivoEnLaRuta(intentados.get(`${bucket}/${deOtroTipo.at(-1)}`)?.nombre ?? este.nombre, false) }
  }
  // La caja cambia la ruta de su captura al guardarla: la de otro tipo que su
  // fila nombraba quedó sin nadie que la nombre, y ahora la política deja
  // quitarla. No se espera: lo anotado no cambia, y si tampoco esta vez se
  // puede, se queda como estaba.
  if (resultado.ok && deOtroTipo.length > 0) {
    porQuitarTrasOk.delete(documento)
    void supabase.storage.from(bucket).remove(deOtroTipo).catch(() => null)
  }
  return resultado
}

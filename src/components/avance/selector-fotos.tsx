'use client'

import { Camera, Images, RotateCcw, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { pudoHaberEntrado, yaEntroLaPrimeraVez, type ResultadoAccion } from '@/lib/acciones'
import { comprimirFoto } from '@/lib/comprimir-foto'
import {
  esDeLaVersionAnterior,
  laPestanaEsDeLaVersionAnterior,
  laPestanaEsDeOtraCuenta,
  OtraCuentaEnLaPestana,
  quitarConLaCuenta,
  SE_ACTUALIZO_EL_SISTEMA,
  SIN_RESPUESTA,
  vigilarLaVersion,
} from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'
import { tamanoArchivo } from '@/lib/format'
import { subirARutaNueva } from '@/lib/ruta-nueva'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export type FotoLista = {
  archivo: File
  vistaPrevia: string
  ruta?: string
  subiendo: boolean
  error?: string
}

const MAXIMO_MB = 10
// Lo que puede pesar la foto tal como sale de la cámara cuando se va a achicar antes de subirla.
const MAXIMO_ORIGINAL_MB = 40
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
// Los mismos que acepta el bucket (migración 078); el mensaje sale de esta lista.
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const TIPOS_TEXTO = 'JPG, PNG, WEBP o HEIC'

/** Lo que viaja a la acción: solo las que llegaron a Storage, con su ruta. */
export function fotosParaEnviar(fotos: FotoLista[]) {
  return fotos
    .filter((f) => f.ruta)
    .map((f) => ({
      ruta_storage: f.ruta as string,
      nombre_archivo: f.archivo.name,
      mime_type: f.archivo.type,
      tamano_bytes: f.archivo.size,
    }))
}

/** Mientras haya una en vuelo el formulario no se manda: se iría sin ella y en silencio. */
export function haySubiendo(fotos: FotoLista[]) {
  return fotos.some((f) => f.subiendo)
}

/** Las que no llegaron: el reporte no debería salir sin decirlo. */
export function hayFallidas(fotos: FotoLista[]) {
  return fotos.some((f) => f.error)
}

// Las que se retiraron mientras subían o se achicaban: al terminar, se quitan de Storage.
const retiradas = new WeakSet<FotoLista>()
// De ellas, las que se quitaron una por una (✕): la cola sigue con las demás.
const quitadas = new WeakSet<FotoLista>()
// Las que se eligieron y todavía no se achicaron: «Reintentar» las achica antes de subirlas.
const sinAchicar = new WeakSet<FotoLista>()

const NO_SUBIO_OTRA_CUENTA = 'No se subió: en otra pestaña entró otra cuenta. Cuando vuelva la tuya, usa «Reintentar».'
// La pestaña ya se sabe de antes del último despliegue: lo que se envíe desde
// ella no va a entrar, y al recargar, como pide el aviso de arriba, la foto
// subida quedaría suelta. No se sube, y sin «Reintentar», que daría lo mismo.
const NO_SUBIO_SE_ACTUALIZO = 'No se subió: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.'

/**
 * Las fotos ya subidas que ningún registro va a nombrar: se retiran de Storage
 * (la política deja a su dueño quitar las que ningún registro nombra) y se
 * sueltan sus miniaturas. Sin esperar: si falla, la foto queda suelta y nadie
 * más la ve. Con la sesión de otra cuenta el borrado volvía vacío: se deja para
 * cuando vuelva la de la pantalla (`quitarConLaCuenta`).
 *
 * La que todavía sube se anota (`retiradas`): cuando termina, se quita sola.
 * Antes llegaba a Storage después de cerrar y quedaba suelta (vigesimosegunda
 * pasada). Devuelve el borrado, para quien tiene que esperarlo antes de
 * recargar (`alVolverACargar`).
 */
export function quitarFotosSueltas(bucket: string, fotos: FotoLista[]) {
  // La que ya se está quitando no se pide dos veces: al saberse vieja la
  // pestaña el reporte diario quita las suyas, y su envío cortado, otra vez.
  const nuevas = fotos.filter((f) => !quitandose.has(f))
  retirarLasQueSuben(nuevas)
  const rutas = nuevas.flatMap((f) => (f.ruta ? [f.ruta] : []))
  const borrado = rutas.length > 0 ? quitarConLaCuenta(() => createClient().storage.from(bucket).remove(rutas)) : Promise.resolve()
  soltarMiniaturas(nuevas)
  for (const f of nuevas) quitandose.set(f, borrado)
  return Promise.all(fotos.map((f) => quitandose.get(f)))
}

const quitandose = new WeakMap<FotoLista, Promise<unknown>>()

// La que ya estaba subida, o subiendo, cuando la pestaña se supo de antes del
// último despliegue (`quitarAlSaberseVieja`).
const SE_QUITO_SE_ACTUALIZO = 'Se quitó: el sistema se actualizó.'

/**
 * La pestaña se supo de antes del último despliegue (`vigilarLaVersion`) con
 * fotos ya subidas o subiendo: desde aquí nada las va a nombrar, y al recargar,
 * como pide el aviso, quedaban sueltas. Se quitan de Storage en el acto y se
 * quedan en la lista sin miniatura, con una sola alerta que pide elegirlas otra
 * vez al volver a cargar (trigésima pasada). Devuelve con qué cambiar la lista,
 * o `null` si no había ninguna.
 */
export function quitarAlSaberseVieja(bucket: string, fotos: FotoLista[]) {
  const van = fotos.filter((f) => f.ruta || f.subiendo)
  if (van.length === 0) return null
  void quitarFotosSueltas(bucket, van)
  return (lista: FotoLista[]) =>
    lista.map((f): FotoLista => (van.includes(f) ? { ...f, ruta: undefined, subiendo: false, vistaPrevia: '', error: SE_QUITO_SE_ACTUALIZO } : f))
}

/** Un envío con fotos: con cuáles salió, si su ventana se cerró mientras iba y si ya terminó. */
type Intento = { fotos: FotoLista[]; sinVentana: boolean; termino: boolean }

/**
 * Cómo terminó el envío que salió con la ventana ya cerrada, cuando no entró:
 * no se registró (la base lo rechazó, o la traba lo cortó antes de salir), no
 * se sabe (no llegó la respuesta), o ya había quedado la primera vez.
 */
export type Desenlace = { tono: 'no-entro' | 'en-duda' | 'ya-entro'; motivo: string }

const CORTADO_OTRA_CUENTA = 'en otra pestaña entró otra cuenta. Cuando vuelva la tuya, vuelve a enviarlo.'

// La pestaña es de antes del último despliegue (`SE_ACTUALIZO_EL_SISTEMA`): en
// la ventana, y junto al botón si se cerró mientras se enviaba. Las fotos se
// quitan, así que se dice que hay que elegirlas otra vez. También el reporte diario.
export const SE_ACTUALIZO_CON_FOTOS =
  'El sistema se actualizó mientras tenías la pantalla abierta: no se registró. Copia lo escrito, vuelve a cargar la pantalla y elige las fotos otra vez.'
const SE_ACTUALIZO_SIN_VENTANA = 'el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y envíalo otra vez.'

/** El registro entró, pero sus fotos no (`fotosSueltas` de la acción): ninguna fila las nombra. */
const entroSinFotos = (datos: unknown) =>
  typeof datos === 'object' && datos !== null && 'fotosSueltas' in datos && Boolean(datos.fotosSueltas)

/**
 * Las fotos de una ventana que las sube al elegirlas y las nombra al registrar:
 * el reporte del trabajo, el avance, el reporte del día, el ingreso y la salida
 * del vehículo. Una foto ya subida se quita de Storage solo cuando se sabe que
 * ningún registro la va a nombrar:
 * - se cierra la ventana sin enviar, o el envío que salió con la ventana ya
 *   cerrada vuelve con un rechazo de la base;
 * - el registro entró sin ellas (`fotosSueltas`), o ya había entrado la primera
 *   vez (las que ese nombra, la política del bucket no deja quitarlas);
 * - la pestaña es de antes del último despliegue: la acción no corrió, y desde
 *   ella no va a correr. Se quitan también las de la ventana abierta.
 *
 * Si no se sabe cómo terminó —no llegó la respuesta, el servidor cayó—, se
 * quedan, también al cerrar después: el registro pudo entrar con ellas, y la
 * política solo protege la que una fila ya nombra. Una pausa ciega antes de
 * quitarlas borraba la foto de un reporte que sí entró si el servidor tardaba
 * (vigesimosexta pasada). Una foto suelta no la ve nadie; un reporte con su foto
 * borrada, sí.
 *
 * Cerrar mientras se envía deja las fotos en manos de ese envío. Lo de cada
 * envío va con él y no con la ventana: volver a abrirla mientras el anterior
 * seguía en camino lo soltaba, y su foto quedaba suelta sin aviso (vigesimosexta
 * pasada). Mientras ese envío siga en camino, el botón que abre la ventana gira
 * y no la abre (`EstadoDelEnvio`): la ventana nueva salía vacía, con «Registrar»
 * girando sin decir por qué, y el «Reporte registrado.» del primero quedaba
 * debajo de ella (vigesimoséptima). Si no entra, se dice junto a ese botón
 * (`desenlace`).
 *
 * Uso: `conFotos(accion)` va a `useEnvio`; `abrir()` y `cerrar()`, con la
 * ventana; `EstadoDelEnvio` con `idDelEstado`, `sigue` y `desenlace`, junto al
 * botón que la abre, que lleva `ocupado` mientras `sigue` (y mientras la página
 * se pone al día tras el ok) y, mientras `sigue`, `aria-describedby` con
 * `idDelEstado`. En el ok, la ventana se cierra solo si no se cerró mientras se
 * enviaba (`seCerroAlEnviar()`).
 *
 * `clave`: la misma ventana pintada dos veces (la tarjeta del teléfono y la fila
 * del monitor) comparte `sigue` y `desenlace` (`useEstadoCompartido`).
 */
export function useFotosDelEnvio(bucket: string, clave?: string) {
  const [fotos, setFotos] = useState<FotoLista[]>([])
  // Cómo terminó el envío que salió con la ventana ya cerrada, si no entró.
  const [desenlace, setDesenlace] = useEstadoCompartido<Desenlace | null>(clave && `${clave}:desenlace`, null)
  // Ese envío sigue en camino. No es el `enviando` de useEnvio: ese sigue
  // encendido mientras la página se pone al día tras el ok, y junto al verde
  // asomaba «se sigue enviando» (vigesimoctava pasada).
  const [sigue, setSigue] = useEstadoCompartido(clave && `${clave}:sigue`, false)
  const idDelEstado = useId()
  // El envío en curso, o el último.
  const intento = useRef<Intento | null>(null)
  // Las rutas que salieron en un envío de esta ventana que no se sabe cómo terminó.
  const enDuda = useRef(new Set<string>())
  // Las que van en un envío que sigue en camino.
  const enCamino = useRef(new Set<FotoLista>())
  // Las de la ventana ahora: el envío vuelve después de que se pintaron otras.
  const actuales = useRef<FotoLista[]>([])
  useEffect(() => {
    actuales.current = fotos
  })

  // Con la ventana abierta, al saberse vieja la pestaña se quitan sus fotos
  // subidas (`quitarAlSaberseVieja`), menos las de un envío en camino, que son
  // de ese envío, y las de uno que no se sabe cómo terminó, que pudo nombrarlas.
  useEffect(
    () =>
      vigilarLaVersion(() => {
        if (!laPestanaEsDeLaVersionAnterior()) return
        const marcar = quitarAlSaberseVieja(
          bucket,
          actuales.current.filter((f) => !enCamino.current.has(f) && !(f.ruta && enDuda.current.has(f.ruta))),
        )
        if (marcar) setFotos(marcar)
      }),
    [bucket],
  )

  // Entró, o ya había entrado: las del envío ya no son de la ventana.
  function alEntrar(este: Intento, sinNombrar: boolean) {
    if (sinNombrar) quitarFotosSueltas(bucket, este.fotos)
    else soltarMiniaturas(este.fotos)
    if (este.sinVentana) return
    // Las que se eligieron mientras se enviaba no fueron con el registro.
    quitarFotosSueltas(bucket, actuales.current.filter((f) => !este.fotos.includes(f)))
    setFotos([])
  }

  function conFotos<T>(accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion<T>>) {
    return async (previo: unknown, datos: FormData): Promise<ResultadoAccion<T>> => {
      const este: Intento = { fotos, sinVentana: false, termino: false }
      intento.current = este
      for (const f of fotos) enCamino.current.add(f)
      const dudar = () => {
        for (const f of este.fotos) if (f.ruta) enDuda.current.add(f.ruta)
      }
      try {
        const r = await accion(previo, datos)
        const yaEntro = !r.ok && yaEntroLaPrimeraVez(r.error)
        const enDudaR = !r.ok && !yaEntro && pudoHaberEntrado(r.error)
        if (r.ok) alEntrar(este, entroSinFotos(r.datos))
        else if (yaEntro) alEntrar(este, true)
        else if (enDudaR) dudar()
        else if (este.sinVentana) quitarFotosSueltas(bucket, este.fotos)
        // «Ya quedó la primera vez» no es un rechazo: se dice sin rojo, y que lo
        // cambiado al reenviarlo no se guardó (vigesimoséptima pasada).
        if (este.sinVentana && !r.ok) setDesenlace({ tono: yaEntro ? 'ya-entro' : enDudaR ? 'en-duda' : 'no-entro', motivo: r.error })
        return r
      } catch (e) {
        // Una pestaña de antes del último despliegue: el servidor no conoce la
        // acción y no la corrió, y desde aquí no va a entrar. Las fotos se quitan,
        // también las de la ventana abierta, que ya no tienen con qué enviarse.
        // Antes quedaban «en duda», sueltas para siempre, y el desenlace mandaba a
        // revisar la conexión (crítica de la vigesimoctava pasada).
        if (esDeLaVersionAnterior(e)) {
          // La anulación del vehículo va por aquí sin fotos.
          const conFotosQueElegir = este.fotos.length > 0 || actuales.current.length > 0
          if (este.sinVentana) {
            quitarFotosSueltas(bucket, este.fotos)
            setDesenlace({ tono: 'no-entro', motivo: SE_ACTUALIZO_SIN_VENTANA })
          } else {
            quitarFotosSueltas(bucket, [...new Set([...este.fotos, ...actuales.current])])
            setFotos([])
          }
          return { ok: false, error: conFotosQueElegir ? SE_ACTUALIZO_CON_FOTOS : SE_ACTUALIZO_EL_SISTEMA }
        }
        // Lo cortó la traba antes de salir: no se envió nada. Lo demás no se sabe.
        const corte = e instanceof OtraCuentaEnLaPestana
        if (!corte) dudar()
        else if (este.sinVentana) quitarFotosSueltas(bucket, este.fotos)
        if (este.sinVentana) setDesenlace(corte ? { tono: 'no-entro', motivo: CORTADO_OTRA_CUENTA } : { tono: 'en-duda', motivo: SIN_RESPUESTA })
        throw e
      } finally {
        este.termino = true
        for (const f of este.fotos) enCamino.current.delete(f)
        if (este.sinVentana) setSigue(false)
      }
    }
  }

  function cerrar() {
    const enCurso = intento.current && !intento.current.termino ? intento.current : null
    if (enCurso) {
      enCurso.sinVentana = true
      setSigue(true)
    }
    const quedan = new Set(enDuda.current)
    for (const f of enCurso?.fotos ?? []) if (f.ruta) quedan.add(f.ruta)
    quitarFotosSueltas(bucket, fotos.filter((f) => !(f.ruta && quedan.has(f.ruta))))
    soltarMiniaturas(fotos)
    setFotos([])
  }

  // Cada vez que se abre empieza limpia: es un evento, no un efecto.
  function abrir() {
    enDuda.current = new Set()
    setDesenlace(null)
    setFotos([])
  }

  return {
    fotos,
    setFotos,
    conFotos,
    abrir,
    cerrar,
    desenlace,
    sigue,
    idDelEstado,
    seCerroAlEnviar: () => Boolean(intento.current?.sinVentana),
  }
}

/**
 * Junto al botón que abre la ventana, lo del envío que salió con ella cerrada:
 * que sigue en camino —y por eso el botón gira (`ocupado`)— y, si no entró,
 * cómo terminó. `registro` es lo que se envía, con su artículo («El reporte»,
 * «La salida»), y `femenino` concuerda el «registrado». Lo que sí entró lo dice
 * el aviso verde de cada pantalla.
 *
 * La región que avisa está siempre montada, vacía y fuera de la vista mientras
 * no hay nada que decir: una que nace con su texto el lector no la lee, y al
 * llegar al botón se oía «no disponible» sin el porqué (vigesimoctava pasada).
 * `id` es el `idDelEstado` del hook, al que apunta el botón ocupado.
 */
export function EstadoDelEnvio({
  id,
  sigue,
  desenlace,
  registro,
  femenino = false,
  className,
}: {
  id: string
  sigue: boolean
  desenlace: Desenlace | null
  registro: string
  femenino?: boolean
  className?: string
}) {
  const estado = sigue
    ? `${registro} se sigue enviando: lo que conteste se dice aquí.`
    : desenlace?.tono === 'ya-entro'
      ? `${registro} ya había quedado ${femenino ? 'registrada' : 'registrado'} la primera vez: lo que cambiaste al reenviar no se guardó.`
      : ''
  const alerta =
    !sigue && desenlace && desenlace.tono !== 'ya-entro'
      ? `${registro} que se estaba enviando${desenlace.tono === 'no-entro' ? ' no se registró' : ''}: ${desenlace.motivo}`
      : ''
  return (
    <>
      <span id={id} role="status" className={estado ? cn('text-xs text-texto-suave', className) : 'sr-only'}>
        {estado}
      </span>
      {alerta && (
        <span role="alert" className={cn('text-xs text-peligro', className)}>
          {alerta}
        </span>
      )}
    </>
  )
}

/** La que todavía sube, o se achica, se quita de Storage sola cuando termina. */
export function retirarLasQueSuben(fotos: FotoLista[]) {
  for (const f of fotos) if (f.subiendo) retiradas.add(f)
}

/** Las miniaturas viven en la memoria del navegador hasta que se sueltan. */
export function soltarMiniaturas(fotos: FotoLista[]) {
  for (const f of fotos) if (f.vistaPrevia) URL.revokeObjectURL(f.vistaPrevia)
}

// El campo de verdad está oculto: el anillo de foco del teclado lo lleva el
// mosaico, igual que la caja de ElegirArchivo.
const MOSAICO =
  'flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde text-texto-suave hover:bg-superficie-2 hover:text-texto has-[:focus-visible]:border-acento has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-anillo-foco has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50'

/** Qué le pasó a la subida, en palabras del taller. */
function explicarFalla(mensaje: string) {
  const m = mensaje.toLowerCase()
  if (m.includes('mime') || m.includes('type')) return 'El servidor no acepta este tipo de foto.'
  if (m.includes('size') || m.includes('large') || m.includes('too big')) return `Pesa más de ${MAXIMO_MB} MB.`
  if (m.includes('row-level') || m.includes('policy') || m.includes('unauthorized')) return 'No tienes permiso para subir fotos acá.'
  return 'No se pudo subir: revisa la señal y vuelve a intentar.'
}

/**
 * El selector de fotos del taller, uno solo para el avance de las órdenes y
 * para las unidades sin orden.
 *
 * Dos entradas: «Tomar foto» abre la cámara y «De la galería» abre las que ya
 * se tomaron durante el día, que es como trabaja el supervisor —fotografía a
 * la mañana y reporta a la tarde—. Con `capture` puesto en una sola entrada el
 * teléfono no ofrecía la galería y las fotos del día no se podían adjuntar.
 * Con ratón no hay cámara (las dos abrían el mismo explorador): queda una sola,
 * «Elegir fotos», decidido por el puntero como en `ElegirArchivo`.
 *
 * No es `ElegirArchivo` porque es otra cosa: varias fotos a la vez, cada una
 * con su miniatura, su subida y su «Reintentar», y en HEIC si viene del iPhone.
 * Lo que dice sí es lo mismo: formatos y tope antes de elegir, y el motivo con
 * las mismas palabras cuando una no sirve.
 *
 * La foto viaja del navegador a Storage sin pasar por el servidor de la
 * aplicación; acá solo se guarda su ruta, y la acción la escribe cuando se
 * registra el reporte. El estado vive en el padre —es un componente
 * controlado— porque es el padre quien decide si puede enviar (`haySubiendo`)
 * y quien vacía la lista al abrir de nuevo, sin efectos.
 *
 * `prefijoRuta` es la carpeta: las políticas de Storage leen la ruta para
 * decidir quién ve la foto (`ot/{orden}/…` hereda la orden; `flota/{unidad}/…`
 * queda para quien ve el taller; en el reporte diario, `{cuenta}/{reporte}/…`).
 *
 * Con `comprimir`, la foto se achica en el teléfono antes de subirla (ver
 * `comprimirFoto`) y sube siempre como JPEG; `maximoMb` es entonces lo que puede
 * pesar ya achicada.
 */
export function SelectorFotos({
  fotos,
  alCambiar,
  prefijoRuta,
  maximo,
  bucket = 'fotos-avance',
  comprimir = false,
  maximoMb = MAXIMO_MB,
  titulo = 'Fotos',
}: {
  fotos: FotoLista[]
  alCambiar: Dispatch<SetStateAction<FotoLista[]>>
  prefijoRuta: string
  maximo?: number
  bucket?: string
  comprimir?: boolean
  maximoMb?: number
  /** `null` cuando el formulario ya le pone su propio título a la sección. */
  titulo?: string | null
}) {
  /**
   * Sube la foto con la sesión que haya. La sesión se mira justo antes de que
   * salga, no solo al elegir: subir varias, o achicarlas, toma segundos, y si
   * en ese rato entraba otra cuenta en otra pestaña, las que seguían en la cola
   * salían a su nombre —y a la vuelta decían «No tienes permiso», que no era
   * cierto— (vigesimotercera pasada). `false` si no salió por eso.
   */
  async function subir(foto: FotoLista) {
    if (laPestanaEsDeOtraCuenta()) {
      alCambiar((f) => f.map((item) => (item === foto ? { ...item, subiendo: false, error: NO_SUBIO_OTRA_CUENTA } : item)))
      return false
    }
    if (laPestanaEsDeLaVersionAnterior()) {
      alCambiar((f) => f.map((item) => (item === foto ? { ...item, subiendo: false, error: NO_SUBIO_SE_ACTUALIZO } : item)))
      return true
    }
    const supabase = createClient()
    const extension = comprimir
      ? (EXTENSION[foto.archivo.type] ?? 'jpg')
      : (foto.archivo.name.split('.').pop() ?? 'jpg').toLowerCase()
    const ruta = `${prefijoRuta}/${crypto.randomUUID()}.${extension}`

    const { error } = await subirARutaNueva(supabase.storage.from(bucket), ruta, foto.archivo, foto.archivo.type, quitarConLaCuenta)
    // Se cerró sin registrar mientras subía: nada la va a nombrar.
    if (retiradas.has(foto)) {
      if (!error) void quitarConLaCuenta(() => supabase.storage.from(bucket).remove([ruta]))
      return true
    }

    alCambiar((f) =>
      f.map((item) =>
        item === foto
          ? {
              ...item,
              subiendo: false,
              ruta: error ? undefined : ruta,
              // Si la sesión cambió mientras subía, el rechazo es por eso y no por el permiso.
              error: error ? (laPestanaEsDeOtraCuenta() ? NO_SUBIO_OTRA_CUENTA : explicarFalla(error.message)) : undefined,
            }
          : item,
      ),
    )
    return true
  }

  /**
   * Achica la que hace falta achicar y la sube. `retirada` si se cerró la
   * ventana mientras tanto, `quitada` si se quitó esa sola con ✕, `cortada` si
   * la sesión ya es de otra cuenta.
   */
  async function prepararYSubir(foto: FotoLista): Promise<'sigue' | 'retirada' | 'quitada' | 'cortada'> {
    let lista = foto
    if (sinAchicar.has(foto)) {
      // Mientras se achica, la miniatura ya está con «subiendo…» encima.
      let achicada: File | null = null
      try {
        achicada = await comprimirFoto(foto.archivo)
      } catch {
        achicada = null
      }
      if (retiradas.has(foto)) return quitadas.has(foto) ? 'quitada' : 'retirada'
      const falla = !achicada
        ? 'No se pudo abrir esta foto: tómala de nuevo o elige otra.'
        : achicada.size > maximoMb * 1024 * 1024
          ? `Aun achicada pesa más de ${maximoMb} MB.`
          : null
      if (!achicada || falla) {
        // Sin miniatura no se ofrece «Reintentar»: volvería a fallar igual.
        URL.revokeObjectURL(foto.vistaPrevia)
        alCambiar((f) => f.map((item) => (item === foto ? { ...item, vistaPrevia: '', subiendo: false, error: falla ?? undefined } : item)))
        return 'sigue'
      }
      lista = { ...foto, archivo: achicada }
      alCambiar((f) => f.map((item) => (item === foto ? lista : item)))
    }
    const salio = await subir(lista)
    if (retiradas.has(lista)) return quitadas.has(lista) ? 'quitada' : 'retirada'
    return salio ? 'sigue' : 'cortada'
  }

  async function agregar(lista: FileList | null) {
    // Cada foto sube al elegirla, con la sesión que haya: si es de otra cuenta,
    // no se sube y la pantalla se traba (vigesimosegunda pasada).
    if (!lista || laPestanaEsDeOtraCuenta()) return

    const disponibles = Math.max(0, (maximo ?? Number.POSITIVE_INFINITY) - fotos.length)
    // Si a media cola entra otra cuenta, las que faltan se quedan elegidas, sin
    // subir y con «Reintentar» para cuando vuelva la de la pantalla.
    let cortada = false
    for (const archivo of Array.from(lista).slice(0, disponibles)) {
      // Con las mismas palabras que el campo de los documentos (ElegirArchivo).
      const tope = comprimir ? MAXIMO_ORIGINAL_MB : maximoMb
      const noSirve = !TIPOS.includes(archivo.type)
        ? `No es una foto ${TIPOS_TEXTO}: elige otra.`
        : archivo.size === 0
          ? 'Está vacía: elige otra.'
          : archivo.size > tope * 1024 * 1024
            ? `Pesa ${tamanoArchivo(archivo.size)} y el tope es ${tope} MB: elige otra.`
            : null
      if (noSirve) {
        alCambiar((f) => [...f, { archivo, vistaPrevia: '', subiendo: false, error: noSirve }])
        continue
      }

      const foto: FotoLista = cortada
        ? { archivo, vistaPrevia: URL.createObjectURL(archivo), subiendo: false, error: NO_SUBIO_OTRA_CUENTA }
        : { archivo, vistaPrevia: URL.createObjectURL(archivo), subiendo: true }
      if (comprimir) sinAchicar.add(foto)
      alCambiar((f) => [...f, foto])
      if (cortada) continue
      const resultado = await prepararYSubir(foto)
      // Se cerró mientras subía: las que siguen ya no tienen ventana.
      if (resultado === 'retirada') break
      if (resultado === 'cortada') cortada = true
    }
  }

  /** Volver a intentar con el mismo archivo: solo tiene sentido si falló la subida, no el tipo o el peso. */
  function reintentar(foto: FotoLista) {
    if (laPestanaEsDeOtraCuenta()) return
    const otraVez: FotoLista = { ...foto, subiendo: true, error: undefined }
    if (sinAchicar.has(foto)) sinAchicar.add(otraVez)
    alCambiar((f) => f.map((item) => (item === foto ? otraVez : item)))
    void prepararYSubir(otraVez)
  }

  async function quitar(foto: FotoLista) {
    // Quitada mientras sube o se achica: la subida termina después y la quita
    // de Storage. Antes llegaba igual y quedaba suelta, sin nada en la pantalla
    // que la nombrara (vigesimotercera pasada).
    if (foto.subiendo) {
      retiradas.add(foto)
      quitadas.add(foto)
    }
    const { ruta } = foto
    if (ruta) await quitarConLaCuenta(() => createClient().storage.from(bucket).remove([ruta]))
    if (foto.vistaPrevia) URL.revokeObjectURL(foto.vistaPrevia)
    alCambiar((f) => f.filter((item) => item !== foto))
  }

  const fallidas = fotos.filter((f) => f.error && f.error !== SE_QUITO_SE_ACTUALIZO)
  // Se quitan todas a la vez: una alerta por foto se leía una tras otra.
  const quitadasAlActualizar = fotos.filter((f) => f.error === SE_QUITO_SE_ACTUALIZO).length

  return (
    <div>
      {titulo && <p className="mb-1.5 text-sm font-medium text-texto">{titulo}</p>}
      <div className="flex flex-wrap gap-2">
        {fotos.map((foto, i) => (
          <div
            key={`${foto.archivo.name}-${i}`}
            className={cn(
              'relative size-24 overflow-hidden rounded-[var(--radius-base)] border',
              foto.error ? 'border-peligro' : 'border-borde',
            )}
          >
            {foto.vistaPrevia ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto.vistaPrevia} alt={foto.archivo.name} className="size-full object-cover" />
            ) : (
              <p className="p-1.5 text-[11px] text-peligro">{foto.error === SE_QUITO_SE_ACTUALIZO ? 'Se quitó' : 'No entró'}</p>
            )}

            {foto.subiendo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white">
                subiendo…
              </div>
            )}

            {foto.error && !foto.subiendo && foto.vistaPrevia && foto.error !== NO_SUBIO_SE_ACTUALIZO && (
              <button
                type="button"
                onClick={() => reintentar(foto)}
                aria-label={`Volver a subir ${foto.archivo.name}`}
                className="absolute inset-x-0 bottom-0 flex min-h-11 items-center justify-center gap-1 bg-black/60 text-xs font-medium text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-1"
              >
                <RotateCcw aria-hidden className="size-3.5" />
                Reintentar
              </button>
            )}

            {/* Sin confirmación a propósito: la foto es de lo que se está armando
                y se vuelve a poner con el mismo botón de al lado. Mientras se
                envía, la ventana traba el selector entero (`fieldset disabled`):
                la ✕ quitaba de Storage una foto que el envío en curso nombraba
                (vigesimoséptima pasada). Blanco de 44 px en el teléfono: con
                guante se fallaba o se quitaba la de al lado. */}
            <button
              type="button"
              onClick={() => quitar(foto)}
              aria-label={`Quitar ${foto.archivo.name}`}
              className="absolute top-0 right-0 flex size-11 items-center justify-center text-white drop-shadow hover:text-peligro-suave disabled:cursor-not-allowed disabled:opacity-50 sm:size-6"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-black/60 sm:size-5">
                <X aria-hidden className="size-3.5" />
              </span>
            </button>
          </div>
        ))}

        {(maximo === undefined || fotos.length < maximo) && <label className={cn(MOSAICO, 'pointer-fine:hidden')}>
          <Camera aria-hidden className="size-5" />
          <span className="text-[11px]">Tomar foto</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void agregar(e.target.files)
              e.target.value = ''
            }}
          />
        </label>}

        {(maximo === undefined || fotos.length < maximo) && <label className={MOSAICO}>
          <Images aria-hidden className="size-5" />
          <span className="text-[11px] pointer-fine:hidden">De la galería</span>
          <span className="hidden text-[11px] pointer-fine:inline">{maximo === 1 ? 'Elegir foto' : 'Elegir fotos'}</span>
          <input
            type="file"
            accept="image/*"
            multiple={maximo !== 1}
            className="sr-only"
            onChange={(e) => {
              void agregar(e.target.files)
              e.target.value = ''
            }}
          />
        </label>}
      </div>

      {(fallidas.length > 0 || quitadasAlActualizar > 0) && (
        <ul className="mt-2 space-y-1" aria-label="Fotos que no entraron">
          {fallidas.map((f, i) => (
            <li key={`${f.archivo.name}-falla-${i}`} role="alert" className="text-xs text-peligro">
              <span className="font-medium">{f.archivo.name}:</span> {f.error}
            </li>
          ))}
          {quitadasAlActualizar > 0 && (
            <li role="alert" className="text-xs text-peligro" data-fotos-quitadas>
              {quitadasAlActualizar === 1
                ? 'La foto ya subida se quitó: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.'
                : `Las ${quitadasAlActualizar} fotos ya subidas se quitaron: el sistema se actualizó. Vuelve a cargar la pantalla y elígelas otra vez.`}
            </li>
          )}
        </ul>
      )}

      <p className="mt-1 text-[11px] text-texto-tenue">
        {comprimir
          ? `${maximo ? `Hasta ${maximo} ${maximo === 1 ? 'foto' : 'fotos'}` : 'Varias a la vez desde la galería'}, en ${TIPOS_TEXTO}, de hasta ${MAXIMO_ORIGINAL_MB} MB cada una. Se achican en el teléfono antes de subir.`
          : `${maximo === 1 ? 'Una foto' : 'Varias a la vez desde la galería'}. Hasta ${maximoMb} MB por foto, en ${TIPOS_TEXTO}.`}
      </p>
    </div>
  )
}

import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from 'next/navigation'
import { startTransition, useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from 'react'

import { consultarEnvio } from '@/app/(app)/acciones-envio'
import { pudoHaberEntrado, yaEntroLaPrimeraVez, type ResultadoAccion } from '@/lib/acciones'
import { contarLoQueEntro, MAXIMO_PENDIENTES, type ClaveDelEnvio, type LoQueEntro } from '@/lib/dominio/envios'
import { alCerrarLaVentana, hayVentanaAbierta, vecesQueSeCerro } from '@/lib/ventanas-abiertas'

type Exito<T> = Extract<ResultadoAccion<T>, { ok: true }>

/**
 * Lo que se dice cuando la acción no contesta: se cortó la señal, o el
 * servidor cayó a medio camino. La escritura pudo entrar igual, así que se pide
 * mirar antes de repetirla.
 */
export const SIN_RESPUESTA = 'No llegó la respuesta. Revisa la conexión y mira si quedó guardado antes de volver a intentar.'

/**
 * Con lo que se frena el envío desde una pantalla que es de otra cuenta
 * (`laPestanaEsDeOtraCuenta`). En `useAccion` no se dice: lo dice la traba de la
 * pantalla, que se abre al mismo tiempo.
 */
export class OtraCuentaEnLaPestana extends Error {
  constructor() {
    super('No se envió: esta pantalla es de otra cuenta. Vuelve a entrar con la tuya en la otra pestaña, o recarga.')
  }
}

/**
 * Qué decir cuando la llamada a una acción de servidor lanza en vez de
 * devolver su resultado. Sin esto la excepción llegaba al límite de error: la
 * pantalla entera caía en «Esta pantalla no se pudo abrir» y se perdía lo
 * escrito (producción, 2026-10-21). La redirección de una acción también llega
 * como excepción, y esa sigue su camino. No todo es la señal: una pestaña de
 * antes del último despliegue o un fallo del servidor no se arreglan
 * reintentando.
 */
export function explicarFallo(e: unknown): string {
  unstable_rethrow(e)
  if (e instanceof OtraCuentaEnLaPestana) return e.message
  console.error(e)
  if (unstable_isUnrecognizedActionError(e)) {
    return 'El sistema se actualizó mientras tenías la pantalla abierta. Copia lo escrito y vuelve a cargar la pantalla.'
  }
  if (e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine)) return SIN_RESPUESTA
  return 'El servidor no pudo completar el envío. Mira si quedó guardado; si se repite, vuelve a cargar la pantalla o avisa al administrador.'
}

type Opciones = {
  /** Repintar la pantalla con lo recién guardado. No hace falta si `alTerminar` navega a otra. */
  refrescar?: boolean
  /**
   * Tras «… ya quedó … la primera vez que lo enviaste»: ese id ya terminó y el
   * envío siguiente lleva otro. Corre con la ventana ya cerrada, o en el acto si
   * no la había. Sin esto un id que vive fuera de la ventana se quedaba pegado:
   * cada documento siguiente de la compra decía «ya quedó» hasta recargar. Si la
   * respuesta llega tarde, puede haber otra ventana abierta: que ponga un id
   * nuevo, no que lo borre, o esa ventana se queda sin id para enviar.
   */
  alYaEntrar?: () => void
}

/**
 * Llamar a una acción de servidor con datos ya armados: una llamada por toque,
 * `enviando` pintado al instante y el resultado a la vista.
 *
 * Es la mitad de `useEnvio` que no necesita un formulario: el visto que se
 * marca con un botón, el «quitar» que confirma una ventana. Antes cada uno de
 * esos sitios llevaba su `useActionState` envuelto en `startTransition`, o su
 * par `useState(enviando)` + `router.refresh()` a mano, con las mismas dos
 * fallas que `useEnvio` explica abajo.
 */
export function useAccion<T = never>(
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion<T>>,
  alTerminar?: (resultado: Exito<T>) => void,
  opciones: Opciones = {},
) {
  const { refrescar = true, alYaEntrar } = opciones
  const router = useRouter()
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)
  const [resultado, setResultado] = useState<ResultadoAccion<T> | null>(null)

  /**
   * Lo que sigue a un envío que no salió bien. El aviso que se leyó en su ventana
   * se va con ella: si el envío vive fuera (el pago de la tarjeta), volvía a
   * abrirse con el aviso viejo y, si era un «ya quedó», sin el botón que envía,
   * hasta recargar. El que llegó con la ventana ya cerrada nadie lo leyó: se
   * queda a la vista donde la pantalla lo pinte, salvo que sea un «ya quedó» o que
   * haya otra ventana abierta, que no es la suya. Soltarlo siempre callaba el
   * rechazo de «Sacar de la lista» y de quitar un repuesto (decimoquinta pasada).
   * Cuando el envío pudo entrar —ya entró, o no llegó la respuesta—, la pantalla
   * de detrás se pone al día al cerrar, para que no ofrezca otra vez lo que ya
   * entró: con «No llegó la respuesta», cancelar y volver a abrir, la tarjeta
   * seguía con el saldo de antes y se pagaba dos veces (decimocuarta pasada). Con
   * la ventana abierta espera a que se cierre: antes la desmontaba con el aviso a
   * medio leer (`ventanas-abiertas.ts`). Sin ventana, el aviso se queda a la vista.
   */
  function despuesDelRechazo(salida: ResultadoAccion<T>, ventana: number | null, lanzo: boolean) {
    if (salida.ok) return
    const desdeVentana = ventana !== null
    const yaEntro = yaEntroLaPrimeraVez(salida.error)
    // La subida con su archivo no lanza: devuelve «No llegó la respuesta…» (`anotarSinDejarloSuelto`).
    const pudoEntrar = lanzo || pudoHaberEntrado(salida.error)
    const ponerAlDia = refrescar && (yaEntro || (pudoEntrar && desdeVentana))
    if (!desdeVentana) {
      if (yaEntro) alYaEntrar?.()
      if (ponerAlDia) iniciar(() => refrescarSiEsDeLaPestana(router))
      return
    }
    const soltar = () => {
      setResultado((r) => (r === salida ? null : r))
      if (yaEntro) alYaEntrar?.()
    }
    const alCerrar = () => {
      soltar()
      if (ponerAlDia) refrescarSiEsDeLaPestana(router)
    }
    if (ventana === vecesQueSeCerro() && alCerrarLaVentana(alCerrar)) return
    // La ventana del envío ya se cerró: la que esté abierta ahora es otra. El
    // aviso se suelta fuera de la transición: dentro esperaba al refresco, y
    // con la señal lenta la ventana que se volvía a abrir salía trabada con el
    // «ya quedó» del envío anterior. Sin otra ventana, el rechazo se queda.
    if (yaEntro || hayVentanaAbierta()) soltar()
    if (ponerAlDia) iniciar(() => refrescarSiEsDeLaPestana(router))
  }

  function ejecutar(datos: FormData) {
    if (enCurso.current) return
    // La sesión es de la cuenta que entró en otra pestaña: lo que saliera de
    // aquí entraría a su nombre. Se mira la cookie en el momento del toque, no
    // solo el aviso de la otra pestaña, que llega cuando esa termina de pintarse
    // (vigesimosegunda pasada). No queda ningún rojo: lo dice la traba de la
    // pantalla, que se abre con esto, y un «No se envió» se quedaba en la fila
    // después de que la cuenta volviera.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setResultado(null)
    const ventana = hayVentanaAbierta() ? vecesQueSeCerro() : null

    iniciar(async () => {
      // Mientras Next navega por la redirección de la acción, el botón sigue
      // bloqueado: soltarlo dejaba pasar un segundo envío en ese instante.
      let soltar = true
      try {
        let salida: ResultadoAccion<T>
        try {
          salida = await accion(null, datos)
        } catch (e) {
          // Lo frenó `salio()`: no salió nada, y la traba de la pantalla ya lo dice.
          if (e instanceof OtraCuentaEnLaPestana) return
          let mensaje: string
          try {
            mensaje = explicarFallo(e)
          } catch (deNext) {
            soltar = false
            throw deNext
          }
          const fallo: ResultadoAccion<T> = { ok: false, error: mensaje }
          setResultado(fallo)
          despuesDelRechazo(fallo, ventana, true)
          return
        }
        // Una acción que redirige (abrir la orden desde la cotización) no
        // devuelve nada: Next ya está navegando a la pantalla nueva.
        if (!salida) return
        setResultado(salida)
        if (!salida.ok) {
          despuesDelRechazo(salida, ventana, false)
          return
        }

        alTerminar?.(salida)
        // El ok puede llegar con la traba ya puesta: salió antes del cambio de cuenta.
        if (refrescar) iniciar(() => refrescarSiEsDeLaPestana(router))
      } finally {
        if (soltar) enCurso.current = false
      }
    })
  }

  return {
    ejecutar,
    enviando,
    resultado,
    error: resultado && !resultado.ok ? resultado.error : null,
    limpiar: () => setResultado(null),
  }
}

/**
 * Enviar un formulario a una acción de servidor: un envío por toque, el botón
 * desactivado desde el primer toque, y lo escrito a salvo si el servidor lo
 * rechaza.
 *
 * Existe porque el patrón anterior —`<form action={enviar}>` con un `useState`
 * para «enviando»— tenía dos defectos, medidos en el despliegue el 2026-09-10
 * con `herramientas/recorrido/doble-toque.mjs`:
 *
 * 1. **Cada toque de más se enviaba.** La función de un `<form action>` corre
 *    dentro de una transición, y React 19 no pinta lo que cambia adentro hasta
 *    que la acción termina: el `setEnviando(true)` no llegaba a la pantalla, el
 *    botón seguía activo y cada toque quedaba en cola. Un reporte de flota
 *    entró tres veces con un segundo de diferencia; antes habían entrado dos
 *    contactos iguales igual, y se culpó al tiempo entre el clic y el
 *    repintado. `isPending` de `useTransition` sí se pinta al instante, y la
 *    referencia corta el reingreso aunque React todavía no haya pintado nada.
 * 2. **Un rechazo borraba lo escrito.** React vacía un `<form action>` al
 *    terminar la acción, haya salido bien o mal: el supervisor que escribió un
 *    reporte largo lo perdía con el primer «Cuenta qué se le hizo hoy». Con
 *    `onSubmit` React no toca el formulario. Tampoco se vacía al salir bien, y
 *    no hace falta: la `Ventana` desmonta lo suyo al cerrarse, y un
 *    `form.reset()` a ciegas devolvería los campos controlados (el programa de
 *    taller) a un valor que el estado ya no tiene.
 *
 * Uso:
 *
 *   const { alEnviar, enviando, error } = useEnvio(accion, () => setAbierto(false))
 *   <form onSubmit={alEnviar}> … <Boton type="submit" cargando={enviando}>
 *
 * Lo que no está en un campo —las fotos ya subidas— se agrega al enviar:
 * `onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', …))}`.
 */
export function useEnvio<T = never>(
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion<T>>,
  alTerminar?: (resultado: Exito<T>) => void,
  opciones: Opciones = {},
) {
  const { ejecutar, ...resto } = useAccion(accion, alTerminar, opciones)

  function alEnviar(evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) {
    evento.preventDefault()
    const datos = new FormData(evento.currentTarget)
    preparar?.(datos)
    ejecutar(datos)
  }

  return { alEnviar, ...resto }
}

/**
 * El id de un envío que vive fuera de su ventana (el pago de la tarjeta, la OS,
 * el RQ). Se conserva hasta saber cómo terminó: tras «No llegó la respuesta»,
 * cancelar y volver a abrir lleva el mismo, y lo repetido dice que ya quedó en
 * vez de entrar dos veces (decimocuarta pasada).
 *
 * Al volver a abrir se pregunta a la base si aquel envío entró
 * (`consultarEnvio`). Si entró, lo que se escriba ahora es otro documento u otro
 * pago: con el mismo id, la OS, el RQ o el subcontrato siguiente decía «ya
 * quedó» y no se guardaba, aunque la lista ya mostrara el primero (decimosexta
 * pasada). Entonces la ventana dice cuál quedó (`anterior`) y lleva un id nuevo.
 * Mientras la base no contesta, o si no entró, sigue el mismo: lo peor es un «ya
 * quedó» que se cierra, nunca un documento doble. Antes se adivinaba por el
 * estado de la pantalla —el saldo había bajado—, y tras ponerse al día el mismo
 * pago entraba dos veces sin que nada lo dijera (decimosexta pasada). La nota
 * se queda hasta el envío siguiente, también al cerrar y volver a abrir: se
 * borraba al abrir, y si la respuesta había llegado con la ventana cerrada, la
 * ventana salía muda con un id nuevo y lo mismo enviado otra vez entraba dos
 * veces (decimoséptima pasada).
 *
 * Sin `clave` no se pregunta: es el id de algo que sale con el documento (su
 * factura, su contrato), y se renueva con él (`alEntrar`). Con `donde`, se
 * guarda en la pestaña como el del documento: tras una recarga, su archivo
 * vuelve a la misma ruta y no queda uno suelto.
 *
 * El id pendiente se guarda también en la pestaña (`sessionStorage`), por
 * `clave` y por `donde` —la fila de la ventana: la OC que se paga, el recibo—,
 * porque al cerrar tras «No llegó la respuesta» la pantalla se pone al día, y si
 * ese refresco no llega (sin señal, el servidor que reinicia, un despliegue),
 * Next recarga la página entera. La memoria se borraba, la ventana no
 * preguntaba y el mismo pago o el mismo RQ entraba dos veces (decimoctava
 * pasada). `donde` separa las filas: sin él, el pendiente de una OC lo tomaba la
 * ventana de otra.
 *
 * Y va por la cuenta con que se pintó la pantalla (`entroLaCuenta`), pero lo
 * juzga quien lo registró. Al abrir se pregunta por lo pendiente de ese lugar
 * con todas las cuentas que pasaron por la pestaña, y la base contesta con la
 * cuenta de la sesión (vigésima pasada):
 * - Lo que quedó registrado por la sesión se le dice, aunque se haya mandado
 *   desde una pantalla pintada con otra cuenta: antes la llave de esa cuenta no
 *   se leía y la OC entraba dos veces.
 * - Lo que otra cuenta registró con lo pendiente de otra llave no se le cuenta
 *   ni se toca: si la primera vuelve, lo suyo sigue pendiente (decimonovena
 *   pasada). Lo pendiente de la llave de esta pantalla sí se dice aunque lo haya
 *   registrado otra: salió de aquí. Va con su número y con el puesto de quien
 *   tenía la sesión (vigesimoprimera pasada).
 * - Si la sesión no es la de la pantalla, en otra pestaña entró otra cuenta: la
 *   pestaña se traba (`laPestanaEsDeOtraCuenta`) y lo pendiente no se toca. La
 *   respuesta de la pregunta dice con qué cuenta está la sesión, y vale solo si
 *   la cookie de la sesión no se puede leer: la cookie es más nueva.
 *
 * Uso: `abrir()` al abrir la ventana, `salio()` al enviar (dentro de la acción),
 * `otro()` con el ok y con `alYaEntrar`; `anterior`, dentro de la ventana
 * (`EnvioAnterior`).
 */
export function useIdDelEnvio(clave?: ClaveDelEnvio, alEntrar?: (cuentas: Cuentas) => void, donde = '') {
  const [id, setId] = useState<string | null>(null)
  const [anterior, setAnterior] = useState<string | null>(null)
  // El id que salió sin que se sepa cómo terminó, y de qué cuenta.
  const pendiente = useRef<{ cuenta: string | null; id: string } | null>(null)
  // Cambia con cada apertura y cada envío: la respuesta de una consulta vieja no pisa lo que vino después.
  const turno = useRef(0)
  const lugar = clave ? `${clave}:${donde}` : donde
  function llave(cuenta = cuentaDeLaPestana) {
    if (!cuenta || !lugar) return null
    return `${PENDIENTE}${cuenta}:${lugar}`
  }
  function anotar(valor: string | null) {
    pendiente.current = valor ? { cuenta: cuentaDeLaPestana, id: valor } : null
    const enLaPestana = llave()
    if (enLaPestana) guardarEnLaPestana(enLaPestana, valor)
  }
  function nuevo() {
    turno.current++
    setAnterior(null)
    anotar(null)
    setId(crypto.randomUUID())
  }
  return {
    id,
    anterior,
    abrir() {
      // La ventana se abre ya trabada si la sesión cambió sin que nada avisara.
      laPestanaEsDeOtraCuenta()
      // Tras una recarga la memoria está vacía, y lo pendiente sigue en la pestaña.
      const cuenta = cuentaDeLaPestana
      const propia = llave(cuenta)
      const enMemoria = pendiente.current?.cuenta === cuenta ? pendiente.current.id : null
      const previo = enMemoria ?? (propia ? leerDeLaPestana(propia) : null)
      pendiente.current = previo ? { cuenta, id: previo } : null
      const este = ++turno.current
      setId(previo ?? crypto.randomUUID())
      if (!clave) return
      // Lo que quedó pendiente aquí con otras cuentas: lo mandado desde una
      // pantalla pintada con otra cuenta quedó en la llave de esa.
      const ajenos = lugar ? pendientesEnLaPestana(lugar).filter((p) => p.llave !== propia && p.id !== previo) : []
      const ids = [...(previo ? [previo] : []), ...ajenos.map((p) => p.id)].slice(0, MAXIMO_PENDIENTES)
      const pregunta = preguntaDeLaSesion()
      consultarEnvio(clave, ids).then(
        (respuesta) => {
          if (!respuesta || !cuenta) return
          const deOtra = respuesta.cuenta !== cuenta
          pregunta(respuesta.cuenta, respuesta.puesto, respuesta.nombre)
          // Lo pendiente lo resuelve la pantalla pintada con la cuenta que entró.
          if (deOtra || turno.current !== este) return
          const propios: LoQueEntro[] = []
          let deOtraCuenta: LoQueEntro | null = null
          const entraron: (string | null)[] = []
          const suyo = previo ? respuesta.entraron[previo] : undefined
          if (suyo) {
            // Entró, con esta cuenta o con la que había en la sesión al enviarlo.
            anotar(null)
            setId(crypto.randomUUID())
            if (suyo.autor) deOtraCuenta = suyo
            else propios.push(suyo)
            entraron.push(cuenta)
          }
          for (const p of ajenos) {
            const lo = respuesta.entraron[p.id]
            if (!lo || lo.autor) continue
            soltarDeLaPestana(p.llave, p.id)
            propios.push(lo)
            entraron.push(p.cuenta)
          }
          if (entraron.length === 0) return
          setAnterior(contarLoQueEntro(propios, deOtraCuenta))
          alEntrar?.(entraron)
        },
        // Sin respuesta tampoco se sabe: sigue el mismo id.
        () => {},
      )
    },
    salio() {
      if (laPestanaEsDeOtraCuenta()) throw new OtraCuentaEnLaPestana()
      turno.current++
      setAnterior(null)
      if (id) anotar(id)
    },
    /**
     * Un id nuevo. Con `cuentas` —las de los envíos que, al abrir, la base dijo
     * que entraron (`alEntrar`)—, solo si entre ellas está la de la pantalla; de
     * las otras se suelta lo pendiente de este lugar: el comprobante de la OC
     * que entró desde la pantalla de otra cuenta, que esa cuenta volvería a usar.
     */
    otro(cuentas?: Cuentas) {
      if (!cuentas) return nuevo()
      for (const otra of cuentas) {
        const suya = otra && otra !== cuentaDeLaPestana ? llave(otra) : null
        if (suya) guardarEnLaPestana(suya, null)
      }
      if (cuentas.includes(cuentaDeLaPestana)) nuevo()
    },
  }
}

/** Las cuentas cuyos envíos pendientes entraron: `null`, la pantalla sin cuenta todavía. */
type Cuentas = readonly (string | null)[]

const PENDIENTE = 'metal-work:envio-pendiente:'
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// La pestaña puede no dejar guardar (navegación privada, almacenamiento lleno):
// entonces vale solo la memoria, como antes.
function leerDeLaPestana(llave: string): string | null {
  try {
    const valor = sessionStorage.getItem(llave)
    return valor && ES_UUID.test(valor) ? valor : null
  } catch {
    return null
  }
}

function guardarEnLaPestana(llave: string, valor: string | null) {
  try {
    if (valor) sessionStorage.setItem(llave, valor)
    else sessionStorage.removeItem(llave)
  } catch {}
}

/** Lo pendiente de ese lugar con cada cuenta que pasó por la pestaña: `<PENDIENTE><cuenta>:<lugar>`. */
function pendientesEnLaPestana(lugar: string): { llave: string; cuenta: string; id: string }[] {
  const hallados: { llave: string; cuenta: string; id: string }[] = []
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const llave = sessionStorage.key(i)
      if (!llave?.startsWith(PENDIENTE)) continue
      const cuenta = llave.slice(PENDIENTE.length, PENDIENTE.length + 36)
      if (!ES_UUID.test(cuenta) || llave.slice(PENDIENTE.length + 36) !== `:${lugar}`) continue
      const id = leerDeLaPestana(llave)
      if (id && !hallados.some((h) => h.id === id)) hallados.push({ llave, cuenta, id })
    }
  } catch {}
  return hallados
}

/** Suelta lo pendiente de esa llave si sigue siendo ese id. */
function soltarDeLaPestana(llave: string, id: string) {
  if (leerDeLaPestana(llave) === id) guardarEnLaPestana(llave, null)
}

let cuentaDeLaPestana: string | null = null

/**
 * La cuenta con la que se pintó la pantalla (`CuentaDeLaPestana`, en el layout).
 * Lo pendiente se guarda con ella: si en la pestaña entra otra persona, su
 * ventana no reusa ese id, y si vuelve la primera, lo suyo sigue pendiente. Se
 * toma del servidor y no del ingreso: se entra también por el enlace de
 * recuperación, y en otra pestaña. Solo la pone el layout: la respuesta de la
 * base con otra cuenta no la cambia, porque la pantalla sigue siendo la de antes.
 *
 * Pintarse con la sesión destraba la pestaña: la pantalla ya es de esa cuenta,
 * salvo que la cookie diga que mientras llegaba la página entró otra. Y se avisa
 * a las otras pestañas del navegador, que comparten la sesión
 * (`escucharLaSesion`).
 */
export function entroLaCuenta(usuario: string, puesto: string, nombre: string) {
  // Lo que esperaba a la cuenta de antes (`cuandoVuelvaLaCuenta`) no es de esta: se suelta.
  if (cuentaDeLaPestana !== null && cuentaDeLaPestana !== usuario) alVolver.clear()
  cuentaDeLaPestana = usuario
  conocer(usuario, puesto, nombre)
  noticias++
  // De una vez: destrabar y volver a trabar corría lo que esperaba a la cuenta
  // con la sesión de la otra.
  if (!revisarLaSesion()) marcarOtraCuenta(null)
  escucharLaSesion()
  try {
    canal?.postMessage({ usuario, puesto, nombre })
  } catch {}
}

/** El puesto y el nombre de cada cuenta que se supo en esta pestaña: con ellos se nombran en la traba. */
const conocidas = new Map<string, { puesto: string; nombre: string }>()

function conocer(usuario: string, puesto: unknown, nombre: unknown) {
  if (typeof puesto !== 'string' || !puesto) return
  conocidas.set(usuario, { puesto, nombre: typeof nombre === 'string' ? nombre : '' })
}

const CANAL = 'metal-work:cuenta'
let canal: BroadcastChannel | null = null
let escuchando = false

/**
 * Cómo se entera la pestaña de que la sesión ya no es la suya, sin esperar a
 * que se envíe nada:
 * - La cookie de la sesión cambia en el momento en que otra pestaña entra: el
 *   navegador que lo cuenta (`cookieStore`) traba al instante, y en todos se
 *   vuelve a mirar al volver a la pestaña.
 * - La otra pestaña avisa cuando termina de pintarse (`BroadcastChannel`), con
 *   el puesto y el nombre de quien entró. El aviso no se cree solo si la cookie
 *   se puede leer: un aviso viejo —la página de una tercera pestaña que llegó
 *   tarde— destrababa una pestaña que ya tenía la sesión de otra
 *   (vigesimosegunda pasada).
 * Lo que no se pueda usar (un navegador sin `cookieStore`, sin
 * `BroadcastChannel`) se deja: queda lo demás, y se mira otra vez al enviar.
 */
function escucharLaSesion() {
  if (escuchando) return
  escuchando = true
  try {
    canal = new BroadcastChannel(CANAL)
    canal.onmessage = ({ data }: MessageEvent<{ usuario?: unknown; puesto?: unknown; nombre?: unknown }>) => {
      if (!cuentaDeLaPestana || typeof data?.usuario !== 'string') return
      conocer(data.usuario, data.puesto, data.nombre)
      if (revisarLaSesion()) return
      noticias++
      marcarOtraCuenta(data.usuario === cuentaDeLaPestana ? null : textoOtraCuenta(data.usuario))
    }
  } catch {}
  try {
    ;(globalThis as { cookieStore?: EventTarget }).cookieStore?.addEventListener('change', () => revisarLaSesion())
  } catch {}
  window.addEventListener('focus', () => revisarLaSesion())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisarLaSesion()
  })
}

/**
 * Mira la cookie y traba o destraba según de quién sea la sesión. `false` si la
 * cookie no dice nada: entonces vale lo que digan el aviso y la pregunta.
 */
function revisarLaSesion(): boolean {
  if (!cuentaDeLaPestana || typeof document === 'undefined') return false
  const sesion = cuentaEnLaCookie()
  if (!sesion) return false
  noticias++
  marcarOtraCuenta(sesion === cuentaDeLaPestana ? null : textoOtraCuenta(sesion))
  return true
}

/**
 * Si esta pestaña es de otra cuenta que la de la sesión. Se mira la cookie en
 * el acto: lo llama todo lo que envía (`useAccion`, `salio()`, los formularios
 * que suben por su cuenta) antes de salir. El aviso de la otra pestaña llega
 * cuando esa termina de pintarse —3,5 s en el banco—, y lo enviado en ese rato,
 * o desde una ventana abierta antes del cambio sin aviso, entraba a nombre de la
 * otra cuenta (vigesimosegunda pasada).
 */
export function laPestanaEsDeOtraCuenta() {
  revisarLaSesion()
  return otraCuenta !== null
}

/**
 * La pregunta al abrir una ventana (`consultarEnvio`) también dice con qué
 * cuenta está la sesión. Vale solo si la cookie no se puede leer, y solo la de
 * la última pregunta y si mientras tanto no llegó otra noticia: con dos
 * aperturas seguidas, la respuesta de la primera gastaba la noticia y la de la
 * segunda, que decía «otra cuenta», se ignoraba (vigesimosegunda pasada).
 */
function preguntaDeLaSesion() {
  const esta = ++preguntas
  const visto = noticias
  return (cuenta: string, puesto: string, nombre: string) => {
    conocer(cuenta, puesto, nombre)
    if (revisarLaSesion() || esta !== preguntas || visto !== noticias || !cuentaDeLaPestana) return
    marcarOtraCuenta(cuenta === cuentaDeLaPestana ? null : textoOtraCuenta(cuenta))
  }
}

/**
 * Con qué cuenta está la sesión según su cookie, la que el navegador manda con
 * cada envío. La de Supabase (`sb-<proyecto>-auth-token`, en trozos `.0`, `.1`
 * si es larga) lleva la sesión en JSON, en base64 desde `@supabase/ssr` 0.4, y
 * se puede leer desde la página (`httpOnly: false`, como la deja `@supabase/ssr`
 * para su cliente del navegador). `undefined` si no se puede saber: sin cookie,
 * con varias o con un formato que no se reconoce. Entonces la cookie no traba
 * nada: leerla mal trabaría a todos.
 */
function cuentaEnLaCookie(): string | undefined {
  try {
    const trozos = new Map<string, Map<number, string>>()
    for (const par of document.cookie.split(';')) {
      const igual = par.indexOf('=')
      if (igual < 0) continue
      const coincide = COOKIE_DE_LA_SESION.exec(par.slice(0, igual).trim())
      if (!coincide) continue
      const deEsa = trozos.get(coincide[1]) ?? new Map<number, string>()
      deEsa.set(coincide[2] === undefined ? -1 : Number(coincide[2]), par.slice(igual + 1).trim())
      trozos.set(coincide[1], deEsa)
    }
    if (trozos.size !== 1) return undefined
    const [partes] = trozos.values()
    let valor = partes.get(-1)
    if (valor === undefined) {
      const orden = [...partes.keys()].sort((a, b) => a - b)
      if (orden.some((n, i) => n !== i)) return undefined
      valor = orden.map((n) => partes.get(n)).join('')
    }
    let texto = decodeURIComponent(valor)
    if (texto.startsWith(BASE64)) texto = desdeBase64Url(texto.slice(BASE64.length))
    const id = idDeLaSesion(JSON.parse(texto))
    return id && ES_UUID.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

const COOKIE_DE_LA_SESION = /^(sb-.+-auth-token)(?:\.(0|[1-9]\d*))?$/
const BASE64 = 'base64-'

function idDeLaSesion(sesion: unknown): string | undefined {
  if (!sesion || typeof sesion !== 'object') return undefined
  const { user, access_token } = sesion as { user?: { id?: unknown }; access_token?: unknown }
  if (typeof user?.id === 'string') return user.id
  if (typeof access_token !== 'string') return undefined
  const carga = access_token.split('.')[1]
  if (!carga) return undefined
  const { sub } = JSON.parse(desdeBase64Url(carga)) as { sub?: unknown }
  return typeof sub === 'string' ? sub : undefined
}

function desdeBase64Url(texto: string) {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
  return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)))
}

/**
 * Lo que dice la pantalla si en otra pestaña del mismo navegador entró otra
 * cuenta: la sesión ya es de ella, y esta pantalla, pintada con la anterior,
 * enviaría a su nombre. El egreso, la OC o el recibo entraban con la otra
 * persona sin que nada lo dijera, y con lo que esa no puede ver salía «No
 * tienes permiso» (vigésima y vigesimoprimera pasada). Mientras dure, la
 * pantalla entera queda debajo de una traba que solo ofrece recargar
 * (`CuentaDeLaPestana`) y nada se envía (`laPestanaEsDeOtraCuenta`).
 */
let otraCuenta: string | null = null
// Cuenta las noticias de la sesión (la cookie, el aviso, la pantalla pintada): la respuesta de una pregunta que salió antes no pisa lo que llegó después.
let noticias = 0
// Cuenta las preguntas al abrir: vale la respuesta de la última.
let preguntas = 0
const vigias = new Set<() => void>()
// Lo que se dejó para cuando la pantalla vuelva a ser de la sesión (`cuandoVuelvaLaCuenta`).
const alVolver = new Set<() => void>()

function marcarOtraCuenta(texto: string | null) {
  if (otraCuenta === texto) return
  const estabaTrabada = otraCuenta !== null
  otraCuenta = texto
  for (const avisar of vigias) avisar()
  if (texto !== null || !estabaTrabada) return
  const pendientes = [...alVolver]
  alVolver.clear()
  for (const hacer of pendientes) hacer()
}

/**
 * Deja `hacer` para cuando la pantalla vuelva a ser de la sesión: lo que solo la
 * cuenta de la pantalla puede hacer, como quitar un archivo suyo que quedó
 * suelto, o ponerse al día. Con la traba puesta, la sesión es de la otra cuenta:
 * Storage no la deja quitar el archivo de esta, y el refresco pinta su pantalla
 * y se lleva la traba. Si en vez de volver se recarga, no se hace.
 */
export function cuandoVuelvaLaCuenta(hacer: () => void) {
  alVolver.add(hacer)
}

/**
 * Para seguir una cadena de pasos (subir y anotar, fila por fila, tanda por
 * tanda): lanza `OtraCuentaEnLaPestana` si la sesión ya es de otra cuenta. El
 * primer toque se mira en `useAccion` y `salio()`, pero lo que sigue sale con la
 * sesión que haya en ese momento: el comprobante de la OC quedaba subido por la
 * cuenta que entró en otra pestaña a media subida (vigesimotercera pasada).
 */
export function seguirConLaCuentaDeLaPestana() {
  if (laPestanaEsDeOtraCuenta()) throw new OtraCuentaEnLaPestana()
}

/** Lo que se dice cuando el paso que sigue a uno que ya quedó no sale porque entró otra cuenta. */
export const ENTRO_OTRA_CUENTA = 'En otra pestaña entró otra cuenta.'

/**
 * El paso que sigue a uno que ya quedó (el comprobante de la OC recién
 * emitida, el contrato del subcontrato recién registrado). Si la sesión cambió,
 * no lanza: lo que sí quedó no se diría y la ventana seguiría abierta como si
 * nada. Devuelve `ENTRO_OTRA_CUENTA` para que se diga qué falta y dónde hacerlo.
 */
export async function pasoTrasLoQueQuedo<T>(paso: () => Promise<ResultadoAccion<T>>): Promise<ResultadoAccion<T>> {
  try {
    return await paso()
  } catch (e) {
    if (e instanceof OtraCuentaEnLaPestana) return { ok: false, error: ENTRO_OTRA_CUENTA }
    throw e
  }
}

/**
 * Pone la pantalla al día tras un envío, salvo con la traba puesta: el refresco
 * la pintaba con la cuenta que entró en la otra pestaña, se llevaba la traba sin
 * que nadie recargara y anunciaba «Volvió la cuenta de» la que nunca estuvo
 * (vigesimotercera pasada). Entonces espera a que vuelva la de la pantalla,
 * como `RefrescoAlVolver`.
 */
export function refrescarSiEsDeLaPestana(router: { refresh(): void }) {
  if (!laPestanaEsDeOtraCuenta()) return router.refresh()
  cuandoVuelvaLaCuenta(() => startTransition(() => router.refresh()))
}

/**
 * Lo mismo para la pantalla a la que lleva un envío (la orden recién abierta, el
 * subcontrato recién registrado): con la traba puesta, se pintaría con la cuenta
 * que entró y se llevaría la traba. Espera a que vuelva la de la pantalla.
 */
export function navegarSiEsDeLaPestana(router: { push(url: string): void }, url: string) {
  if (!laPestanaEsDeOtraCuenta()) return router.push(url)
  cuandoVuelvaLaCuenta(() => startTransition(() => router.push(url)))
}

function vigilar(avisar: () => void) {
  vigias.add(avisar)
  return () => {
    vigias.delete(avisar)
  }
}

/** El aviso de que en otra pestaña entró otra cuenta, o `null` si esta pantalla es de la sesión. */
export function useOtraCuentaEnLaPestana() {
  return useSyncExternalStore(
    vigilar,
    () => otraCuenta,
    () => null,
  )
}

/**
 * Con el puesto de las dos cuentas, que es como las nombra el menú, y con el
 * nombre si las dos son del mismo puesto. Lo que no pierde lo escrito va
 * primero: recargar lo pierde, y antes se ofrecía primero y sin decirlo
 * (vigesimosegunda pasada).
 */
function textoOtraCuenta(usuarioQueEntro: string) {
  const pintada = cuentaDeLaPestana ? conocidas.get(cuentaDeLaPestana) : undefined
  if (!pintada) {
    return 'Esta pantalla se abrió con otra cuenta que la que entró en otra pestaña: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con la anterior en esa pestaña. Si recargas, sigues con la que entró y se pierde lo escrito aquí.'
  }
  const entro = conocidas.get(usuarioQueEntro)
  const mismoPuesto = entro?.puesto === pintada.puesto
  const nombrar = (c: { puesto: string; nombre: string }) => (mismoPuesto && c.nombre ? `${c.nombre} (${c.puesto})` : c.puesto)
  const aqui = nombrar(pintada)
  const alla = entro && (!mismoPuesto || entro.nombre) ? nombrar(entro) : null
  if (!alla) {
    return `Esta pantalla se abrió con la cuenta de ${aqui}, y en otra pestaña entró otra: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con ${aqui} en esa pestaña. Si recargas, sigues con la cuenta que entró y se pierde lo escrito aquí.`
  }
  return `Esta pantalla se abrió con la cuenta de ${aqui}, y en otra pestaña entró la de ${alla}: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con ${aqui} en esa pestaña. Si recargas, sigues con ${alla} y se pierde lo escrito aquí.`
}

/**
 * Mientras se envía, los campos están trabados (`fieldset disabled`) y el cursor
 * se pierde. Si el envío termina en un rechazo, el cursor va a lo que lo explica
 * —el campo que la base rechazó o el aviso—, para que el teclado y el lector de
 * pantalla sigan donde estaban. `destino` se mira en ese momento: el aviso
 * todavía no existe cuando empieza el envío.
 */
export function useCursorAlRechazo(enviando: boolean, rechazo: string | null, destino: () => HTMLElement | null) {
  const enviaba = useRef(false)
  useEffect(() => {
    if (enviando) {
      enviaba.current = true
      return
    }
    if (!enviaba.current) return
    enviaba.current = false
    if (rechazo) destino()?.focus()
  }, [enviando, rechazo, destino])
}

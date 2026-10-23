import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'

import { consultarEnvio } from '@/app/(app)/acciones-envio'
import { pudoHaberEntrado, yaEntroLaPrimeraVez, type ResultadoAccion } from '@/lib/acciones'
import { MAXIMO_PENDIENTES, type ClaveDelEnvio } from '@/lib/dominio/envios'
import { alCerrarLaVentana, hayVentanaAbierta, vecesQueSeCerro } from '@/lib/ventanas-abiertas'

type Exito<T> = Extract<ResultadoAccion<T>, { ok: true }>

/**
 * Lo que se dice cuando la acción no contesta: se cortó la señal, o el
 * servidor cayó a medio camino. La escritura pudo entrar igual, así que se pide
 * mirar antes de repetirla.
 */
export const SIN_RESPUESTA = 'No llegó la respuesta. Revisa la conexión y mira si quedó guardado antes de volver a intentar.'

/**
 * Lo que dice la ventana de una pantalla que se pintó con una cuenta cuando en
 * otra pestaña entró otra (`useIdDelEnvio`). `EnvioAnterior` lo pinta con el
 * botón que recarga.
 */
export const OTRA_CUENTA =
  'En otra pestaña entró otra cuenta y esta pantalla todavía es de la anterior. Recarga la pantalla antes de registrar: desde aquí no se envía nada.'

/** Lo que se enviaba desde esta pantalla entró con la sesión de otra cuenta, que entró en otra pestaña. */
const QUEDO_CON_OTRA_CUENTA =
  'Lo que se envió antes desde esta pestaña sí quedó, a nombre de la cuenta que entró en otra pestaña. Lo que registres ahora será otro.'

/** Con lo que `salio()` frena el envío desde una pantalla que es de otra cuenta. */
class OtraCuentaEnLaPestana extends Error {
  constructor() {
    super('No se envió: esta pantalla es de la cuenta anterior. Recárgala para registrar con la cuenta que entró.')
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
      if (ponerAlDia) iniciar(() => router.refresh())
      return
    }
    const soltar = () => {
      setResultado((r) => (r === salida ? null : r))
      if (yaEntro) alYaEntrar?.()
    }
    const alCerrar = () => {
      soltar()
      if (ponerAlDia) router.refresh()
    }
    if (ventana === vecesQueSeCerro() && alCerrarLaVentana(alCerrar)) return
    // La ventana del envío ya se cerró: la que esté abierta ahora es otra. El
    // aviso se suelta fuera de la transición: dentro esperaba al refresco, y
    // con la señal lenta la ventana que se volvía a abrir salía trabada con el
    // «ya quedó» del envío anterior. Sin otra ventana, el rechazo se queda.
    if (yaEntro || hayVentanaAbierta()) soltar()
    if (ponerAlDia) iniciar(() => router.refresh())
  }

  function ejecutar(datos: FormData) {
    if (enCurso.current) return
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
          let mensaje: string
          try {
            mensaje = explicarFallo(e)
          } catch (deNext) {
            soltar = false
            throw deNext
          }
          const fallo: ResultadoAccion<T> = { ok: false, error: mensaje }
          setResultado(fallo)
          // Lo que frena `salio()` no salió: no hay nada que poner al día al cerrar.
          despuesDelRechazo(fallo, ventana, !(e instanceof OtraCuentaEnLaPestana))
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
        if (refrescar) iniciar(() => router.refresh())
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
 * - Lo de otra cuenta no se le cuenta ni se toca: si la primera vuelve, lo suyo
 *   sigue pendiente (decimonovena pasada).
 * - Si la sesión no es la de la pantalla, en otra pestaña entró otra cuenta: la
 *   ventana lo dice (`OTRA_CUENTA`) y no envía hasta recargar. Antes enviaba con
 *   la sesión nueva sin decirlo, y lo pendiente se perdía de vista.
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
  // La base contestó con otra cuenta que la de la pantalla: no se envía hasta recargar.
  const deOtraCuenta = useRef(false)
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
      // Tras una recarga la memoria está vacía, y lo pendiente sigue en la pestaña.
      const cuenta = cuentaDeLaPestana
      const propia = llave(cuenta)
      const enMemoria = pendiente.current?.cuenta === cuenta ? pendiente.current.id : null
      const previo = enMemoria ?? (propia ? leerDeLaPestana(propia) : null)
      pendiente.current = previo ? { cuenta, id: previo } : null
      deOtraCuenta.current = false
      setAnterior((a) => (a === OTRA_CUENTA ? null : a))
      const este = ++turno.current
      setId(previo ?? crypto.randomUUID())
      if (!clave) return
      // Lo que quedó pendiente aquí con otras cuentas: lo mandado desde una
      // pantalla pintada con otra cuenta quedó en la llave de esa.
      const ajenos = lugar ? pendientesEnLaPestana(lugar).filter((p) => p.llave !== propia && p.id !== previo) : []
      const ids = [...(previo ? [previo] : []), ...ajenos.map((p) => p.id)].slice(0, MAXIMO_PENDIENTES)
      if (ids.length === 0) return
      consultarEnvio(clave, ids).then(
        (respuesta) => {
          if (!respuesta || turno.current !== este) return
          if (cuenta && respuesta.cuenta !== cuenta) {
            // En otra pestaña entró otra cuenta. Lo pendiente se queda como
            // está: lo resuelve la pantalla recargada, con la cuenta que entró.
            deOtraCuenta.current = true
            setAnterior(OTRA_CUENTA)
            return
          }
          const notas: string[] = []
          const entraron: (string | null)[] = []
          const suyo = previo ? respuesta.entraron[previo] : undefined
          if (suyo !== undefined) {
            // Entró, con esta cuenta o con la que había en la sesión al enviarlo.
            anotar(null)
            setId(crypto.randomUUID())
            notas.push(suyo === false ? QUEDO_CON_OTRA_CUENTA : suyo)
            entraron.push(cuenta)
          }
          for (const p of ajenos) {
            const lo = respuesta.entraron[p.id]
            if (typeof lo !== 'string') continue
            soltarDeLaPestana(p.llave, p.id)
            notas.push(lo)
            entraron.push(p.cuenta)
          }
          if (notas.length === 0) return
          setAnterior(notas.join(' '))
          alEntrar?.(entraron)
        },
        // Sin respuesta tampoco se sabe: sigue el mismo id.
        () => {},
      )
    },
    salio() {
      if (deOtraCuenta.current) throw new OtraCuentaEnLaPestana()
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
 */
export function entroLaCuenta(usuario: string) {
  cuentaDeLaPestana = usuario
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

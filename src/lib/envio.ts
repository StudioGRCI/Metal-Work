import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'

import { yaEntroLaPrimeraVez, type ResultadoAccion } from '@/lib/acciones'
import { alCerrarLaVentana, hayVentanaAbierta, vecesQueSeCerro } from '@/lib/ventanas-abiertas'

type Exito<T> = Extract<ResultadoAccion<T>, { ok: true }>

/**
 * Lo que se dice cuando la acción no contesta: se cortó la señal, o el
 * servidor cayó a medio camino. La escritura pudo entrar igual, así que se pide
 * mirar antes de repetirla.
 */
export const SIN_RESPUESTA = 'No llegó la respuesta. Revisa la conexión y mira si quedó guardado antes de volver a intentar.'

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
   * Lo que sigue a un envío que no salió bien. El aviso de una ventana se va con
   * ella: si el envío vive fuera (el pago de la tarjeta), volvía a abrirse con el
   * aviso viejo y, si era un «ya quedó», sin el botón que envía, hasta recargar.
   * Pasaba también cerrándola mientras se enviaba: la respuesta llegaba después.
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
    const pudoEntrar = lanzo || salida.error.startsWith('No llegó la respuesta')
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
    // «ya quedó» del envío anterior.
    soltar()
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

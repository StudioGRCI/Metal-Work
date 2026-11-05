'use client'

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { useCursorAlRechazo, useEnviosEnCamino, useVersionDeLaPestana, volverACargar, volverACargarSinEsperarLoQueVa } from '@/lib/envio'
import { cn } from '@/lib/utils'
import { abrioVentana, cerroVentana, esLaUltimaVentana, trabaDe, vigilarLasTrabas } from '@/lib/ventanas-abiertas'

/**
 * Lo que se puede enfocar dentro de la ventana. Sirve para dos cosas: llevar el
 * foco al primer control al abrir, y hacer que el tabulador dé la vuelta
 * adentro en vez de escaparse a la página de atrás. Lo que lleva
 * `tabindex="-1"` no cuenta: el tabulador no pasa por ahí, como el `<select>`
 * transparente con que `SeleccionBuscable` envía su valor, que se llevaba el
 * foco al abrir la salida del kardex.
 */
const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(', ')

/**
 * Que de verdad pueda llevar el cursor: un campo dentro de un `<fieldset
 * disabled>` no lleva `disabled` propio y el selector lo daba por enfocable. La
 * ventana que se abría con su envío todavía en camino dejaba el cursor detrás:
 * Escape no cerraba y el tabulador recorría la página (vigesimoctava pasada).
 */
const llevaElCursor = (e: HTMLElement) => !e.matches(':disabled')
const enfocablesDe = (raiz: HTMLElement | null) =>
  [...(raiz?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [])].filter(llevaElCursor)

const ANCHOS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  panoramico: 'max-w-[min(96vw,90rem)] h-[calc(100dvh-2rem)]',
} as const

export type AnchoVentana = keyof typeof ANCHOS

/** El documento no cambia: solo importa si ya se está en el navegador. */
const sinSuscripcion = () => () => {}

/** Cómo está la ventana en la que se pinta (`trabaDe`): el pie no deja cancelar, o dice que ya entró. */
const TrabaDeLaVentana = createContext(0)

/**
 * Lo que el pie de la ventana tiene que saber de un envío suyo que termina
 * (`trabarLaVentana`): si se puede cancelar, si lo enviado ya entró y solo
 * falta la pantalla al día, o si la pantalla se pone al día para decir si entró.
 */
export function useTrabaDeLaVentana() {
  const traba = useContext(TrabaDeLaVentana)
  return { trabada: (traba & 2) !== 0, guardado: (traba & 1) !== 0, mirando: (traba & 4) !== 0 }
}

/** Lo que dice la ventana mientras espera a la pantalla al día, con lo enviado ya guardado. */
export const GUARDADO_PONIENDO_AL_DIA = 'Guardado. Poniendo la pantalla al día…'

/**
 * Cuánto se espera a la pantalla al día antes de decir que tarda. Lo normal es
 * menos de un segundo; con la señal del taller, unos pocos.
 */
const TARDA_EN_PONERSE_AL_DIA = 8000

/**
 * Cuánto se espera a que el envío de una ventana trabada conteste antes de
 * decir que no llega. Una corrección contesta en menos de un segundo; con la
 * señal del taller, en unos pocos, y decirlo antes empujaba a recargar a
 * medio envío.
 */
const TARDA_EN_CONTESTAR = 15_000

/**
 * La ventana del sistema: una sola, en lugar de las catorce que había copiadas.
 *
 * Cada pantalla tenía la suya y ninguna cerraba con Escape ni retenía el foco:
 * con el teclado uno se quedaba encerrado detrás del cuadro, tabulando por los
 * botones de una pantalla que ya no podía usar, y en el teléfono la ventana no
 * cabía y el botón de guardar quedaba al final del todo.
 *
 * Lo que hace, y que ninguna copia hacía entera:
 *
 * · Escape cierra, siempre. Es la tecla que todo el mundo prueba primero.
 * · El foco entra al primer control al abrir y vuelve al botón que la abrió al
 *   cerrar, que es donde la persona estaba mirando.
 * · El tabulador da la vuelta dentro de la ventana.
 * · La página de atrás no rueda mientras la ventana está abierta.
 * · Un toque al costado NO cierra por defecto. Estas ventanas son formularios y
 *   un roce con el pulgar borraba la placa, el chasis y las capacidades ya
 *   escritas. Para cerrar está la X, el botón de cancelar y Escape; quien tenga
 *   una ventana sin nada que perder puede pedir `cerrarAlTocarFuera`.
 *
 * Va en un portal a propósito: la ventana lleva su propio `<form>` y, dentro
 * del formulario que la abrió, quedarían anidados —HTML no lo permite y React
 * envía el de afuera—.
 */
export function Ventana({
  abierta,
  alCerrar,
  titulo,
  descripcion,
  ancho = 'md',
  cerrarAlTocarFuera = false,
  children,
}: {
  abierta: boolean
  alCerrar: () => void
  titulo: string
  descripcion?: string
  ancho?: AnchoVentana
  cerrarAlTocarFuera?: boolean
  children: React.ReactNode
}) {
  const caja = useRef<HTMLDivElement>(null)
  // La misma para cada vez que se abre: lo que la traba (`trabarLaVentana`) la
  // nombra con ella, y la ventana lo lee al pintarse.
  const [marca] = useState(() => ({}))
  const traba = useSyncExternalStore(vigilarLasTrabas, () => trabaDe(marca), () => 0)
  // Mientras un envío que corrige lo que la pantalla muestra termina, la
  // ventana no se cierra: vuelta a abrir antes de la pantalla al día, traía lo
  // de antes, y guardarla deshacía la corrección (quincuagésima tercera
  // pasada). Se mira la traba al momento, no la del último pintado.
  const cerrarSiSePuede = () => {
    if (trabaDe(marca) & 2) return
    alCerrar()
  }
  // El contenido tiene su propia referencia porque el foco al abrir tiene que
  // caer en el primer campo del formulario, no en la X. La X va antes en el
  // orden del documento, así que buscar desde la caja la encontraba siempre a
  // ella: se abría la ventana, el teclado del teléfono no subía, y un Enter
  // distraído la cerraba en vez de escribir.
  const contenido = useRef<HTMLDivElement>(null)
  // Para el Escape que llega con el cursor fuera de la ventana: el efecto no
  // vuelve a correr con cada render, y `alCerrar` cambia.
  const cerrar = useRef(cerrarSiSePuede)
  useEffect(() => {
    cerrar.current = cerrarSiSePuede
  })
  const idTitulo = useId()
  const idDescripcion = useId()
  const idVieja = useId()
  // Si la pestaña ya se sabía vieja al abrir: el aviso de dentro se lee con la ventana.
  const vieja = useVersionDeLaPestana().estado === 'vieja'
  const [abiertaAntes, setAbiertaAntes] = useState(abierta)
  const [viejaAlAbrir, setViejaAlAbrir] = useState(abierta && vieja)
  if (abierta !== abiertaAntes) {
    setAbiertaAntes(abierta)
    setViejaAlAbrir(abierta && vieja)
  }
  // En el servidor no hay documento al que colgar el portal, así que la
  // ventana no se pinta hasta que la página está hidratada. Una que nace
  // abierta (la salida que llega desde un RQ, `/almacen/kardex?rq=`) se pintaba
  // en la primera pasada del navegador, React no la encontraba en el HTML del
  // servidor y rehacía la página entera («Hydration failed»).
  const hidratada = useSyncExternalStore(sinSuscripcion, () => true, () => false)

  // Al abrir: se guarda quién tenía el foco, se lleva el foco adentro y se
  // traba el rodado de la página. Al cerrar, todo vuelve como estaba. No hay
  // estado que sincronizar acá, solo el documento.
  useEffect(() => {
    if (!abierta || !hidratada) return

    abrioVentana(marca)
    const veniaDe = document.activeElement as HTMLElement | null
    const rodadoPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // El foco va al primer campo, no a la «i» de su ayuda: con el foco en la
    // «i» el texto de ayuda se abría solo y tapaba el campo («Importar del
    // Excel», 2026-10-20).
    const primerCampo = (raiz: HTMLElement | null) => enfocablesDe(raiz).find((e) => !e.hasAttribute('data-ayuda'))
    const primero = primerCampo(contenido.current) ?? primerCampo(caja.current)
    ;(primero ?? caja.current)?.focus()
    // Si el campo no lo tomó, la ventana: el cursor no se queda detrás de ella.
    if (!caja.current?.contains(document.activeElement)) caja.current?.focus()

    // Escape cierra también cuando el cursor cayó a la página: un botón que se
    // apaga mientras envía lo suelta en el <body>, fuera de la ventana, y Escape
    // ya no cerraba (decimoquinta pasada). Solo la de encima y solo si el cursor
    // no está en otra parte que escuche su tecla.
    const escapeSuelto = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !esLaUltimaVentana(marca)) return
      if (document.activeElement && document.activeElement !== document.body) return
      cerrar.current()
    }
    document.addEventListener('keydown', escapeSuelto)

    return () => {
      document.removeEventListener('keydown', escapeSuelto)
      document.body.style.overflow = rodadoPrevio
      // Una ventana que nace abierta no tiene botón al que volver.
      if (veniaDe && veniaDe !== document.body) devolverElCursor(veniaDe)
      // Lo que esperaba a que se cerrara: la pantalla de detrás, al día.
      cerroVentana(marca)
    }
  }, [abierta, hidratada, marca])

  if (!abierta || !hidratada) return null

  function alTeclado(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      cerrarSiSePuede()
      return
    }

    if (e.key !== 'Tab') return

    const enfocables = enfocablesDe(caja.current)
    if (enfocables.length === 0) return

    const primero = enfocables[0]
    const ultimo = enfocables[enfocables.length - 1]

    // Con el cursor en la ventana misma, Mayús+Tab salía a la página de detrás.
    if (document.activeElement === caja.current) {
      e.preventDefault()
      ;(e.shiftKey ? ultimo : primero).focus()
    } else if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primero.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-black/50 p-0 sm:items-start sm:p-4 sm:py-10"
      // El envío de un formulario de la ventana es solo suyo: React lo deja
      // subir por el portal hasta el formulario de la pantalla que la abre, y
      // «Registrar unidad» en la orden nueva registraba también la orden, sin
      // su unidad y con el número del papel gastado (R3 de realización,
      // cuadragésima segunda pasada).
      onSubmit={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        // Solo el fondo, no un arrastre que empezó dentro y terminó afuera al
        // seleccionar texto.
        if (cerrarAlTocarFuera && e.target === e.currentTarget) cerrarSiSePuede()
      }}
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={[descripcion && idDescripcion, viejaAlAbrir && idVieja].filter(Boolean).join(' ') || undefined}
        tabIndex={-1}
        onKeyDown={alTeclado}
        className={cn(
          // En el teléfono sube desde abajo y ocupa lo que necesita, con el
          // contenido rodando adentro; en el monitor es el cuadro de siempre.
          'flex max-h-[92dvh] w-full flex-col rounded-t-[calc(var(--radius-base)*2)] border border-borde bg-superficie shadow-alta',
          'sm:rounded-[calc(var(--radius-base)*1.5)]',
          ANCHOS[ancho],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-borde px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-base font-semibold text-texto">
              {titulo}
            </h2>
            {descripcion && (
              <p id={idDescripcion} className="mt-1 text-xs text-texto-suave">
                {descripcion}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={cerrarSiSePuede}
            disabled={(traba & 2) !== 0}
            aria-label="Cerrar"
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 hover:text-texto disabled:opacity-40 sm:size-8"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div ref={contenido} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <SeActualizoEnLaVentana id={idVieja} alAbrir={viejaAlAbrir} />
          <TrabaDeLaVentana value={traba}>{children}</TrabaDeLaVentana>
          {/* Cada fase la dice de nuevo y cuenta su tiempo desde cero: el envío, la pregunta, la espera. */}
          {traba !== 0 && <MientrasSePoneAlDia key={(traba & 8) !== 0 ? 'preguntando' : (traba & 5) !== 0 ? 'espera' : 'envio'} traba={traba} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Arriba de la ventana, en una pestaña de antes del último despliegue: lo que
 * se envíe desde ella no va a entrar. El aviso de arriba de la pantalla queda
 * detrás del fondo, y la persona escribía la ventana entera para enterarse al
 * enviar (trigésima pasada). Si ya se sabía al abrir, se lee con la ventana
 * (`aria-describedby`). Si se sabe con ella abierta y nadie lo dijo (la
 * pregunta del envío anterior, al abrir), se anuncia: nace vacío y el texto
 * llega en la pintada siguiente. Si lo dijo el envío de la ventana, junto a su
 * botón, no se repite.
 */
function SeActualizoEnLaVentana({ id, alAbrir }: { id: string; alAbrir: boolean }) {
  const version = useVersionDeLaPestana()
  const [conTexto, setConTexto] = useState(alAbrir)
  const vieja = version.estado === 'vieja' && (alAbrir || !version.callado)
  useEffect(() => {
    if (!vieja || conTexto) return
    const cuadro = requestAnimationFrame(() => setConTexto(true))
    return () => cancelAnimationFrame(cuadro)
  }, [vieja, conTexto])
  if (!vieja) return null

  const texto = conTexto && (
    <p id={id} className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-texto" data-ventana-vieja>
      El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde esta ventana no va a entrar. Copia lo que tengas escrito y vuelve a cargar la
      pantalla.
    </p>
  )
  return alAbrir ? texto : <div role="status">{texto}</div>
}

/**
 * Debajo de los botones, mientras la ventana trabada espera (`trabarLaVentana`).
 * La pinta la ventana, no cada pie: de las veintitrés ventanas que corrigen,
 * dieciocho tienen su pie propio y no decían nada en esos segundos, con la X,
 * «Cancelar» y Escape apagados y solo el botón girando (D2 de diseño,
 * quincuagésima tercera pasada).
 *
 * Nace vacía y el texto llega en la pintada siguiente: la región que nace con
 * su texto no se anuncia, y el cronograma la traba ya guardado. Al decir algo
 * se lleva a la vista, con el margen de abajo de la ventana: debajo de los
 * botones no los empuja, y a 390, con la ventana rodada hasta el fondo, la
 * línea del pie sacaba «Guardar» por debajo del borde (D4 de diseño); llevada
 * a la vista sin margen, quedaba pegada al borde (D7, quincuagésima cuarta).
 *
 * Mientras espera a la pantalla al día, y si tarda más de ocho segundos, lo
 * dice. React no pinta la página nueva mientras haya otro envío de la pestaña
 * en camino —la captura de una cuenta nueva que sigue subiendo (H4 de
 * funcionalidad)—, y entonces dice que espera a ese. Sin otro, la pantalla se
 * colgó al ponerse al día (D3 de diseño): lo dice y ofrece volver a cargar,
 * que no pierde lo guardado. La ventana sigue sin cerrarse: cerrada, la
 * pantalla de detrás seguiría con lo de antes, y vuelta a abrir traería lo de
 * antes, que es lo que la traba evita.
 *
 * Tras «No llegó la respuesta», mientras se pregunta si el servidor contesta
 * (`preguntando`, hasta 3 s), dice que lo comprueba: el aviso rojo con el botón
 * girando y sin X parecía colgado (H4 de funcionalidad, quincuagésima cuarta).
 *
 * Mientras el envío no contesta, nada: el botón que gira basta. A los quince
 * segundos lo dice y ofrece volver a cargar sin esperarlo, que puede no volver
 * nunca: la ventana trabada no tenía otra salida que Atrás o F5 (F2 de la
 * crítica, quincuagésima cuarta pasada).
 */
function MientrasSePoneAlDia({ traba }: { traba: number }) {
  const guardado = (traba & 1) !== 0
  const preguntando = (traba & 8) !== 0
  const espera = guardado || (traba & 4) !== 0
  // Solo trabada: el envío todavía no contesta.
  const sinRespuesta = !espera && !preguntando
  const linea = useRef<HTMLDivElement>(null)
  const [conTexto, setConTexto] = useState(false)
  const [tarde, setTarde] = useState(false)
  const otros = useEnviosEnCamino()
  useEffect(() => {
    const cuadro = requestAnimationFrame(() => setConTexto(true))
    return () => cancelAnimationFrame(cuadro)
  }, [])
  useEffect(() => {
    if (preguntando) return
    const reloj = setTimeout(() => setTarde(true), espera ? TARDA_EN_PONERSE_AL_DIA : TARDA_EN_CONTESTAR)
    return () => clearTimeout(reloj)
  }, [espera, preguntando])
  const dice = conTexto && (preguntando || espera || tarde)
  useEffect(() => {
    if (dice) linea.current?.scrollIntoView({ block: 'nearest' })
  }, [dice, tarde, preguntando])

  const texto = preguntando
    ? 'Comprobando si el servidor contesta…'
    : sinRespuesta
      ? 'Todavía no llega la respuesta del servidor. Si sigue así, vuelve a cargar y después mira si quedó guardado antes de enviarlo otra vez.'
      : !tarde
        ? guardado
          ? GUARDADO_PONIENDO_AL_DIA
          : 'Poniendo la pantalla al día…'
        : otros > 0
          ? `${guardado ? 'Guardado. ' : ''}La pantalla se pone al día cuando termine el otro envío que va en camino desde esta pestaña.`
          : guardado
            ? 'Guardado, pero la pantalla tarda en ponerse al día. Si no se cierra sola, vuelve a cargar: lo guardado no se pierde.'
            : 'La pantalla tarda en ponerse al día. Si no se suelta sola, copia lo que escribiste y vuelve a cargar.'
  const conBoton = dice && tarde && (sinRespuesta || otros === 0)
  return (
    <div ref={linea} className={dice ? 'mt-3 scroll-mb-4 space-y-2 sm:text-right' : undefined}>
      <p role="status" className={dice ? 'text-xs text-texto-suave' : 'sr-only'}>
        {dice ? texto : ''}
      </p>
      {conBoton && (
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => void (sinRespuesta ? volverACargarSinEsperarLoQueVa() : volverACargar())}>
          Volver a cargar
        </Boton>
      )}
    </div>
  )
}

/**
 * El cursor vuelve al botón que abrió la ventana. Ese botón puede irse justo
 * después, cuando la pantalla se pone al día al cerrarla: la OC que se sacó de
 * la lista, la factura que quedó completa. El cursor caía entonces al <body> y
 * el teclado y el lector de pantalla volvían al principio de todo (decimosexta
 * pasada). Si el botón desaparece con el cursor encima, el cursor va al
 * contenido de la página.
 *
 * A veces el botón no se va: se rehace igual, con otra llave (el pago de la
 * planilla, cuando cambia la gente por pagar). Ese lo pide con
 * `data-cursor-vuelve`, y si en la página queda uno solo con la misma marca, el
 * cursor va a ese (decimoctava pasada). Solo el que lo pide: con cualquier
 * `data-…`, el «Anular pago» de una fila que se iba mandaba el cursor al de la
 * otra persona, que tiene la misma marca (decimonovena pasada).
 */
function devolverElCursor(boton: HTMLElement) {
  const marca = boton.dataset.cursorVuelve
  const alContenido = () => {
    if (document.activeElement && document.activeElement !== document.body) return
    const iguales = marca ? document.querySelectorAll<HTMLElement>(`[data-cursor-vuelve="${CSS.escape(marca)}"]`) : []
    if (iguales.length === 1) return iguales[0].focus()
    document.querySelector<HTMLElement>('main[tabindex]')?.focus({ preventScroll: true })
  }
  if (!boton.isConnected) return alContenido()
  boton.focus()
  const vigia = new MutationObserver(() => {
    if (boton.isConnected) return
    vigia.disconnect()
    alContenido()
  })
  vigia.observe(document.body, { childList: true, subtree: true })
  // La pantalla al día llega en segundos; después, quien mueve el cursor es la persona.
  setTimeout(() => vigia.disconnect(), 15000)
}

/**
 * Preguntar antes de lo que no se deshace.
 *
 * Nació con los blancos de toque: al agrandar los iconos de la papelera para
 * que se acierten con guante, también se aciertan sin querer, y detrás de esos
 * iconos hay borrados que no piden nada. Un documento numerado no se borra
 * —eso lo defiende la base—, pero una línea de un movimiento, una partida o un
 * accesorio sí, y quien la pierde tiene que volver a escribirla.
 */
export function ConfirmarAccion({
  abierta,
  alCerrar,
  alConfirmar,
  titulo,
  detalle,
  etiquetaConfirmar = 'Sí, quitar',
  trabajando = false,
  error,
}: {
  abierta: boolean
  alCerrar: () => void
  alConfirmar: () => void
  titulo: string
  /** Qué se va a perder exactamente, con su nombre. */
  detalle: string
  etiquetaConfirmar?: string
  trabajando?: boolean
  /**
   * Por qué no se hizo. Va dentro y se lleva el cursor: la pantalla lo pintaba
   * detrás, y el aviso se va con la ventana al cerrarla, así que «El conductor
   * ya salió» no se veía en ninguna parte (decimoquinta pasada). La ventana se
   * cierra sola con el ok, no al confirmar.
   */
  error?: string | null
}) {
  const aviso = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(trabajando, error ?? null, () => aviso.current)
  return (
    <Ventana abierta={abierta} alCerrar={alCerrar} titulo={titulo} ancho="sm" cerrarAlTocarFuera>
      <p className="text-sm text-texto-suave">{detalle}</p>
      {error && (
        <p ref={aviso} role="alert" tabIndex={-1} className="mt-3 text-sm text-peligro">
          {error}
        </p>
      )}

      <BotonesDeConfirmar alCerrar={alCerrar} alConfirmar={alConfirmar} etiquetaConfirmar={etiquetaConfirmar} trabajando={trabajando} />
    </Ventana>
  )
}

/**
 * Dentro de la ventana, para leer su traba: si algún día confirma una
 * corrección (`corrige`), «Cancelar» no la cierra mientras espera, como la X.
 * Hoy sus cinco usos son «quitar» y no la traban; lo que se dice mientras
 * tanto lo pinta la ventana (`MientrasSePoneAlDia`), no estos botones.
 */
function BotonesDeConfirmar({
  alCerrar,
  alConfirmar,
  etiquetaConfirmar,
  trabajando,
}: {
  alCerrar: () => void
  alConfirmar: () => void
  etiquetaConfirmar: string
  trabajando: boolean
}) {
  const { trabada } = useTrabaDeLaVentana()
  return (
    <>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={alCerrar}
          disabled={trabada}
          className="inline-flex h-11 items-center justify-center rounded-[var(--radius-base)] border border-borde-fuerte px-4 text-sm font-medium text-texto hover:bg-superficie-2 disabled:opacity-60 sm:h-9"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={alConfirmar}
          disabled={trabajando}
          className="inline-flex h-11 items-center justify-center rounded-[var(--radius-base)] bg-peligro px-4 text-sm font-medium text-peligro-texto hover:opacity-90 disabled:opacity-60 sm:h-9"
        >
          {trabajando ? 'Quitando…' : etiquetaConfirmar}
        </button>
      </div>
    </>
  )
}

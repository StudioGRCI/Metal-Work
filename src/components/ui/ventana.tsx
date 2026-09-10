'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Lo que se puede enfocar dentro de la ventana. Sirve para dos cosas: llevar el
 * foco al primer control al abrir, y hacer que el tabulador dé la vuelta
 * adentro en vez de escaparse a la página de atrás.
 */
const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const ANCHOS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

export type AnchoVentana = keyof typeof ANCHOS

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
  // El contenido tiene su propia referencia porque el foco al abrir tiene que
  // caer en el primer campo del formulario, no en la X. La X va antes en el
  // orden del documento, así que buscar desde la caja la encontraba siempre a
  // ella: se abría la ventana, el teclado del teléfono no subía, y un Enter
  // distraído la cerraba en vez de escribir.
  const contenido = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  const idDescripcion = useId()

  // Al abrir: se guarda quién tenía el foco, se lleva el foco adentro y se
  // traba el rodado de la página. Al cerrar, todo vuelve como estaba. No hay
  // estado que sincronizar acá, solo el documento.
  useEffect(() => {
    if (!abierta) return

    const veniaDe = document.activeElement as HTMLElement | null
    const rodadoPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const primero =
      contenido.current?.querySelector<HTMLElement>(ENFOCABLES) ??
      caja.current?.querySelector<HTMLElement>(ENFOCABLES)
    ;(primero ?? caja.current)?.focus()

    return () => {
      document.body.style.overflow = rodadoPrevio
      veniaDe?.focus()
    }
  }, [abierta])

  // En el servidor no hay documento al que colgar el portal, y en la primera
  // pintada la ventana siempre nace cerrada.
  if (!abierta || typeof document === 'undefined') return null

  function alTeclado(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      alCerrar()
      return
    }

    if (e.key !== 'Tab') return

    const enfocables = caja.current?.querySelectorAll<HTMLElement>(ENFOCABLES)
    if (!enfocables || enfocables.length === 0) return

    const primero = enfocables[0]
    const ultimo = enfocables[enfocables.length - 1]

    if (e.shiftKey && document.activeElement === primero) {
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
      onMouseDown={(e) => {
        // Solo el fondo, no un arrastre que empezó dentro y terminó afuera al
        // seleccionar texto.
        if (cerrarAlTocarFuera && e.target === e.currentTarget) alCerrar()
      }}
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descripcion ? idDescripcion : undefined}
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
            onClick={alCerrar}
            aria-label="Cerrar"
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 hover:text-texto sm:size-8"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div ref={contenido} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
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
}: {
  abierta: boolean
  alCerrar: () => void
  alConfirmar: () => void
  titulo: string
  /** Qué se va a perder exactamente, con su nombre. */
  detalle: string
  etiquetaConfirmar?: string
  trabajando?: boolean
}) {
  return (
    <Ventana abierta={abierta} alCerrar={alCerrar} titulo={titulo} ancho="sm" cerrarAlTocarFuera>
      <p className="text-sm text-texto-suave">{detalle}</p>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={alCerrar}
          className="inline-flex h-11 items-center justify-center rounded-[var(--radius-base)] border border-borde-fuerte px-4 text-sm font-medium text-texto hover:bg-superficie-2 sm:h-9"
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
    </Ventana>
  )
}

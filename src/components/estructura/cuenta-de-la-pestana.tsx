'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { entroLaCuenta, useOtraCuentaEnLaPestana } from '@/lib/envio'

/**
 * Quién usa la pantalla, para guardar por cuenta el envío pendiente (`useIdDelEnvio`)
 * y para que las otras pestañas sepan que entró (`entroLaCuenta`). El puesto es
 * como la nombra el menú (`PerfilMenu`), y el nombre la distingue de otra del
 * mismo puesto.
 * Va en `useLayoutEffect`, que corre al montar y antes de que llegue ningún clic:
 * con `useEffect`, un clic justo después de hidratar abría la ventana sin cuenta,
 * sin leer lo pendiente y con un id nuevo (vigésima pasada).
 */
export function CuentaDeLaPestana({ usuario, puesto, nombre }: { usuario: string; puesto: string; nombre: string }) {
  useLayoutEffect(() => {
    entroLaCuenta(usuario, puesto, nombre)
  }, [usuario, puesto, nombre])
  const otraCuenta = useOtraCuentaEnLaPestana()
  return <TrabaDeOtraCuenta texto={otraCuenta} volvio={`Volvió la cuenta de ${nombre.trim() ? `${nombre.trim()} (${puesto})` : puesto}: puedes seguir donde estabas.`} />
}

/**
 * Si en otra pestaña entró otra cuenta, la pantalla entera queda debajo de esta
 * traba, por encima de cualquier ventana abierta: lo de detrás no se toca ni se
 * envía, y lo escrito se conserva. Antes la traba iba en el pie de cada ventana
 * y dejaba fuera las que no lo usan —el conteo inicial, la planilla, el
 * cronograma, la cotización—, los botones de la pantalla y la ventana de una
 * pregunta (vigesimosegunda pasada).
 *
 * Es un `<dialog>` modal: el navegador vuelve inerte todo lo demás. Escape no
 * la cierra —si el navegador la cierra igual, se vuelve a abrir—: solo se va
 * cuando la sesión vuelve a ser de esta pantalla, y el cursor vuelve a donde
 * estaba. Eso se anuncia aparte, porque mientras la traba está puesta lo de
 * detrás no se lee.
 */
const ANUNCIO_MS = 10_000

function TrabaDeOtraCuenta({ texto, volvio }: { texto: string | null; volvio: string }) {
  const traba = useRef<HTMLDialogElement>(null)
  const aviso = useRef<HTMLParagraphElement>(null)
  const estado = useRef<HTMLParagraphElement>(null)
  const ultimoVolvio = useRef(volvio)
  const idTitulo = useId()
  const trabada = texto !== null
  // El aviso de que volvió la cuenta vive solo alrededor de la traba: nace con
  // ella, para que exista antes de escribirle, y se va un rato después. Uno
  // fijo en toda pantalla era el que encontraban los que buscan el aviso de la
  // pantalla por `role="status"` o `aria-live`.
  const [conAnuncio, setConAnuncio] = useState(false)
  if (trabada && !conAnuncio) setConAnuncio(true)

  useEffect(() => {
    ultimoVolvio.current = volvio
  })

  useEffect(() => {
    if (trabada || !conAnuncio) return
    const quitar = setTimeout(() => setConAnuncio(false), ANUNCIO_MS)
    return () => clearTimeout(quitar)
  }, [trabada, conAnuncio])

  useEffect(() => {
    const dialogo = traba.current
    if (!trabada || !dialogo) return
    const veniaDe = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (estado.current) estado.current.textContent = ''
    const abrir = () => {
      try {
        if (!dialogo.open) dialogo.showModal()
      } catch {}
      aviso.current?.focus()
    }
    const noCancelar = (e: Event) => e.preventDefault()
    // Escape no llega a lo de detrás: con el cursor caído al <body> —un toque en
    // el fondo—, la `Ventana` abierta lo tomaba como suyo y se cerraba con lo
    // escrito.
    const sinEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
    }
    abrir()
    dialogo.addEventListener('cancel', noCancelar)
    dialogo.addEventListener('close', abrir)
    document.addEventListener('keydown', sinEscape, true)
    return () => {
      dialogo.removeEventListener('cancel', noCancelar)
      dialogo.removeEventListener('close', abrir)
      document.removeEventListener('keydown', sinEscape, true)
      if (dialogo.open) dialogo.close()
      if (veniaDe?.isConnected && veniaDe !== document.body) veniaDe.focus()
      // Después de cerrar: con la traba puesta, lo de detrás no se anuncia.
      if (estado.current?.isConnected) estado.current.textContent = ultimoVolvio.current
    }
  }, [trabada])

  return (
    <>
      {/* Sin `aria-describedby`: el cursor cae en el texto, que el lector ya lee
          entero, y con las dos se oía dos veces (vigesimotercera pasada). */}
      <dialog
        ref={traba}
        aria-labelledby={idTitulo}
        data-traba-otra-cuenta
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[calc(var(--radius-base)*1.5)] border border-borde bg-superficie p-0 text-texto shadow-alta backdrop:bg-black/50"
      >
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <h2 id={idTitulo} className="text-base font-semibold text-texto">
            Esta pantalla es de otra cuenta
          </h2>
          <p ref={aviso} tabIndex={-1} data-otra-cuenta className="text-sm text-texto outline-none">
            {texto}
          </p>
          <div className="flex justify-end">
            <Boton type="button" onClick={() => window.location.reload()}>
              Recargar la pantalla
            </Boton>
          </div>
        </div>
      </dialog>
      {conAnuncio && <p ref={estado} aria-live="polite" data-volvio-la-cuenta className="sr-only" />}
    </>
  )
}

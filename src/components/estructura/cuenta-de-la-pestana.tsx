'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { alVolverLaCuentaSeFue, entroLaCuenta, useOtraCuentaEnLaPestana } from '@/lib/envio'

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
  return <TrabaDeOtraCuenta texto={otraCuenta} cuenta={nombre.trim() ? `${nombre.trim()} (${puesto})` : puesto} />
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
 *
 * Lo de detrás no se lee, pero puede cambiar: una cadena que ya había salido
 * termina con la traba puesta —la OC entró y su comprobante no— y su aviso nace
 * fuera del árbol del lector. Al volver la cuenta se dice: si el cursor puede
 * volver donde estaba, va ahí y el anuncio suma el aviso; si no —la ventana se
 * cerró, o el botón que se tocó sigue apagado—, el cursor va al aviso, como
 * `AvisoEnfocado`. «Puedes seguir donde estabas» solo cuando se puede
 * (vigesimocuarta pasada).
 */
const ANUNCIO_MS = 10_000

/** Lo que una pantalla dice cuando cambia: sus avisos. */
const AVISO = '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"]'

/** Los avisos que cambiaron y todavía están en la pantalla diciendo algo, el último al final: los tres últimos. */
function avisosVigentes(cambiados: HTMLElement[]) {
  return cambiados.filter((a) => a.isConnected && a.getClientRects().length > 0 && a.innerText.trim()).slice(-3)
}

/**
 * Lo que dijeron, en orden y sin repetir. Lo que se ve (`innerText`): con
 * `textContent` sumaba los dos textos que el campo de archivo elige por el
 * puntero, y se oía «tocahaz clic para cambiarlo» (vigesimosexta pasada).
 */
function loQueDijeron(avisos: HTMLElement[]) {
  return [...new Set(avisos.map((a) => a.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean))].join(' ')
}

/**
 * Dónde se ve un aviso. El que es solo para el lector (`sr-only`, un píxel al
 * final de la página) no se ve: con el cursor en él, la página saltaba al fondo
 * y el cursor no se veía (vigesimoquinta pasada, el pago de Tesorería). Si dice
 * dónde se ve (`data-se-ve-en`, el id del botón de la caja), el cursor va ahí;
 * si no, a ninguna parte.
 */
function dondeSeVe(aviso: HTMLElement) {
  const caja = aviso.getBoundingClientRect()
  if (caja.width > 1 && caja.height > 1) return aviso
  const id = aviso.dataset.seVeEn
  const destino = id ? document.getElementById(id) : null
  return destino?.isConnected && destino.getClientRects().length > 0 ? destino : null
}

function TrabaDeOtraCuenta({ texto, cuenta }: { texto: string | null; cuenta: string }) {
  const traba = useRef<HTMLDialogElement>(null)
  const aviso = useRef<HTMLParagraphElement>(null)
  const estado = useRef<HTMLParagraphElement>(null)
  const ultimaCuenta = useRef(cuenta)
  const idTitulo = useId()
  const trabada = texto !== null
  // El aviso de que volvió la cuenta vive solo alrededor de la traba: nace con
  // ella, para que exista antes de escribirle, y se va un rato después. Uno
  // fijo en toda pantalla era el que encontraban los que buscan el aviso de la
  // pantalla por `role="status"` o `aria-live`.
  const [conAnuncio, setConAnuncio] = useState(false)
  if (trabada && !conAnuncio) setConAnuncio(true)

  useEffect(() => {
    ultimaCuenta.current = cuenta
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
    // Los avisos de la pantalla que cambian mientras está trabada, el último al final.
    const cambiados: HTMLElement[] = []
    // Lo que solo dice el estado de un campo (`data-no-anunciar`, el pie de `ElegirArchivo`) no se suma: el cursor ya lo tiene delante.
    const anotar = (el: Element | null | undefined) => {
      if (!(el instanceof HTMLElement) || el.closest('[data-traba-otra-cuenta], [data-volvio-la-cuenta], [data-no-anunciar]')) return
      const i = cambiados.indexOf(el)
      if (i >= 0) cambiados.splice(i, 1)
      cambiados.push(el)
    }
    const mirar = (registros: MutationRecord[]) => {
      for (const r of registros) {
        anotar((r.target instanceof Element ? r.target : r.target.parentElement)?.closest(AVISO))
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue
          if (n.matches(AVISO)) anotar(n)
          n.querySelectorAll(AVISO).forEach(anotar)
        }
      }
    }
    const vigia = new MutationObserver(mirar)
    vigia.observe(document.body, { subtree: true, childList: true, characterData: true })
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
      mirar(vigia.takeRecords())
      vigia.disconnect()
      if (dialogo.open) dialogo.close()
      if (veniaDe?.isConnected && veniaDe !== document.body) veniaDe.focus()
      const sigue = veniaDe !== null && veniaDe !== document.body && document.activeElement === veniaDe
      const vigentes = avisosVigentes(cambiados)
      const cambio = vigentes.at(-1) ?? null
      let volvio = `Volvió la cuenta de ${ultimaCuenta.current}`
      // Lo enviado lleva a la pantalla que sigue: lo de aquí ya no se queda.
      if (alVolverLaCuentaSeFue()) volvio += '. Se abre la pantalla que sigue a lo que enviaste.'
      else if (sigue) volvio += cambio ? `. Mientras tanto: ${loQueDijeron(vigentes)}` : ': puedes seguir donde estabas.'
      else if (cambio) {
        // Con el cursor en el aviso, el lector lo lee; los otros que cambiaron
        // (la OS emitida, cuando el que falló es su contrato) y el que no se ve
        // los dice el anuncio (vigesimoquinta pasada).
        const destino = dondeSeVe(cambio)
        const antes = loQueDijeron(destino === cambio ? vigentes.slice(0, -1) : vigentes)
        volvio += antes ? `. Mientras tanto: ${antes}` : '.'
        if (destino) {
          if (destino === cambio && !cambio.hasAttribute('tabindex')) {
            cambio.setAttribute('tabindex', '-1')
            // Es texto que recibe el cursor para que se lea, no un mando: sin
            // anillo, como `AvisoEnfocado`. Con él, el del PDF de la orden tapaba
            // el nombre del archivo (vigesimoquinta pasada).
            cambio.classList.add('outline-none')
          }
          destino.focus()
        }
      } else volvio += '.'
      // Después de cerrar: con la traba puesta, lo de detrás no se anuncia.
      if (estado.current?.isConnected) estado.current.textContent = volvio
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

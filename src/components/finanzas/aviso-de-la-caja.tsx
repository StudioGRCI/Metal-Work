'use client'

import { Landmark, X } from 'lucide-react'
import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { avisoDeCajaPideAtencion } from '@/lib/dominio/caja'
import { cn } from '@/lib/utils'

/*
 * Lo que dijo el último pago o cobro sobre la caja diaria: de qué cuenta salió,
 * por qué no se movió, o que su movimiento quedó anulado (migración
 * 20261019100000). Vive en la página y no en el botón del documento porque ese
 * botón desaparece justo cuando el pago lo cancela, que es lo más común: al
 * contado, un recibo, la última persona de la planilla.
 *
 * Es un botón en la barra de arriba, junto a la campana, y no un cuadro: antes
 * era una tarjeta con sombra que flotaba abajo, encima de la lista, hasta que
 * alguien la cerraba, y DKS la vio como un cuadro que no aportaba (2026-10-19).
 * El pago ya se ve en la lista; de qué cuenta salió es un detalle que se
 * consulta. El botón llega con la marca de nuevo y el detalle se abre al
 * tocarlo y se cierra como el de la campana: tocando fuera o con Escape. El
 * lector de pantalla lo anuncia igual, por la región `status`.
 *
 * Lo que pide algo o es una excepción —que no se pudo leer la caja, que no se
 * movió— no se esconde: además del botón en tono de aviso, sale escrito arriba
 * de la página, en su lugar.
 */

const Avisar = createContext<(mensaje: string | null) => void>(() => {})

/** Lo que el formulario de un pago o un cobro llama al terminar, con el mensaje de la acción. */
export function useAvisoDeLaCaja() {
  return useContext(Avisar)
}

export function AvisoDeLaCaja({ children }: { children: ReactNode }) {
  const [aviso, setAvisoCrudo] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [visto, setVisto] = useState(false)
  const boton = useRef<HTMLButtonElement>(null)
  const id = useId()

  // Cada aviso nuevo llega cerrado y marcado como nuevo.
  const setAviso = useCallback((mensaje: string | null) => {
    setAvisoCrudo(mensaje)
    setAbierto(false)
    setVisto(false)
  }, [])

  const cerrar = () => {
    setAbierto(false)
    boton.current?.focus()
  }

  // Solo hay aviso después de un pago, ya en el navegador: el servidor nunca
  // lo pinta, así que buscar la ranura aquí no descuadra la hidratación.
  const ranura = aviso && typeof document !== 'undefined' ? document.getElementById('ranura-aviso-caja') : null
  const atencion = aviso ? avisoDeCajaPideAtencion(aviso) : false

  return (
    <Avisar.Provider value={setAviso}>
      {aviso && atencion && (
        <p role="alert" className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-4 py-3 text-sm text-texto">
          {aviso}
        </p>
      )}
      {children}
      {/* La región existe siempre: un lector de pantalla anuncia lo que entra en ella, no la región que aparece. */}
      <p role="status" aria-live="polite" className="sr-only">
        {atencion ? null : aviso}
      </p>
      {aviso &&
        ranura &&
        createPortal(
          // `lg:order-first`: en el monitor entra a la izquierda del tema y la
          // campana, y esos dos no se mueven de sitio al aparecer.
          <div className="relative lg:order-first" onKeyDown={(e) => { if (e.key === 'Escape') cerrar() }}>
            <button
              type="button"
              ref={boton}
              aria-expanded={abierto}
              aria-controls={id}
              aria-label="Lo que pasó en la caja diaria"
              onClick={() => {
                setAbierto((a) => !a)
                setVisto(true)
              }}
              className={cn(
                'relative flex size-11 items-center justify-center rounded-full border transition-colors',
                abierto
                  ? 'border-acento bg-acento-suave text-acento'
                  : atencion
                    ? 'border-aviso bg-aviso-suave text-aviso'
                    : 'border-borde bg-superficie text-acento hover:bg-superficie-2',
              )}
            >
              <Landmark aria-hidden className="size-5" />
              {!visto && <span aria-hidden className={cn('absolute top-1 right-1 size-2.5 rounded-full', atencion ? 'bg-aviso' : 'bg-acento')} />}
            </button>
            {abierto && (
              // Tocar fuera solo cierra el cuadro: el aviso sigue en la barra.
              <button type="button" aria-label="Cerrar el aviso de la caja" onClick={cerrar} className="fixed inset-0 z-40 cursor-default" />
            )}
            <div
              id={id}
              data-aviso-caja
              className={cn(
                'fixed inset-x-3 z-50 mt-2 items-start gap-2 rounded-2xl border border-borde bg-superficie py-2 pr-1 pl-4 text-sm text-texto shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:w-80',
                abierto ? 'flex' : 'hidden',
              )}
            >
              <span className="min-w-0 flex-1 py-2">{aviso}</span>
              <button
                type="button"
                onClick={() => setAviso(null)}
                aria-label="Quitar el aviso de la caja"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-texto-suave hover:bg-superficie-2 hover:text-texto"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </div>,
          ranura,
        )}
    </Avisar.Provider>
  )
}

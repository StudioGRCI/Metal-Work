'use client'

import { X } from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'

/*
 * Lo que dijo el último pago o cobro sobre la caja diaria: de qué cuenta salió,
 * por qué no se movió, o que su movimiento quedó anulado (migración
 * 20261017220000). Vive en la página y no en el botón del documento porque ese
 * botón desaparece justo cuando el pago lo cancela, que es lo más común: al
 * contado, un recibo, la última persona de la planilla. Se queda abajo de la
 * pantalla, encima de las pestañas del teléfono, hasta que lo cierran o llega
 * otro.
 */

const Avisar = createContext<(mensaje: string | null) => void>(() => {})

/** Lo que el formulario de un pago o un cobro llama al terminar, con el mensaje de la acción. */
export function useAvisoDeLaCaja() {
  return useContext(Avisar)
}

export function AvisoDeLaCaja({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <Avisar.Provider value={setAviso}>
      {children}
      {/* La región existe siempre: un lector de pantalla anuncia lo que entra en ella, no la región que aparece. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center lg:bottom-6 print:hidden"
      >
        {aviso && (
          <p
            data-aviso-caja
            className="pointer-events-auto flex max-w-xl items-start gap-3 rounded-[var(--radius-base)] border border-borde bg-superficie px-4 py-3 text-sm text-texto shadow-lg"
          >
            <span className="min-w-0 flex-1">{aviso}</span>
            <button
              type="button"
              onClick={() => setAviso(null)}
              aria-label="Cerrar el aviso"
              className="-my-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-texto-suave hover:text-texto"
            >
              <X aria-hidden className="size-4" />
            </button>
          </p>
        )}
      </div>
    </Avisar.Provider>
  )
}

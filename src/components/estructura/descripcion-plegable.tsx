'use client'

import { useState } from 'react'

/**
 * La descripción larga de una pantalla, recogida a dos líneas en el teléfono.
 *
 * Varias pantallas explican en cinco o seis renglones para qué sirven —RR. HH.,
 * Requerimientos, el reporte diario— y en el teléfono eso empujaba el botón y
 * la lista debajo del pliegue: había que bajar para empezar a trabajar. Recogida,
 * se lee el comienzo y un toque en el texto abre el resto: el párrafo entero es
 * el blanco, así que no suma otra fila de 44 px. En el monitor no se recoge.
 *
 * Una sola de las dos versiones se ve a la vez (`hidden` es `display: none`),
 * así que el lector de pantalla no la lee dos veces.
 */
export function DescripcionPlegable({ children }: { children: string }) {
  const [abierta, setAbierta] = useState(false)

  return (
    <>
      <p className="mt-1 hidden text-sm text-texto-suave sm:block">{children}</p>
      <button
        type="button"
        aria-expanded={abierta}
        onClick={() => setAbierta((a) => !a)}
        className="mt-1 block w-full rounded-[var(--radius-base)] text-left text-sm text-texto-suave sm:hidden"
      >
        <span className={abierta ? 'block' : 'line-clamp-2'}>{children}</span>
        <span className="mt-0.5 block font-medium text-acento">{abierta ? 'Leer menos' : 'Leer más'}</span>
      </button>
    </>
  )
}

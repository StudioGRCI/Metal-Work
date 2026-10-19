'use client'

import { useId, useState } from 'react'

/**
 * La descripción larga de una pantalla, recogida a dos líneas en el teléfono.
 *
 * Varias pantallas explican en cinco o seis renglones para qué sirven —RR. HH.,
 * Requerimientos, el reporte diario— y en el teléfono eso empujaba el botón y
 * la lista debajo del pliegue: había que bajar para empezar a trabajar. Recogida,
 * se lee el comienzo y «Leer más» abre el resto. En el monitor no se recoge.
 *
 * El botón va aparte del párrafo y no lo envuelve: envuelto, el lector de
 * pantalla anunciaba un botón cuyo nombre eran trescientos caracteres. Mide
 * 44 px de alto, pero los márgenes negativos lo dejan ocupar en la página lo
 * que un renglón.
 */
export function DescripcionPlegable({ children }: { children: string }) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()

  return (
    <div className="mt-1">
      <p id={id} className={abierta ? 'text-sm text-texto-suave' : 'line-clamp-2 text-sm text-texto-suave sm:line-clamp-none'}>
        {children}
      </p>
      <button
        type="button"
        aria-expanded={abierta}
        aria-controls={id}
        onClick={() => setAbierta((a) => !a)}
        className="-mt-2.5 -mb-3 inline-flex min-h-11 items-center rounded-[var(--radius-base)] text-sm font-medium text-acento sm:hidden"
      >
        {abierta ? 'Leer menos' : 'Leer más'}
      </button>
    </div>
  )
}

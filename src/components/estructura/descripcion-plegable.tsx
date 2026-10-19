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
 * pantalla anunciaba un botón cuyo nombre eran trescientos caracteres. Se ve
 * del alto de un renglón y el blanco de 44 px lo pone un `::after` invisible:
 * con márgenes negativos el anillo de foco tapaba el renglón de arriba.
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
        className="relative mt-1 text-sm font-medium text-acento after:absolute after:inset-x-0 after:-inset-y-3 after:content-[''] sm:hidden"
      >
        {abierta ? 'Leer menos' : 'Leer más'}
      </button>
    </div>
  )
}

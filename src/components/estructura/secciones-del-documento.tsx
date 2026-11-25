'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

export type SeccionDeDocumento = {
  clave: string
  titulo: string
  href: string
  /** Lo que espera en esa sección por esta persona: el globo al lado del nombre. */
  pendientes?: number
}

/**
 * Las secciones de un documento —la OT, el código interno—, en una fila de
 * pestañas arriba de su contenido, igual en el monitor y en el teléfono.
 *
 * Hasta la entrega 2 del plan de orden y diseño (2026-11-25) cada documento se
 * recorría a su manera: la OT ponía sus secciones en la barra lateral del
 * monitor y en una fila deslizable en el teléfono; el código interno, en nueve
 * pastillas que en el teléfono se volvían una lista desplegable bajo tres
 * pantallas de cifras. Una sola fila para los dos.
 *
 * La fila se desliza de costado cuando no entra, con una sombra en el borde
 * que avisa que hay más, y trae a la vista la pestaña elegida: «Historial»
 * quedaba fuera de la pantalla y nadie adivinaba que había que deslizar.
 */
export function SeccionesDelDocumento({
  etiqueta,
  secciones,
  activa,
  pegada = false,
  className,
}: {
  /** Qué documento recorre; lo lee el lector de pantalla. */
  etiqueta: string
  secciones: SeccionDeDocumento[]
  activa: string
  /**
   * Se queda pegada bajo la barra de arriba al deslizar: en el teléfono una
   * sección de la OT mide hasta 3 000 px y había que subirla entera para
   * cambiar. `globals.css` reserva su alto (`scroll-padding`) para que el
   * foco del teclado y los saltos a un `#id` no caigan debajo de ella.
   */
  pegada?: boolean
  className?: string
}) {
  const filaRef = useRef<HTMLUListElement>(null)
  const activaRef = useRef<HTMLAnchorElement>(null)
  // Solo de costado: `scrollIntoView` movía también la página hasta la fila, y
  // en el código interno, que la lleva bajo sus cifras, entrar era caer a media
  // pantalla.
  useEffect(() => {
    const fila = filaRef.current
    const pestana = activaRef.current
    if (!fila || !pestana) return
    fila.scrollLeft = pestana.offsetLeft - (fila.clientWidth - pestana.offsetWidth) / 2
  }, [activa])

  return (
    <nav
      aria-label={etiqueta}
      data-fila-pegada={pegada || undefined}
      className={cn(
        '-mx-4 lg:-mx-1 print:hidden',
        // El alto de la barra de arriba: 56 px, o su contenido más el borde del iPhone.
        pegada && 'sticky top-[max(3.5rem,calc(2.8125rem+env(safe-area-inset-top)))] z-20 border-b border-borde bg-fondo py-1',
        className,
      )}
    >
      {/* `py-1` y `lg:px-1`: el anillo del foco no se corta en el borde de la fila que desliza. */}
      <ul ref={filaRef} className="pestanas-con-corte relative flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] lg:px-1 [&::-webkit-scrollbar]:hidden">
        {secciones.map((s) => {
          const esActiva = s.clave === activa
          const n = s.pendientes ?? 0
          return (
            <li key={s.clave} className="shrink-0">
              <Link
                ref={esActiva ? activaRef : undefined}
                href={s.href}
                aria-current={esActiva ? 'page' : undefined}
                aria-label={n > 0 ? `${s.titulo}, ${n} ${n === 1 ? 'pendiente' : 'pendientes'}` : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento sm:min-h-9 sm:pointer-coarse:min-h-11',
                  esActiva
                    ? 'border-acento bg-acento font-semibold text-acento-texto'
                    : 'border-borde-fuerte bg-superficie text-texto-suave hover:bg-superficie-2 hover:text-texto',
                )}
              >
                {s.titulo}
                {n > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      'tabular rounded-full px-1.5 text-xs font-semibold',
                      esActiva ? 'bg-acento-texto/20 text-acento-texto' : 'bg-aviso-suave text-aviso',
                    )}
                  >
                    {n}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

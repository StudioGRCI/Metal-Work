'use client'

import { Info } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Un título con su botón «i»: la explicación de para qué sirve la pantalla o
 * la tarjeta queda guardada y se abre al tocarlo.
 *
 * Antes cada encabezado y cada tarjeta llevaba debajo un párrafo explicando
 * para qué servía. Quien usa la pantalla todos los días ya lo sabe, y esos
 * párrafos sumaban una franja de texto encima de cada lista (DKS, 2026-10-19:
 * «cuadros que no aportan… puede ser un botón de información para que no ocupe
 * mucho espacio»). Lo que sí cambia —una fecha, un total, cuántos hay— sigue
 * a la vista en la `descripcion`, que va entre el título y la explicación:
 * abierta, la explicación no empuja el dato hacia abajo.
 *
 * Se abre debajo del título, en su lugar y no flotando: un globo encima de la
 * lista tapaba lo que se estaba mirando y en el teléfono se salía del borde.
 * El ícono se ve de 16 px y el blanco de 44 lo pone un `::after` invisible,
 * como en el resto de los botones chicos.
 */
export function TituloConAyuda({
  children,
  nombre,
  descripcion,
  ayuda,
  claseAyuda,
}: {
  /** El título ya armado (`<h1>`, `<h2>`), para que su tamaño lo decida quien lo usa. */
  children: ReactNode
  /** El título en texto, para que cada «i» de la pantalla se anuncie distinto. */
  nombre?: string
  /** Lo que se ve siempre debajo del título. */
  descripcion?: ReactNode
  ayuda: ReactNode
  claseAyuda?: string
}) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()

  return (
    <>
      <div className="flex items-center gap-1.5">
        {children}
        {/* El nombre no cambia al abrir: el estado ya lo anuncia `aria-expanded`. */}
        <button
          type="button"
          aria-expanded={abierta}
          aria-controls={id}
          aria-label={nombre ? `Para qué sirve: ${nombre}` : 'Para qué sirve'}
          onClick={() => setAbierta((a) => !a)}
          className={cn(
            "relative inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:bg-superficie-2 hover:text-acento print:hidden",
            abierta ? 'bg-acento-suave text-acento' : 'text-texto-tenue',
          )}
        >
          <Info aria-hidden className="size-4" />
        </button>
      </div>
      {descripcion}
      {/* Con clase y no con el atributo `hidden`: en el papel no hay «i» que
          tocar, y el expediente que se imprime para el cliente perdía los
          subtítulos. `hidden` trae un `display: none !important` que ningún
          `print:block` levanta. */}
      <p id={id} className={cn('mt-1 max-w-prose text-sm text-texto-suave', !abierta && 'hidden print:block', claseAyuda)}>
        {ayuda}
      </p>
    </>
  )
}

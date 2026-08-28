import * as React from 'react'

import { cn } from '@/lib/utils'

export type Variante = 'primario' | 'secundario' | 'contorno' | 'fantasma' | 'peligro'
export type Tamano = 'sm' | 'md' | 'lg' | 'icono'

// Variantes, tamaños y base salen del archivo para que el enlace con pinta de
// botón (`EnlaceBoton`) use exactamente las mismas clases. Si se copian, el día
// que cambie el acento uno de los dos se queda con el color viejo.
export const VARIANTES: Record<Variante, string> = {
  primario: 'bg-acento text-acento-texto hover:bg-acento-fuerte border border-transparent',
  secundario: 'bg-superficie-2 text-texto hover:bg-neutro-suave border border-borde',
  contorno: 'bg-transparent text-texto hover:bg-superficie-2 border border-borde-fuerte',
  fantasma: 'bg-transparent text-texto-suave hover:bg-superficie-2 hover:text-texto border border-transparent',
  // El blanco sobre el rojo del tema oscuro daba 2.27 y no se leía; por eso
  // existe --peligro-texto, calculado para los dos temas. Vale para «Anular»,
  // «Rechazar» y toda la familia destructiva, acá y en EnlaceBoton.
  peligro: 'bg-peligro text-peligro-texto hover:opacity-90 border border-transparent',
}

// El blanco crece en el teléfono, donde se marca con el dedo y a veces con
// guante; en `sm:` vuelve la medida de escritorio de siempre, que ahí sobra
// con el ratón. `lg` ya medía 44 px: no tiene a dónde crecer.
export const TAMANOS: Record<Tamano, string> = {
  sm: 'h-10 sm:h-8 px-3 text-xs gap-1.5',
  md: 'h-11 sm:h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
  icono: 'size-11 sm:size-9 justify-center',
}

export const BASE_BOTON =
  'inline-flex items-center rounded-[var(--radius-base)] font-medium transition-colors'

export interface BotonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamano?: Tamano
  cargando?: boolean
}

export const Boton = React.forwardRef<HTMLButtonElement, BotonProps>(function Boton(
  { className, variante = 'primario', tamano = 'md', cargando, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || cargando}
      className={cn(
        BASE_BOTON,
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTES[variante],
        TAMANOS[tamano],
        className,
      )}
      {...props}
    >
      {cargando && (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  )
})

import * as React from 'react'

import { cn } from '@/lib/utils'

type Variante = 'primario' | 'secundario' | 'contorno' | 'fantasma' | 'peligro'
type Tamano = 'sm' | 'md' | 'lg' | 'icono'

const VARIANTES: Record<Variante, string> = {
  primario: 'bg-acento text-acento-texto hover:bg-acento-fuerte border border-transparent',
  secundario: 'bg-superficie-2 text-texto hover:bg-neutro-suave border border-borde',
  contorno: 'bg-transparent text-texto hover:bg-superficie-2 border border-borde-fuerte',
  fantasma: 'bg-transparent text-texto-suave hover:bg-superficie-2 hover:text-texto border border-transparent',
  peligro: 'bg-peligro text-white hover:opacity-90 border border-transparent',
}

const TAMANOS: Record<Tamano, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
  icono: 'h-9 w-9 justify-center',
}

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
        'inline-flex items-center rounded-[var(--radius-base)] font-medium transition-colors',
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

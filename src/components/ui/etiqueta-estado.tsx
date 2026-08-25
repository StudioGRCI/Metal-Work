import * as React from 'react'

import { cn } from '@/lib/utils'

export type Tono = 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info' | 'acento'

const TONOS: Record<Tono, string> = {
  neutro: 'bg-neutro-suave text-texto-suave',
  exito: 'bg-exito-suave text-exito',
  aviso: 'bg-aviso-suave text-aviso',
  peligro: 'bg-peligro-suave text-peligro',
  info: 'bg-info-suave text-info',
  acento: 'bg-acento-suave text-acento',
}

export function Insignia({
  tono = 'neutro',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tono?: Tono }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONOS[tono],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

/** Punto de color, para prioridades y semáforos de estado. */
export function Punto({ tono = 'neutro', className }: { tono?: Tono; className?: string }) {
  const color: Record<Tono, string> = {
    neutro: 'bg-texto-tenue',
    exito: 'bg-exito',
    aviso: 'bg-aviso',
    peligro: 'bg-peligro',
    info: 'bg-info',
    acento: 'bg-acento',
  }
  return <span aria-hidden className={cn('inline-block size-2 rounded-full', color[tono], className)} />
}

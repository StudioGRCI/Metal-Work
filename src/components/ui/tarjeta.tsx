import * as React from 'react'

import { cn } from '@/lib/utils'

export function Tarjeta({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]',
        className,
      )}
      {...props}
    />
  )
}

export function TarjetaCabecera({
  titulo,
  descripcion,
  acciones,
  className,
}: {
  titulo: React.ReactNode
  descripcion?: React.ReactNode
  acciones?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-borde px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-texto">{titulo}</h2>
        {descripcion && <p className="mt-0.5 text-xs text-texto-suave">{descripcion}</p>}
      </div>
      {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
    </div>
  )
}

export function TarjetaCuerpo({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

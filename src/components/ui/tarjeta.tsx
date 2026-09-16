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
    // Las acciones bajan de línea cuando no caben al lado del título. Sin eso, en
    // el teléfono un botón que no parte línea ensanchaba la tarjeta, y con ella
    // la columna entera: el resumen de la orden se salía 44 px por el costado.
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-borde px-4 py-3', className)}>
      <div className="min-w-0 flex-1 basis-60">
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

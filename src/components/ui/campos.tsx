import * as React from 'react'

import { cn } from '@/lib/utils'

const BASE_CONTROL =
  'w-full rounded-[var(--radius-base)] border border-borde bg-superficie px-3 text-sm text-texto ' +
  'placeholder:text-texto-tenue disabled:cursor-not-allowed disabled:opacity-60'

export const Entrada = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Entrada({ className, ...props }, ref) {
    return <input ref={ref} className={cn(BASE_CONTROL, 'h-9', className)} {...props} />
  },
)

export const AreaTexto = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function AreaTexto({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(BASE_CONTROL, 'min-h-20 py-2', className)} {...props} />
})

export const Seleccion = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Seleccion({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(BASE_CONTROL, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  )
})

export function Campo({
  etiqueta,
  htmlFor,
  requerido,
  ayuda,
  error,
  className,
  children,
}: {
  etiqueta: string
  htmlFor?: string
  requerido?: boolean
  ayuda?: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-texto-suave">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-peligro">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-peligro">{error}</p>
      ) : (
        ayuda && <p className="text-xs text-texto-tenue">{ayuda}</p>
      )}
    </div>
  )
}

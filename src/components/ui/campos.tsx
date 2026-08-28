import * as React from 'react'

import { cn } from '@/lib/utils'

// El texto del control mide 16 px en el teléfono a propósito: por debajo de eso
// el Safari del iPhone acerca la pantalla en cada foco y le descuadra la vista
// al que está en la cancha, con el equipo en la mano. En `sm:` —ratón y monitor—
// vuelve a los 14 px de siempre.
const BASE_CONTROL =
  'w-full rounded-[var(--radius-base)] border border-borde bg-superficie px-3 text-base sm:text-sm text-texto ' +
  'placeholder:text-texto-tenue disabled:cursor-not-allowed disabled:opacity-60'

// 44 px de alto en el teléfono, que es lo que ocupa un dedo —y con guante
// puesto, más—; a partir de `sm` vuelven los 36 px del escritorio, que ahí se
// marca con ratón y no hace falta el blanco grande.
const ALTO_CONTROL = 'h-11 sm:h-9'

export const Entrada = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Entrada({ className, ...props }, ref) {
    return <input ref={ref} className={cn(BASE_CONTROL, ALTO_CONTROL, className)} {...props} />
  },
)

export const AreaTexto = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function AreaTexto({ className, ...props }, ref) {
  // Sin alto fijo: crece con el texto y el `min-h` ya deja sitio para el dedo.
  return <textarea ref={ref} className={cn(BASE_CONTROL, 'min-h-20 py-2', className)} {...props} />
})

export const Seleccion = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Seleccion({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(BASE_CONTROL, ALTO_CONTROL, 'pr-8', className)} {...props}>
      {children}
    </select>
  )
})

type PropsDescritas = {
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

/**
 * Ata el texto de ayuda o de error al control que el Campo envuelve.
 *
 * El hijo es libre —una Entrada, una Seleccion, un buscador propio—, así que se
 * clona el elemento en vez de obligar a cada pantalla a repetir el id a mano:
 * 200 llamadas a `Campo` no se corrigen de una en una sin que alguna se quede
 * sin atar. Un `aria-describedby` que ya venga puesto se conserva, no se pisa.
 */
function describirControl(hijos: React.ReactNode, id: string, invalido: boolean): React.ReactNode {
  return React.Children.map(hijos, (hijo) => {
    if (!React.isValidElement<PropsDescritas>(hijo)) return hijo
    const yaDescrito = hijo.props['aria-describedby']
    return React.cloneElement(hijo, {
      'aria-describedby': yaDescrito ? `${yaDescrito} ${id}` : id,
      // Marca el control como inválido solo cuando hay error; si no, se respeta
      // lo que traiga el propio hijo.
      'aria-invalid': invalido || hijo.props['aria-invalid'],
    })
  })
}

export interface CampoProps {
  etiqueta: string
  htmlFor?: string
  requerido?: boolean
  ayuda?: string
  error?: string
  className?: string
  children: React.ReactNode
}

export function Campo({
  etiqueta,
  htmlFor,
  requerido,
  ayuda,
  error,
  className,
  children,
}: CampoProps) {
  // `useId` da el mismo identificador en el servidor y en el navegador; uno al
  // azar dispararía error de hidratación en cuanto los dos no coincidieran.
  const idBase = React.useId()
  const idAyuda = `${idBase}-ayuda`
  const idError = `${idBase}-error`
  // El error tapa a la ayuda al pintarse, así que se describe solo el texto que
  // de verdad está en pantalla: apuntar a un id que no existe deja mudo al
  // lector en lugar de ayudarlo.
  const idDescripcion = error ? idError : ayuda ? idAyuda : undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-texto-suave">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-peligro">*</span>}
      </label>
      {idDescripcion ? describirControl(children, idDescripcion, Boolean(error)) : children}
      {error ? (
        // `role="alert"` para que el motivo del rechazo se lea solo al aparecer:
        // es justo la ayuda que explica por qué algo no se deja hacer.
        <p id={idError} role="alert" className="text-xs text-peligro">
          {error}
        </p>
      ) : (
        ayuda && (
          <p id={idAyuda} className="text-xs text-texto-tenue">
            {ayuda}
          </p>
        )
      )}
    </div>
  )
}

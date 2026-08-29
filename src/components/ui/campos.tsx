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
  /**
   * Fuerza la ayuda al icono aunque sea corta, o la baja al pie aunque sea
   * larga. Sin esto decide el largo del texto (ver `LARGO_QUE_ESTORBA`).
   */
  ayudaEnIcono?: boolean
}

/**
 * A partir de acá, una ayuda deja de acompañar y empieza a estorbar.
 *
 * Un «Días calendario» debajo del campo se lee de reojo y no molesta a nadie.
 * Un párrafo de cuatro renglones explicando el IGV separa el campo del
 * siguiente, alarga el formulario y obliga a desplazarse para llegar al botón
 * de guardar; en el teléfono, el campo del precio y el de plazo terminaban a
 * media pantalla de distancia. Esos se guardan detrás de una «i» y salen al
 * pasar por encima o al tocarla.
 *
 * El texto sigue estando en el documento y sigue atado al control con
 * `aria-describedby`: quien usa lector de pantalla lo escucha igual que antes.
 * Esconder no es quitar.
 */
const LARGO_QUE_ESTORBA = 70

/**
 * La «i» que guarda la ayuda larga. El texto lo pinta `Campo`, no este botón.
 *
 * Colgado del icono, el globo se salía por el borde derecho de la pantalla en
 * los campos de la última columna: 256 px de ancho anclados a un icono que ya
 * está pegado al borde no caben en ningún sitio. Anclado a la fila de la
 * etiqueta —que mide exactamente lo que mide el campo— no puede salirse, porque
 * el campo por definición cabe.
 */
function AyudaEnIcono({ id, etiqueta }: { id: string; etiqueta: string }) {
  return (
    <button
      type="button"
      // Es un botón y no un icono suelto porque en el teléfono no hay «pasar por
      // encima»: al tocarlo recibe el foco y `group-focus-within` muestra el
      // texto. Un `title` de HTML se lo habría comido el táctil.
      aria-label={`Qué es «${etiqueta}»`}
      aria-describedby={id}
      className="flex size-4 shrink-0 items-center justify-center rounded-full border border-borde text-[10px] leading-none font-semibold text-texto-tenue hover:border-acento hover:text-acento focus-visible:border-acento focus-visible:text-acento"
    >
      i
    </button>
  )
}

export function Campo({
  etiqueta,
  htmlFor,
  requerido,
  ayuda,
  error,
  className,
  children,
  ayudaEnIcono,
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

  // La ayuda larga se va a la «i» de la etiqueta; la corta se queda al pie,
  // donde se lee de reojo sin tener que ir a buscarla.
  const enIcono = ayuda ? (ayudaEnIcono ?? ayuda.length > LARGO_QUE_ESTORBA) : false

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* El globo cuelga de esta fila y no del icono: así mide lo que mide el
          campo y no puede salirse de la pantalla. El grupo lleva nombre para
          que lo abra pasar por la etiqueta o por la «i» —que es donde se busca
          una explicación— y no el simple hecho de escribir en el campo. */}
      <div className="group/ayuda relative flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="block text-xs font-medium text-texto-suave">
          {etiqueta}
          {requerido && <span className="ml-0.5 text-peligro">*</span>}
        </label>
        {ayuda && enIcono && !error && (
          <>
            <AyudaEnIcono id={idAyuda} etiqueta={etiqueta} />
            <span
              id={idAyuda}
              role="tooltip"
              className="pointer-events-none absolute top-full left-0 z-20 mt-1 w-max max-w-full rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2 text-xs leading-snug font-normal text-texto-suave opacity-0 shadow-lg transition-opacity group-focus-within/ayuda:opacity-100 group-hover/ayuda:opacity-100"
            >
              {ayuda}
            </span>
          </>
        )}
      </div>
      {idDescripcion ? describirControl(children, idDescripcion, Boolean(error)) : children}
      {error ? (
        // `role="alert"` para que el motivo del rechazo se lea solo al aparecer:
        // es justo la ayuda que explica por qué algo no se deja hacer.
        <p id={idError} role="alert" className="text-xs text-peligro">
          {error}
        </p>
      ) : (
        ayuda &&
        !enIcono && (
          <p id={idAyuda} className="text-xs text-texto-tenue">
            {ayuda}
          </p>
        )
      )}
    </div>
  )
}

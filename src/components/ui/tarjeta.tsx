import * as React from 'react'

import { TituloConAyuda } from '@/components/estructura/titulo-con-ayuda'
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
  ayuda,
  acciones,
  className,
}: {
  titulo: React.ReactNode
  /** Lo que cambia y hay que ver de un vistazo. */
  descripcion?: React.ReactNode
  /**
   * Para qué sirve la tarjeta: queda detrás del botón «i». No es la `ayuda` de
   * `Campo`, que se ve siempre bajo el campo.
   */
  ayuda?: React.ReactNode
  acciones?: React.ReactNode
  className?: string
}) {
  const texto = descripcion && <p className="mt-0.5 text-xs text-texto-suave">{descripcion}</p>
  const h2 = <h2 className="text-[15px] leading-snug font-semibold text-texto">{titulo}</h2>
  return (
    // Las acciones bajan de línea cuando no caben al lado del título. Sin eso, en
    // el teléfono un botón que no parte línea ensanchaba la tarjeta, y con ella
    // la columna entera: el resumen de la orden se salía 44 px por el costado.
    // Al imprimir, el título no se queda al pie de una hoja con su contenido en la siguiente.
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-borde px-4 py-3 print:break-after-avoid', className)}>
      <div className="min-w-0 flex-1 basis-60">
        {/* Un punto más que el texto de adentro: al mismo tamaño, «Cliente y
            unidad» se leía como una fila más de la tarjeta y no como su nombre. */}
        {ayuda ? (
          <TituloConAyuda ayuda={ayuda} nombre={typeof titulo === 'string' ? titulo : undefined} descripcion={texto} claseAyuda="text-xs">
            {h2}
          </TituloConAyuda>
        ) : (
          <>
            {h2}
            {texto}
          </>
        )}
      </div>
      {/* Y si ni en su propia línea caben, se parten dentro de la tarjeta: los
          botones de un plano en el teléfono quedaban 100 px fuera. */}
      {acciones && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  )
}

export function TarjetaCuerpo({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

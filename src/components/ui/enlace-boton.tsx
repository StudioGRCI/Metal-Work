import Link from 'next/link'
import * as React from 'react'

import { BASE_BOTON, TAMANOS, VARIANTES, type Tamano, type Variante } from '@/components/ui/boton'
import { cn } from '@/lib/utils'

// Un enlace que se ve —y se toca— como un botón, pero navega: sigue siendo un
// <a>, así que se puede abrir en otra pestaña y el navegador lo trata como lo
// que es. Existe porque hoy hay veinte enlaces repitiendo a mano las clases del
// botón; cuando una medida cambia, los repetidos se quedan atrás sin avisar.
// Para *hacer* algo (guardar, anular, marcar) va `Boton`, no esto.
export interface EnlaceBotonProps extends React.ComponentPropsWithoutRef<typeof Link> {
  variante?: Variante
  tamano?: Tamano
}

export const EnlaceBoton = React.forwardRef<HTMLAnchorElement, EnlaceBotonProps>(
  function EnlaceBoton(
    { href, variante = 'primario', tamano = 'md', className, children, ...props },
    ref,
  ) {
    return (
      <Link
        ref={ref}
        href={href}
        className={cn(BASE_BOTON, VARIANTES[variante], TAMANOS[tamano], className)}
        {...props}
      >
        {children}
      </Link>
    )
  },
)

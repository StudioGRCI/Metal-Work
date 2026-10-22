'use client'

import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/**
 * Un aviso que se lleva el foco al aparecer. Es para lo que acaba de pasar
 * cuando el botón que se tocó ya no sirve de ancla: la fila se fue con el RQ
 * entregado, o el botón quedó desactivado mientras se enviaba y el formulario
 * se rehízo. Sin esto el foco caía en la página: en el teléfono el aviso
 * quedaba fuera de la vista y Escape ya no cerraba la ventana.
 *
 * El foco va en un efecto y no en la referencia: así llega después de que la
 * ventana que se cierra devuelve el foco a su botón.
 */
export function AvisoEnfocado({
  children,
  rol = 'status',
  aviso = false,
  className,
}: {
  children: React.ReactNode
  /** `alert` para un rechazo; `status` para lo que salió bien. */
  rol?: 'status' | 'alert'
  /** Un `status` que no es un éxito: no se cambió nada, o no se sabe cómo quedó. */
  aviso?: boolean
  className?: string
}) {
  const elemento = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    elemento.current?.focus()
  }, [])
  return (
    // scroll-mt-20: la barra de arriba se queda pegada (56 px); con menos margen, el aviso
    // que asomaba por encima de la vista quedaba debajo de ella al enfocarlo.
    <p
      ref={elemento}
      role={rol}
      tabIndex={-1}
      className={cn('scroll-mt-20 text-sm outline-none', rol === 'alert' ? 'text-peligro' : aviso ? 'text-aviso' : 'text-exito', className)}
    >
      {children}
    </p>
  )
}

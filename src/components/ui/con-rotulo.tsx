import type { ReactNode } from 'react'

/**
 * Una parte de una ficha con su nombre encima, en la letra de las cabeceras de
 * tabla. Va dentro de un `<dl>` (`grid gap-x-4 gap-y-3 sm:grid-cols-2`): es lo
 * que queda de una columna cuando la tabla no cabe y la fila pasa a ficha
 * (Adquisiciones, entrega 6 del plan de orden y diseño).
 */
export function ConRotulo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0" data-parte={rotulo}>
      <dt className="mb-1 text-xs font-semibold text-texto-suave uppercase">{rotulo}</dt>
      <dd className="[overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

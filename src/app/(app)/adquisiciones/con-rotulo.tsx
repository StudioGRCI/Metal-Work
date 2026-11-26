import type { ReactNode } from 'react'

/** Una parte de la ficha con su nombre encima, en la letra de las cabeceras de tabla. Va dentro de un `<dl>`. */
export function ConRotulo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0" data-parte={rotulo}>
      <dt className="mb-0.5 text-xs font-semibold text-texto-suave uppercase">{rotulo}</dt>
      <dd className="[overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

import Link from 'next/link'
import type { ReactNode } from 'react'

import { ACTIVA, GRUPO_PASTILLAS, INACTIVA, PASTILLA } from '@/components/estructura/pastilla-filtro'
import { cn } from '@/lib/utils'

export type Vista = {
  /** Identifica la vista dentro del grupo; no se muestra. */
  clave: string
  titulo: string
  href: string
  activa: boolean
  /** Cuántos hay en esa vista. Se omite cuando no se sabe sin consultar. */
  cuenta?: number
  /** Para qué sirve, en el globo del ratón. */
  descripcion?: string
}

/**
 * Las vistas de una lista —«En planta | Historial», «Activos | Todos»—, cada
 * una con su enlace armado por la pantalla y, si se sabe, cuántos tiene.
 *
 * Es la misma pastilla que `PastillaFiltro`: antes cada pantalla dibujaba las
 * suyas a mano, con otro contorno y 36 px de alto en el teléfono, por debajo de
 * los 44 que pide el dedo con guante. Se usa esta cuando cada vista tiene su
 * propio enlace; cuando todas cambian una misma clave de la URL, la otra.
 */
export function Vistas({
  vistas,
  etiqueta,
  className,
  id,
  children,
}: {
  vistas: Vista[]
  /** Para volver a la lista con un ancla en el `href` de cada vista. */
  id?: string
  /** Qué elige el grupo; lo lee el lector de pantalla. */
  etiqueta: string
  className?: string
  /** Lo que acompaña a la derecha en el monitor (un resumen, un aviso). */
  children?: ReactNode
}) {
  return (
    <div id={id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <nav aria-label={etiqueta} className="min-w-0 max-w-full">
        <div className={GRUPO_PASTILLAS}>
          {vistas.map((v) => (
            <Link
              key={v.clave}
              href={v.href}
              title={v.descripcion}
              aria-current={v.activa ? 'page' : undefined}
              className={cn(PASTILLA, v.activa ? cn(ACTIVA, 'no-underline') : INACTIVA)}
            >
              {/* El subrayado de la elegida va solo en el nombre: debajo de la
                  cifra parecía un enlace aparte. */}
              <span className={v.activa ? 'underline underline-offset-4' : undefined}>{v.titulo}</span>
              {v.cuenta !== undefined && (
                <span className={cn('tabular text-xs', v.activa ? 'opacity-90' : 'text-texto-tenue')}>
                  {v.cuenta}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  )
}

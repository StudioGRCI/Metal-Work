import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { DescripcionPlegable } from '@/components/estructura/descripcion-plegable'

/**
 * Desde aquí una descripción ocupa cuatro renglones o más en un teléfono de
 * 390 px. Por debajo, recogerla a dos más «Leer más» no ahorra casi nada y
 * suma un toque.
 */
const DESCRIPCION_LARGA = 160

export function EncabezadoPagina({
  titulo,
  descripcion,
  migas,
  acciones,
}: {
  titulo: ReactNode
  descripcion?: ReactNode
  migas?: { titulo: string; ruta?: string }[]
  acciones?: ReactNode
}) {
  // Unas migas sin ningún enlace no llevan a ninguna parte y casi siempre
  // repiten el título de abajo («Requerimientos» sobre «Requerimientos»): son
  // un renglón más antes del trabajo. Se muestran cuando dejan volver a algo.
  const conMigas = migas?.some((miga) => miga.ruta) ?? false

  return (
    <div className="mb-6">
      {conMigas && migas && (
        <nav aria-label="Ruta de navegación" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-texto-suave">
          {migas.map((miga, i) => (
            <span key={`${miga.titulo}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="size-3 text-texto-tenue" />}
              {miga.ruta ? (
                <Link href={miga.ruta} className="hover:text-texto hover:underline">
                  {miga.titulo}
                </Link>
              ) : (
                <span className="text-texto">{miga.titulo}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* La descripción se corta a un ancho que se lee de un tirón: a todo lo
            ancho de un monitor, un renglón medía 180 caracteres y al volver
            al comienzo del siguiente se perdía la línea. */}
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-xl font-semibold tracking-tight text-texto sm:text-2xl">{titulo}</h1>
          {typeof descripcion === 'string' && descripcion.length > DESCRIPCION_LARGA ? (
            <DescripcionPlegable>{descripcion}</DescripcionPlegable>
          ) : (
            descripcion && <p className="mt-1 text-sm text-texto-suave">{descripcion}</p>
          )}
        </div>
        {/* Sin `shrink-0`: cuando las acciones bajan a su propia línea y no caben
            —tres botones en el teléfono—, se acomodan en dos filas en vez de
            empujar la pantalla de costado. */}
        {acciones && <div className="flex min-w-0 flex-wrap items-center gap-2">{acciones}</div>}
      </div>
    </div>
  )
}

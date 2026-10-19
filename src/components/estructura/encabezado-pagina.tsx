import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { TituloConAyuda } from '@/components/estructura/titulo-con-ayuda'

export function EncabezadoPagina({
  titulo,
  descripcion,
  ayuda,
  migas,
  acciones,
}: {
  titulo: ReactNode
  /** Lo que cambia y hay que ver de un vistazo: la fecha, el área, un total. */
  descripcion?: ReactNode
  /**
   * Para qué sirve la pantalla: queda detrás del botón «i». No es la `ayuda`
   * de `Campo`, que se ve siempre bajo el campo.
   */
  ayuda?: ReactNode
  migas?: { titulo: string; ruta?: string }[]
  acciones?: ReactNode
}) {
  // Unas migas sin ningún enlace no llevan a ninguna parte y casi siempre
  // repiten el título de abajo («Requerimientos» sobre «Requerimientos»): son
  // un renglón más antes del trabajo. Se muestran cuando dejan volver a algo.
  const conMigas = migas?.some((miga) => miga.ruta) ?? false
  const texto = descripcion && <p className="mt-1 text-sm text-texto-suave">{descripcion}</p>
  const h1 = <h1 className="text-xl font-semibold tracking-tight text-texto sm:text-2xl">{titulo}</h1>

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
          {ayuda ? (
            <TituloConAyuda ayuda={ayuda} nombre={typeof titulo === 'string' ? titulo : undefined} descripcion={texto}>
              {h1}
            </TituloConAyuda>
          ) : (
            <>
              {h1}
              {texto}
            </>
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

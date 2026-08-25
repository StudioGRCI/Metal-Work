import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

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
  return (
    <div className="mb-6">
      {migas && migas.length > 0 && (
        <nav aria-label="Ruta de navegación" className="mb-2 flex items-center gap-1 text-xs text-texto-suave">
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
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-texto">{titulo}</h1>
          {descripcion && <p className="mt-1 text-sm text-texto-suave">{descripcion}</p>}
        </div>
        {acciones && <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div>}
      </div>
    </div>
  )
}

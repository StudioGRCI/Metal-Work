import Link from 'next/link'

import { cn } from '@/lib/utils'

const PESTANAS = [
  { clave: 'resumen', titulo: 'Resumen' },
  { clave: 'etapas', titulo: 'Etapas' },
  { clave: 'horas', titulo: 'Horas' },
  { clave: 'calidad', titulo: 'Calidad' },
  { clave: 'bitacora', titulo: 'Trazabilidad' },
] as const

export function Pestanas({ ordenId, activa }: { ordenId: string; activa: string }) {
  return (
    <nav className="my-5 flex gap-1 overflow-x-auto border-b border-borde" aria-label="Secciones de la orden">
      {PESTANAS.map((p) => {
        const esActiva = p.clave === activa
        return (
          <Link
            key={p.clave}
            href={`/ordenes/${ordenId}?vista=${p.clave}`}
            aria-current={esActiva ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
              esActiva
                ? 'border-acento font-medium text-acento'
                : 'border-transparent text-texto-suave hover:border-borde-fuerte hover:text-texto',
            )}
          >
            {p.titulo}
          </Link>
        )
      })}
    </nav>
  )
}

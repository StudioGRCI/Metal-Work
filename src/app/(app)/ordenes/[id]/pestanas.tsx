import Link from 'next/link'

import { cn } from '@/lib/utils'

const PESTANAS = [
  { clave: 'resumen', titulo: 'Resumen' },
  { clave: 'ficha', titulo: 'Ficha de taller' },
  // Las etapas por área alimentan el control de plazos: son la manera de ver si
  // cada área va a tiempo.
  { clave: 'etapas', titulo: 'Etapas' },
  // La hoja de Diseño: planos y piezas.
  { clave: 'cumplimiento', titulo: 'Cumplimiento' },
  // Los materiales van pegados al cumplimiento porque son la otra mitad de lo
  // mismo: en la hoja de Diseño está qué hay que hacer, y acá qué hace falta
  // para hacerlo.
  { clave: 'materiales', titulo: 'Materiales' },
  // La hoja de cada area: sus actividades y el reporte de cada dia. Va antes de
  // «Avance», que son las fotos del taller: primero cuanto se lleva, despues
  // como se ve.
  { clave: 'actividades', titulo: 'Actividades' },
  { clave: 'avance', titulo: 'Avance' },
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
              // 44 px de alto en el teléfono —ocho pestañas seguidas y el dedo
              // gordo con guante— y en `sm:` los 36 px de siempre. `min-h` le
              // gana a `py`, por eso hay que soltarlo en el monitor.
              '-mb-px inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors sm:min-h-0',
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

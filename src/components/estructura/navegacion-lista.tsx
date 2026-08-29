'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { NAVEGACION } from '@/lib/navegacion'
import { cn } from '@/lib/utils'

/**
 * El menú de módulos, uno solo para las dos formas en que se muestra: la barra
 * fija del monitor y el cajón que se abre en el teléfono.
 *
 * Estaba escrito una vez y usado dos veces dentro del mismo archivo, lo que
 * funcionaba mientras las dos vivieran juntas. Al mover el botón del teléfono a
 * la barra superior dejaron de vivir juntas, y duplicar esta lista era condenar
 * a que un módulo nuevo apareciera en el monitor y no en el teléfono.
 */
export function NavegacionLista({
  permisos,
  esAdmin,
  alNavegar,
}: {
  permisos: string[]
  esAdmin: boolean
  /** El cajón del teléfono se cierra al elegir; la barra del monitor no hace nada. */
  alNavegar?: () => void
}) {
  const ruta = usePathname()

  const grupos = NAVEGACION.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        !i.permiso ||
        esAdmin ||
        (Array.isArray(i.permiso) ? i.permiso : [i.permiso]).some((p) => permisos.includes(p)),
    ),
  })).filter((g) => g.items.length > 0)

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
      {grupos.map((grupo) => (
        <div key={grupo.titulo}>
          <p className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-texto-tenue uppercase">
            {grupo.titulo}
          </p>
          <ul className="space-y-0.5">
            {grupo.items.map((item) => {
              // "/" solo coincide exacto; el resto también con sus subrutas.
              const activo = item.ruta === '/' ? ruta === '/' : ruta.startsWith(item.ruta)
              const Icono = item.icono

              // Los módulos todavía no construidos se muestran para que se vea
              // el alcance del sistema, pero sin enlace que lleve a un error.
              if (!item.disponible) {
                return (
                  <li key={item.ruta}>
                    <span
                      title="Módulo en construcción"
                      className="flex cursor-default items-center gap-2.5 rounded-[var(--radius-base)] px-3 py-2 text-sm text-texto-tenue"
                    >
                      <Icono aria-hidden className="size-4 shrink-0" />
                      <span className="truncate">{item.titulo}</span>
                      <span className="ml-auto text-[10px] tracking-wide uppercase">pronto</span>
                    </span>
                  </li>
                )
              }

              return (
                <li key={item.ruta}>
                  <Link
                    href={item.ruta}
                    onClick={alNavegar}
                    aria-current={activo ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[var(--radius-base)] px-3 py-2 text-sm transition-colors',
                      activo
                        ? 'bg-acento-suave font-medium text-acento'
                        : 'text-texto-suave hover:bg-superficie-2 hover:text-texto',
                    )}
                  >
                    <Icono aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{item.titulo}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

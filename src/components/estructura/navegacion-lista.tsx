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

  /**
   * Cuál de todos los módulos es el que se está mirando: gana el de ruta más
   * larga que encaje.
   *
   * Antes cada módulo se marcaba por su cuenta con `ruta.startsWith(su ruta)`, y
   * eso encendía dos a la vez: dentro de `/cotizaciones/trabajo/…` se marcaba
   * también «Cotización de venta», porque la ruta empieza igual. Comparten el
   * documento pero no la función —una la escribe Ventas y la otra Diseño, y la
   * de trabajo lleva el costo que Ventas no ve—, así que el menú tiene que
   * decir en cuál de las dos está parado uno.
   *
   * La comparación es por segmento (`/cotizaciones/trabajo` encaja, pero
   * `/cotizaciones-viejas` no).
   */
  const encaja = (base: string) =>
    base === '/' ? ruta === '/' : ruta === base || ruta.startsWith(`${base}/`)

  const activa = NAVEGACION.flatMap((g) => g.items)
    .map((i) => i.ruta)
    .filter(encaja)
    .sort((a, b) => b.length - a.length)[0]

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
              const activo = item.ruta === activa
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

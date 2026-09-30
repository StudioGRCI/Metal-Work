'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { NAVEGACION, puedeVer, rutaActiva } from '@/lib/navegacion'
import { cn } from '@/lib/utils'
import { useContextoOrden } from './contexto-orden'

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
  rolCodigo,
  alNavegar,
  pendientes = {},
}: {
  permisos: string[]
  esAdmin: boolean
  rolCodigo: string
  /** El cajón del teléfono se cierra al elegir; la barra del monitor no hace nada. */
  alNavegar?: () => void
  /** Cuántos pendientes cuelgan de cada módulo, por su ruta: el número al lado del nombre. */
  pendientes?: Record<string, number>
}) {
  const ruta = usePathname()
  const { orden } = useContextoOrden()
  const ordenActual = orden && (ruta === `/ordenes/${orden.id}` || ruta.startsWith(`/ordenes/${orden.id}/`)) ? orden : null

  // El mismo criterio que la barra de abajo del teléfono: los dos marcan igual.
  const activa = rutaActiva(
    ruta,
    NAVEGACION.flatMap((g) => g.items).map((i) => i.ruta),
  )

  const grupos = NAVEGACION.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.disponible && puedeVer(i, permisos, esAdmin, rolCodigo)),
  })).filter((g) => g.items.length > 0)

  return (
    <nav aria-label="Menú principal" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      {grupos.map((grupo) => (
        <div key={grupo.titulo}>
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wide text-texto-suave">
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

              const n = pendientes[item.ruta] ?? 0
              return (
                <li key={item.ruta}>
                  <Link
                    href={item.ruta}
                    onClick={alNavegar}
                    aria-current={activo ? 'page' : undefined}
                    aria-label={n > 0 ? `${item.titulo}, ${n} pendientes` : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento',
                      activo
                        ? 'border-acento bg-acento font-semibold text-acento-texto'
                        : 'border-transparent text-texto-suave hover:border-borde hover:bg-superficie-2 hover:text-texto',
                    )}
                  >
                    <Icono aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{item.titulo}</span>
                    {activo && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
                    {/* Lo que le toca a este puesto en ese módulo, a la vista
                        sin entrar: el mismo globo de la campana. */}
                    {n > 0 && (
                      <span className="tabular ml-auto rounded-full bg-aviso-suave px-1.5 text-[11px] font-semibold text-aviso">
                        {n > 99 ? '99+' : n}
                      </span>
                    )}
                  </Link>
                  {item.ruta === '/ordenes' && ordenActual && (
                    <div className="ml-5 mt-2 border-l border-borde pl-3">
                      <p className="px-3 py-2 text-xs font-semibold text-texto">OT {ordenActual.numero}</p>
                      <ul className="space-y-0.5">
                        {ordenActual.secciones.map(s => <li key={s.clave}>
                          <Link href={s.href} onClick={alNavegar} aria-current={s.clave === ordenActual.activa ? 'page' : undefined}
                            className={cn('flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-acento',
                              s.clave === ordenActual.activa ? 'bg-acento-suave font-semibold text-acento' : 'text-texto-suave hover:bg-superficie-2 hover:text-texto')}>
                            <span>{s.titulo}</span>
                            {s.pendientes > 0 && <span className="rounded-full bg-aviso-suave px-2 text-xs text-aviso" aria-label={`${s.pendientes} pendientes`}>{s.pendientes}</span>}
                          </Link>
                        </li>)}
                      </ul>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

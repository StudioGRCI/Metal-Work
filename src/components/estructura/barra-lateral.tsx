'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'

import { NAVEGACION } from '@/lib/navegacion'
import { cn } from '@/lib/utils'

export function BarraLateral({ permisos, esAdmin }: { permisos: string[]; esAdmin: boolean }) {
  const ruta = usePathname()
  const [abierto, setAbierto] = useState(false)

  const grupos = NAVEGACION.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        !i.permiso ||
        esAdmin ||
        (Array.isArray(i.permiso) ? i.permiso : [i.permiso]).some((p) => permisos.includes(p)),
    ),
  })).filter((g) => g.items.length > 0)

  const contenido = (
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
                    onClick={() => setAbierto(false)}
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

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="fixed bottom-4 left-4 z-40 flex size-11 items-center justify-center rounded-full bg-acento text-acento-texto shadow-lg lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="size-5" />
      </button>

      <aside className="hidden w-56 shrink-0 border-r border-borde bg-superficie lg:block">
        {contenido}
      </aside>

      {abierto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setAbierto(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-superficie shadow-xl">
            <div className="flex items-center justify-between border-b border-borde px-4 py-3">
              <span className="text-sm font-semibold">Menú</span>
              <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar menú">
                <X className="size-5 text-texto-suave" />
              </button>
            </div>
            {contenido}
          </div>
        </div>
      )}
    </>
  )
}

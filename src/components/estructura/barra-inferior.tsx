'use client'

import { LayoutGrid, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { InstalarApp } from '@/components/estructura/instalar-app'
import { NavegacionLista } from '@/components/estructura/navegacion-lista'
import { NAVEGACION, PESTANAS_TELEFONO, puedeVer, rutaActiva } from '@/lib/navegacion'
import { cn } from '@/lib/utils'

/**
 * La barra de pestañas de abajo, en el teléfono: lo que hace que el sistema se
 * sienta aplicación y no página. Cuatro pestañas —las de cada puesto, ver
 * `PESTANAS_TELEFONO`— y «Más», que abre todas las secciones desde abajo.
 *
 * Reemplaza al menú de arriba a la izquierda. Antes hubo un botón redondo fijo
 * abajo y se quitó porque tapaba la última fila de cada lista; esta barra no
 * tapa nada porque ocupa todo el ancho y el contenido deja su alto de margen
 * abajo (`LayoutAplicacion`). El margen del borde inferior del iPhone lo pone
 * `safe-area-inset-bottom`.
 */
export function BarraInferior({ permisos, esAdmin }: { permisos: string[]; esAdmin: boolean }) {
  const ruta = usePathname()
  const [abierto, setAbierto] = useState(false)

  const visibles = NAVEGACION.flatMap((g) => g.items).filter((i) => puedeVer(i, permisos, esAdmin))
  const pestanas = PESTANAS_TELEFONO.flatMap((p) => {
    const item = visibles.find((i) => i.ruta === p.ruta && i.disponible !== false)
    return item ? [{ ...p, icono: item.icono }] : []
  }).slice(0, 4)

  const activa = rutaActiva(
    ruta,
    visibles.map((i) => i.ruta),
  )
  const enMas = !pestanas.some((p) => p.ruta === activa)

  const clasePestana = (activo: boolean) =>
    cn(
      'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors',
      activo ? 'text-acento' : 'text-texto-suave hover:text-texto',
    )
  const claseIcono = (activo: boolean) =>
    cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', activo && 'bg-acento-suave')

  return (
    <>
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)] select-none lg:hidden"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${pestanas.length + 1}, minmax(0, 1fr))` }}
        >
          {pestanas.map((p) => {
            const Icono = p.icono
            const activo = p.ruta === activa
            return (
              <li key={p.ruta}>
                <Link href={p.ruta} aria-current={activo ? 'page' : undefined} className={clasePestana(activo)}>
                  <span className={claseIcono(activo)}>
                    <Icono aria-hidden className="size-5" />
                  </span>
                  <span className="max-w-full truncate">{p.corto}</span>
                </Link>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              onClick={() => setAbierto(true)}
              aria-expanded={abierto}
              aria-haspopup="dialog"
              className={clasePestana(enMas || abierto)}
            >
              <span className={claseIcono(enMas || abierto)}>
                <LayoutGrid aria-hidden className="size-5" />
              </span>
              Más
            </button>
          </li>
        </ul>
      </nav>

      {abierto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setAbierto(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Todas las secciones"
            className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-superficie pb-[env(safe-area-inset-bottom)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-borde px-4 py-2">
              <span className="text-sm font-semibold text-texto">Todas las secciones</span>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="flex size-11 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavegacionLista permisos={permisos} esAdmin={esAdmin} alNavegar={() => setAbierto(false)} />
              <div className="border-t border-borde px-6 py-4">
                <InstalarApp />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

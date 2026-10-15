'use client'

import { ChevronDown, FileSpreadsheet, FileUp, WifiOff, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { CargarPlanilla } from './planilla'

/**
 * «Sin internet», en la esquina derecha del kardex: un botón que despliega la
 * planilla de Excel para anotar sin señal y cargarla al volver.
 *
 * Hasta el 2026-10-15 era una franja a todo el ancho encima de los almacenes,
 * que se veía todos los días aunque se use solo cuando se cae la señal. DKS la
 * pidió como botón desplegable para que no ocupe espacio.
 *
 * La ventana de «Cargar planilla» vive fuera del desplegable: si viviera dentro,
 * se desmontaría al cerrarlo y se perdería la planilla a medio cargar.
 */
export function SinInternet() {
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const boton = useRef<HTMLButtonElement>(null)
  const cerrar = () => {
    setAbierto(false)
    boton.current?.focus()
  }

  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && abierto) cerrar() }}>
      <button
        type="button"
        ref={boton}
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls={abierto ? 'panel-sin-internet' : undefined}
        className={cn(
          'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--radius-base)] border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-acento sm:h-9',
          abierto ? 'border-acento bg-acento-suave text-acento' : 'border-borde-fuerte bg-transparent text-texto-suave hover:bg-superficie-2 hover:text-texto',
        )}
      >
        <WifiOff aria-hidden className="size-4" />
        Sin internet
        <ChevronDown aria-hidden className={cn('size-4 transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <>
          {/* Se cierra al tocar fuera: no hay nada escrito que perder. */}
          <button type="button" aria-label="Cerrar «Sin internet»" onClick={() => setAbierto(false)} className="fixed inset-0 z-40 cursor-default" />

          <section
            id="panel-sin-internet"
            aria-label="Planilla sin internet"
            className="fixed inset-x-3 z-50 mt-2 rounded-2xl border border-borde bg-superficie p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:w-80"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-texto">Planilla sin internet</p>
              <button type="button" onClick={cerrar} aria-label="Cerrar" className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-texto-suave hover:bg-superficie-2 sm:size-8">
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-texto-suave">
              Si se cae la señal, anota en Excel los ingresos y las salidas, y cárgala al volver: cada movimiento entra con su fecha.
            </p>
            <ol className="mt-3 space-y-2">
              <li>
                <a
                  href="/almacen/kardex/planilla"
                  download
                  onClick={() => setAbierto(false)}
                  className="flex min-h-11 items-center gap-3 rounded-xl border border-borde px-3 py-2 hover:bg-superficie-2"
                >
                  <FileSpreadsheet aria-hidden className="size-5 shrink-0 text-acento" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-texto">Descargar planilla</span>
                    <span className="block text-[11px] text-texto-suave">El Excel con el catálogo y el saldo de hoy, para llenar sin señal</span>
                  </span>
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => { setAbierto(false); setCargando(true) }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-borde px-3 py-2 text-left hover:bg-superficie-2"
                >
                  <FileUp aria-hidden className="size-5 shrink-0 text-acento" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-texto">Cargar planilla</span>
                    <span className="block text-[11px] text-texto-suave">La planilla ya llena: revisas qué entra y lo registras</span>
                  </span>
                </button>
              </li>
            </ol>
          </section>
        </>
      )}

      <CargarPlanilla abierta={cargando} alCerrar={() => setCargando(false)} />
    </div>
  )
}

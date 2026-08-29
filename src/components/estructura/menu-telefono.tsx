'use client'

import { Menu, X } from 'lucide-react'
import { useState } from 'react'

import { NavegacionLista } from '@/components/estructura/navegacion-lista'

/**
 * El menú del teléfono, abierto desde la barra superior.
 *
 * Antes era un botón redondo fijo en la esquina de abajo a la izquierda, y en
 * las capturas del recorrido se veía lo que eso cuesta: tapaba la última fila de
 * cada lista, media tarjeta de avance y, a media pantalla del formulario de
 * cotización, la etiqueta del campo «Validez». Un botón que flota sobre una
 * pantalla que se desplaza siempre va a estar encima de algo, y el que lo sufre
 * no tiene forma de apartarlo.
 *
 * Arriba, junto al logotipo, es donde la gente lo busca y no pisa nada: la barra
 * ya ocupa su franja y el contenido empieza debajo.
 */
export function MenuTelefono({ permisos, esAdmin }: { permisos: string[]; esAdmin: boolean }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        // `size-11` son los 44 px que pide un dedo con guante de taller; en el
        // monitor el menú es la barra lateral y este botón no existe.
        className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 hover:text-texto lg:hidden"
        aria-label="Abrir menú"
        aria-expanded={abierto}
      >
        <Menu className="size-5" />
      </button>

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
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar menú"
                className="flex size-9 items-center justify-center rounded-[var(--radius-base)] hover:bg-superficie-2"
              >
                <X className="size-5 text-texto-suave" />
              </button>
            </div>
            <NavegacionLista
              permisos={permisos}
              esAdmin={esAdmin}
              alNavegar={() => setAbierto(false)}
            />
          </div>
        </div>
      )}
    </>
  )
}

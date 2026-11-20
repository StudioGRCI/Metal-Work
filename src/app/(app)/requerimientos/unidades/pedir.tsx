'use client'

import { Plus } from 'lucide-react'
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'

import { Boton } from '@/components/ui/boton'

import { useVentanaDelRequerimiento, VentanaDelRequerimiento } from '../formulario'

type Abrir = (codigo: string | null) => void
const AbrirElRequerimiento = createContext<Abrir | null>(null)

/**
 * Una sola ventana de «Nuevo requerimiento» para todas las unidades de la
 * lista: el catálogo de Almacén viaja una vez y no una por tarjeta. Cada
 * tarjeta la abre con su código ya puesto (`BotonPedirParaUnidad`).
 *
 * El verde de lo que entró va arriba de la lista, siempre montado, para que el
 * lector lo anuncie: al registrar, la tarjeta de la unidad se queda donde
 * estaba y ya cuenta el RQ nuevo.
 */
export function PedirPorUnidad({
  children,
  ...catalogos
}: Omit<ComponentProps<typeof VentanaDelRequerimiento>, 'ventana'> & { children: ReactNode }) {
  const ventana = useVentanaDelRequerimiento()
  return (
    <AbrirElRequerimiento.Provider value={ventana.abrir}>
      <p role="status" className={ventana.aviso ? 'mb-3 text-sm text-exito' : 'sr-only'}>
        {ventana.aviso}
      </p>
      {children}
      <VentanaDelRequerimiento {...catalogos} ventana={ventana} />
    </AbrirElRequerimiento.Provider>
  )
}

/** «Nuevo RQ» de una unidad; sin código, el de lo que no es de una unidad (PLANTA o la que se escriba). */
export function BotonPedirParaUnidad({ codigo, children }: { codigo: string | null; children?: ReactNode }) {
  const abrir = useContext(AbrirElRequerimiento)
  return (
    <Boton
      type="button"
      tamano="sm"
      variante={codigo ? 'primario' : 'contorno'}
      disabled={!abrir}
      onClick={() => abrir?.(codigo)}
      aria-label={codigo ? `Nuevo requerimiento para ${codigo}` : undefined}
    >
      <Plus aria-hidden className="size-4" />
      {children ?? 'Nuevo RQ'}
    </Boton>
  )
}

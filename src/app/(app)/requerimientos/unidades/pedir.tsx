'use client'

import { Plus } from 'lucide-react'
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'

import { Boton } from '@/components/ui/boton'

import { useVentanaDelRequerimiento, VentanaDelRequerimiento } from '../formulario'

type LaVentana = ReturnType<typeof useVentanaDelRequerimiento>
const VentanaCompartida = createContext<LaVentana | null>(null)

/**
 * Una sola ventana de «Nuevo requerimiento» para todas las unidades de la
 * lista: el catálogo de Almacén viaja una vez y no una por tarjeta. Cada
 * tarjeta la abre con su código ya puesto (`BotonPedirParaUnidad`) y dice en
 * ella misma lo que entró (`AvisoDeLaUnidad`): un verde arriba de la lista
 * empujaba las tarjetas hacia abajo y la persona perdía la que acababa de
 * tocar. Lo pedido con «otro código» se dice en el encabezado.
 */
export function PedirPorUnidad({
  children,
  ...catalogos
}: Omit<ComponentProps<typeof VentanaDelRequerimiento>, 'ventana'> & { children: ReactNode }) {
  const ventana = useVentanaDelRequerimiento()
  return (
    <VentanaCompartida.Provider value={ventana}>
      {children}
      <VentanaDelRequerimiento {...catalogos} ventana={ventana} />
    </VentanaCompartida.Provider>
  )
}

/**
 * El verde del RQ que se registró desde esta tarjeta (`codigo`), o desde «Nuevo
 * RQ con otro código» (`null`). Siempre montado y vacío mientras no le toca:
 * el que nace con su texto no lo anuncia el lector.
 */
export function AvisoDeLaUnidad({ codigo, className }: { codigo: string | null; className?: string }) {
  const ventana = useContext(VentanaCompartida)
  const texto = ventana && ventana.codigo === codigo ? ventana.aviso : null
  return (
    <p role="status" className={texto ? `text-sm text-exito ${className ?? ''}` : 'sr-only'}>
      {texto}
    </p>
  )
}

/** «Nuevo RQ» de una unidad; sin código, el de lo que no es de una unidad (PLANTA o la que se escriba). */
export function BotonPedirParaUnidad({ codigo, children }: { codigo: string | null; children?: ReactNode }) {
  const ventana = useContext(VentanaCompartida)
  return (
    <Boton
      type="button"
      tamano="sm"
      variante={codigo ? 'primario' : 'contorno'}
      disabled={!ventana}
      onClick={() => ventana?.abrir(codigo)}
      aria-label={codigo && !children ? `Nuevo RQ para ${codigo}` : undefined}
    >
      <Plus aria-hidden className="size-4" />
      {children ?? 'Nuevo RQ'}
    </Boton>
  )
}

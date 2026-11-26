'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

const Contexto = createContext<{ abierto: boolean; abrir: (abierto: boolean) => void } | null>(null)

/**
 * Si el cajón «Más» del teléfono está abierto. Antes llevaba también las
 * secciones de la OT abierta, que la OT publicaba para la barra lateral del
 * monitor; desde la entrega 2 del plan de orden y diseño (2026-11-25) la OT y
 * el código interno ponen sus secciones arriba del documento
 * (`SeccionesDelDocumento`) y el menú lateral queda solo para los módulos.
 */
export function ContextoMenu({ children }: { children: ReactNode }) {
  const [abierto, abrir] = useState(false)
  const valor = useMemo(() => ({ abierto, abrir }), [abierto])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useContextoMenu() {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('El cajón del menú necesita el contexto de la aplicación.')
  return contexto
}

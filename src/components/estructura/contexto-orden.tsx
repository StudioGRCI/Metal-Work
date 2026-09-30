'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type OrdenEnMenu = {
  id: string
  numero: string
  activa: string
  secciones: { clave: string; titulo: string; href: string; pendientes: number }[]
}

const Contexto = createContext<{
  orden: OrdenEnMenu | null
  publicar: (orden: OrdenEnMenu | null) => void
  abierto: boolean
  abrir: (abierto: boolean) => void
} | null>(null)

/** El servidor publica las secciones autorizadas de la OT que leyó.
 * El contexto presenta enlaces; no reemplaza permisos ni consultas con RLS. */
export function ContextoOrden({ children }: { children: ReactNode }) {
  const [orden, publicar] = useState<OrdenEnMenu | null>(null)
  const [abierto, abrir] = useState(false)
  const valor = useMemo(() => ({ orden, publicar, abierto, abrir }), [orden, abierto])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useContextoOrden() {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('La navegación de la OT necesita el contexto de la aplicación.')
  return contexto
}

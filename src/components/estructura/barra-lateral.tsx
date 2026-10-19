import { NavegacionLista } from '@/components/estructura/navegacion-lista'
import type { ReactNode } from 'react'

/**
 * El menú de módulos del monitor, siempre a la vista.
 *
 * En el teléfono no se muestra: allí el mismo menú se abre desde «Más», en la
 * barra de pestañas de abajo (`BarraInferior`). Los dos pintan la misma lista
 * para que un módulo nuevo no aparezca en uno y falte en el otro.
 */
export function BarraLateral({
  permisos,
  esAdmin,
  rolCodigo,
  pendientes,
  sinComprobar,
  children,
}: {
  permisos: string[]
  esAdmin: boolean
  rolCodigo: string
  pendientes?: Record<string, number>
  /** Rutas con un pendiente que no se pudo contar: el globo dice «!». */
  sinComprobar?: string[]
  children: ReactNode
}) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 flex-col self-start border-r border-borde bg-superficie lg:flex print:hidden">
      <div className="min-h-0 flex-1"><NavegacionLista permisos={permisos} esAdmin={esAdmin} rolCodigo={rolCodigo} pendientes={pendientes} sinComprobar={sinComprobar} /></div>
      {children}
    </aside>
  )
}

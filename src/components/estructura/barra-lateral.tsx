import { NavegacionLista } from '@/components/estructura/navegacion-lista'

/**
 * El menú de módulos del monitor, siempre a la vista.
 *
 * En el teléfono no se muestra: allí el mismo menú se abre desde el botón de la
 * barra superior (`MenuTelefono`). Los dos pintan la misma lista para que un
 * módulo nuevo no aparezca en uno y falte en el otro.
 */
export function BarraLateral({ permisos, esAdmin }: { permisos: string[]; esAdmin: boolean }) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-borde bg-superficie lg:block">
      <NavegacionLista permisos={permisos} esAdmin={esAdmin} />
    </aside>
  )
}

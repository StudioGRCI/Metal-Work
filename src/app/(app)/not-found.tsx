import { SearchX } from 'lucide-react'

import { EnlaceBoton } from '@/components/ui/enlace-boton'

/**
 * Cuando un módulo no encuentra el registro que se pidió. Se queda dentro de la
 * aplicación, con el menú a la vista. El RLS esconde lo que el puesto no puede
 * ver, y para la base eso es lo mismo que no existir: por eso se nombra también
 * esa posibilidad.
 */
export default function NoEncontradoEnElModulo() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-neutro-suave text-texto-suave">
        <SearchX aria-hidden className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-texto">No encontramos lo que buscas</h1>
      <p className="mt-2 text-sm text-texto-suave">
        La dirección no existe, el registro fue anulado o movido, o tu puesto no tiene acceso a él. Si crees que
        deberías verlo, pide al administrador que revise tus permisos.
      </p>
      <EnlaceBoton href="/" className="mt-6">
        Volver al tablero
      </EnlaceBoton>
    </div>
  )
}

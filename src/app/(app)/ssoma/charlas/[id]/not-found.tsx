import { SearchX } from 'lucide-react'

import { EnlaceBoton } from '@/components/ui/enlace-boton'

/** Una charla que no existe, o un enlace mal copiado: se lleva a la lista del mes. */
export default function CharlaSsomaNoEncontrada() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-neutro-suave text-texto-suave">
        <SearchX aria-hidden className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-texto">No encontramos esta charla</h1>
      <p className="mt-2 text-sm text-texto-suave">El enlace puede estar incompleto. Las charlas e inducciones registradas están en su lista, por mes.</p>
      <EnlaceBoton href="/ssoma/charlas" className="mt-6">
        Ver las charlas
      </EnlaceBoton>
    </div>
  )
}

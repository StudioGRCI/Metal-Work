import { ShieldAlert } from 'lucide-react'

import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { obtenerSesion } from '@/lib/sesion'

export const metadata = { title: 'Sin permiso' }

export default async function PaginaSinPermiso() {
  const perfil = await obtenerSesion()

  return (
    // Menos aire arriba y abajo en el teléfono: con `py-20` el botón de volver
    // caía fuera de la pantalla y parecía que no había salida.
    <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center sm:py-20">
      <ShieldAlert aria-hidden className="size-10 text-aviso" />
      <h1 className="mt-4 text-lg font-semibold text-texto">No tienes acceso a esta sección</h1>
      <p className="mt-2 text-sm text-texto-suave">
        Tu perfil es <strong className="text-texto">{perfil?.rol.nombre ?? 'sin rol'}</strong> y no
        incluye este permiso. Si necesitas acceso, solicítalo al administrador del sistema.
      </p>
      <EnlaceBoton href="/" variante="secundario" className="mt-6">
        Volver al tablero
      </EnlaceBoton>
    </div>
  )
}

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { obtenerSesion } from '@/lib/sesion'

export const metadata = { title: 'Sin permiso' }

export default async function PaginaSinPermiso() {
  const perfil = await obtenerSesion()

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <ShieldAlert aria-hidden className="size-10 text-aviso" />
      <h1 className="mt-4 text-lg font-semibold text-texto">No tienes acceso a esta sección</h1>
      <p className="mt-2 text-sm text-texto-suave">
        Tu perfil es <strong className="text-texto">{perfil?.rol.nombre ?? 'sin rol'}</strong> y no
        incluye este permiso. Si necesitas acceso, solicítalo al administrador del sistema.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-9 items-center rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-4 text-sm font-medium text-texto hover:bg-neutro-suave"
      >
        Volver al tablero
      </Link>
    </div>
  )
}

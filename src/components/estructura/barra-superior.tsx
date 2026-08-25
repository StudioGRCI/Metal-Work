import Link from 'next/link'
import { LogOut } from 'lucide-react'

import { iniciales } from '@/lib/format'
import type { PerfilSesion } from '@/lib/sesion'

export function BarraSuperior({ perfil }: { perfil: PerfilSesion }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-borde bg-superficie px-4">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-[var(--radius-base)] bg-acento text-xs font-bold text-acento-texto">
          MW
        </span>
        <span className="hidden text-sm font-semibold text-texto sm:block">Metal-Work</span>
      </Link>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium text-texto">
            {perfil.nombres} {perfil.apellidos}
          </p>
          <p className="text-[11px] text-texto-suave">{perfil.cargo ?? perfil.rol.nombre}</p>
        </div>

        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-superficie-2 text-xs font-semibold text-texto-suave"
        >
          {iniciales(perfil.nombres, perfil.apellidos)}
        </span>

        <form action="/auth/salir" method="post">
          <button
            type="submit"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="flex size-8 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 hover:text-texto"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  )
}

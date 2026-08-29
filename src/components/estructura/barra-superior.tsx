import Link from 'next/link'
import { LogOut } from 'lucide-react'

import { CambiarTema } from '@/components/estructura/cambiar-tema'
import { MenuTelefono } from '@/components/estructura/menu-telefono'
import { LogoMetalWork } from '@/components/marca/logo-metal-work'
import { iniciales } from '@/lib/format'
import type { PerfilSesion } from '@/lib/sesion'

export function BarraSuperior({
  perfil,
  permisos,
  esAdmin,
}: {
  perfil: PerfilSesion
  permisos: string[]
  esAdmin: boolean
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-borde bg-superficie px-4">
      {/* El menú del teléfono vive acá y no flotando sobre la pantalla: un
          botón fijo sobre contenido que se desplaza siempre termina encima de
          algo, y en las capturas tapaba filas de lista y etiquetas de campo. */}
      <div className="flex min-w-0 items-center gap-1">
        <MenuTelefono permisos={permisos} esAdmin={esAdmin} />
        <Link href="/" aria-label="Ir al tablero" className="flex shrink-0 items-center">
          <LogoMetalWork className="h-7 w-auto lg:h-8" />
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <CambiarTema />

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
            className="flex size-11 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 hover:text-texto sm:size-9"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  )
}

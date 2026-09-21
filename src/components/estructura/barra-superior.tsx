import Link from 'next/link'
import { Campana } from '@/components/estructura/campana'
import { CambiarTema } from '@/components/estructura/cambiar-tema'
import { LogoMetalWork } from '@/components/marca/logo-metal-work'
import { avisosSinLeer, misNotificaciones } from '@/lib/datos/notificaciones'

export async function BarraSuperior() {
  const [avisos, sinLeer] = await Promise.all([misNotificaciones(), avisosSinLeer()])
  return (
    <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-borde bg-superficie px-4 pt-[env(safe-area-inset-top)] lg:flex-nowrap lg:justify-between">
      <Link href="/" aria-label="Ir al tablero" className="flex w-full justify-center py-2 lg:w-auto lg:justify-start lg:py-0">
        <LogoMetalWork className="h-7 w-auto lg:h-8" />
      </Link>
      <div className="flex w-full items-center justify-between gap-2 pb-1 lg:w-auto lg:justify-end lg:pb-0">
        <CambiarTema />
        <Campana avisos={avisos} sinLeer={sinLeer} />
      </div>
    </header>
  )
}

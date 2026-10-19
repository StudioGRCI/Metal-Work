import Link from 'next/link'
import { Campana } from '@/components/estructura/campana'
import { CambiarTema } from '@/components/estructura/cambiar-tema'
import { LogoMetalWork } from '@/components/marca/logo-metal-work'
import { avisosSinLeer, misNotificaciones } from '@/lib/datos/notificaciones'

export async function BarraSuperior() {
  const [avisos, sinLeer] = await Promise.all([misNotificaciones(), avisosSinLeer()])
  return (
    <header className="sticky top-0 z-30 grid min-h-14 print:hidden grid-cols-[5.75rem_minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-borde bg-superficie px-3 pt-[env(safe-area-inset-top)] lg:flex lg:justify-between lg:px-4">
      <Link href="/" aria-label="Ir al dashboard" className="col-start-2 row-start-1 flex justify-center py-2 lg:order-1 lg:justify-start lg:py-0">
        <LogoMetalWork className="h-7 w-auto lg:h-8" />
      </Link>
      <div className="contents lg:order-2 lg:ml-auto lg:flex lg:items-center lg:gap-2">
        <div className="col-start-1 row-start-1 justify-self-start lg:static">
          <CambiarTema />
        </div>
        <div className="col-start-3 row-start-1 flex items-center gap-1 justify-self-end lg:static lg:gap-2">
          {/* Aquí aparece el «i» de la caja después de un pago (`AvisoDeLaCaja`):
              en la barra y no flotando sobre la lista. Columnas de 5.75rem para
              que quepan dos botones y el logo siga al centro. */}
          <div id="ranura-aviso-caja" className="contents" />
          <Campana avisos={avisos} sinLeer={sinLeer} />
        </div>
      </div>
    </header>
  )
}

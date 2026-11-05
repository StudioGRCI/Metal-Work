import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoTope } from '@/components/estructura/paginacion'
import { Tarjeta } from '@/components/ui/tarjeta'
import { avisosSinLeer, misNotificaciones } from '@/lib/datos/notificaciones'
import { exigirSesion } from '@/lib/sesion'

import { FiltroAvisos } from './filtro-avisos'
import { ListaAvisos } from './lista-avisos'

export const metadata = { title: 'Avisos' }

const TOPE = 200

/**
 * Todos los avisos, no solo los últimos veinte de la campana.
 *
 * En un día movido los avisos de la mañana se caían de la campana sin haberse
 * leído y no había dónde recuperarlos. Acá están los últimos doscientos, con
 * los sin leer primero si se pide.
 */
export default async function PaginaAvisos({ searchParams }: PageProps<'/avisos'>) {
  await exigirSesion()
  const params = await searchParams
  const ver = params.ver === 'sin-leer' ? 'sin-leer' : null

  const [avisos, sinLeer] = await Promise.all([misNotificaciones(TOPE, ver === 'sin-leer'), avisosSinLeer()])

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avisos' }]}
        titulo="Avisos"
        ayuda="Lo que el circuito te fue dejando: cada uno lleva a la pantalla donde se resuelve."
      />

      <FiltroAvisos sinLeer={sinLeer} params={params} activo={ver} />

      <Tarjeta className="overflow-hidden">
        <ListaAvisos avisos={avisos} sinLeer={sinLeer} />
      </Tarjeta>

      <AvisoTope mostradas={avisos.length} tope={TOPE} />
    </>
  )
}

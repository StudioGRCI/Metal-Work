import { BarraInferior } from '@/components/estructura/barra-inferior'
import { BarraLateral } from '@/components/estructura/barra-lateral'
import { BarraSuperior } from '@/components/estructura/barra-superior'
import { AvisoInstalar } from '@/components/estructura/instalar-app'
import { RefrescoAlVolver } from '@/components/estructura/refresco-al-volver'
import { avisosSinLeer } from '@/lib/datos/notificaciones'
import { pendientesGlobales } from '@/lib/datos/pendientes-globales'
import { exigirSesion } from '@/lib/sesion'

import { contarAvisosSinLeer } from './acciones-avisos'

export default async function LayoutAplicacion({ children }: LayoutProps<'/'>) {
  const perfil = await exigirSesion()
  const esAdmin = perfil.rol.codigo === 'ADMIN'

  // Lo que le toca a este puesto, contado una vez por carga: los globos del
  // menú salen de aquí y se ponen al día con el refresco al volver.
  const [pendientes, sinLeer] = await Promise.all([pendientesGlobales(perfil), avisosSinLeer()])

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSuperior perfil={perfil} />
      <AvisoInstalar />
      <RefrescoAlVolver sinLeer={sinLeer} contar={contarAvisosSinLeer} />
      <div className="flex flex-1">
        <BarraLateral permisos={perfil.permisos} esAdmin={esAdmin} pendientes={pendientes.porRuta} />
        {/* En el teléfono el contenido deja abajo el alto de la barra de
            pestañas, más el borde del iPhone: así la última fila de una lista
            nunca queda debajo de la barra. */}
        <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-6">
          {children}
        </main>
      </div>
      <BarraInferior permisos={perfil.permisos} esAdmin={esAdmin} pendientes={pendientes.porRuta} />
    </div>
  )
}

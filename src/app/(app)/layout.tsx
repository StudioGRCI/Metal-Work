import { BarraInferior } from '@/components/estructura/barra-inferior'
import { ContextoOrden } from '@/components/estructura/contexto-orden'
import { BarraLateral } from '@/components/estructura/barra-lateral'
import { BarraSuperior } from '@/components/estructura/barra-superior'
import { CuentaDeLaPestana } from '@/components/estructura/cuenta-de-la-pestana'
import { PerfilMenu } from '@/components/estructura/perfil-menu'
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
    <ContextoOrden><div className="flex min-h-dvh flex-col">
      <CuentaDeLaPestana usuario={perfil.id} puesto={perfil.puesto} />
      <BarraSuperior />
      <AvisoInstalar />
      <RefrescoAlVolver sinLeer={sinLeer} contar={contarAvisosSinLeer} />
      <div className="flex flex-1">
        <BarraLateral permisos={perfil.permisos} esAdmin={esAdmin} rolCodigo={perfil.rol.codigo} pendientes={pendientes.porRuta} sinComprobar={pendientes.sinComprobar}>
          <PerfilMenu puesto={perfil.puesto} rol={perfil.rol.nombre} />
        </BarraLateral>
        {/* En el teléfono el contenido deja abajo el alto de la barra de
            pestañas, más el borde del iPhone: así la última fila de una lista
            nunca queda debajo de la barra. */}
        <main tabIndex={-1} className="min-w-0 flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none lg:px-6 lg:pb-6 print:p-0">
          {/* Tope de ancho para los monitores grandes: a 2560 px una tabla de
              seis columnas dejaba metro y medio entre el número de la OT y su
              estado, y el ojo perdía la fila. En 1440 y 1920 no cambia nada. */}
          <div className="mx-auto w-full max-w-[100rem]">{children}</div>
        </main>
      </div>
      <BarraInferior permisos={perfil.permisos} esAdmin={esAdmin} rolCodigo={perfil.rol.codigo} pendientes={pendientes.porRuta} sinComprobar={pendientes.sinComprobar}>
        <PerfilMenu puesto={perfil.puesto} rol={perfil.rol.nombre} />
      </BarraInferior>
    </div></ContextoOrden>
  )
}

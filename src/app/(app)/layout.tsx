import { cookies } from 'next/headers'

import { BarraInferior } from '@/components/estructura/barra-inferior'
import { ContextoMenu } from '@/components/estructura/contexto-menu'
import { BarraLateral } from '@/components/estructura/barra-lateral'
import { BarraSuperior } from '@/components/estructura/barra-superior'
import { CuentaDeLaPestana } from '@/components/estructura/cuenta-de-la-pestana'
import { PerfilMenu } from '@/components/estructura/perfil-menu'
import { IdaQueNoSalio } from '@/components/estructura/ida-que-no-salio'
import { AvisoInstalar } from '@/components/estructura/instalar-app'
import { RefrescoAlVolver } from '@/components/estructura/refresco-al-volver'
import { compilacionDelServidor } from '@/lib/compilacion'
import { avisosSinLeer } from '@/lib/datos/notificaciones'
import { pendientesGlobales } from '@/lib/datos/pendientes-globales'
import { cookieDelMenu } from '@/lib/navegacion'
import { exigirSesion } from '@/lib/sesion'

import { contarAvisosYDespliegue } from './acciones-avisos'

export default async function LayoutAplicacion({ children }: LayoutProps<'/'>) {
  const perfil = await exigirSesion()
  const esAdmin = perfil.rol.codigo === 'ADMIN'

  // Lo que le toca a este puesto, contado una vez por carga: los globos del
  // menú salen de aquí y se ponen al día con el refresco al volver.
  const [pendientes, sinLeer, galletas] = await Promise.all([pendientesGlobales(perfil), avisosSinLeer(), cookies()])
  // Los grupos que esta persona plegó: el menú sale así desde el servidor, sin saltar al hidratar.
  const plegado = leerPlegado(galletas.get(cookieDelMenu(perfil.rol.codigo))?.value)

  return (
    <ContextoMenu><div className="flex min-h-dvh flex-col">
      <CuentaDeLaPestana usuario={perfil.id} puesto={perfil.puesto} nombre={`${perfil.nombres} ${perfil.apellidos}`} />
      <BarraSuperior />
      <AvisoInstalar />
      <RefrescoAlVolver sinLeer={sinLeer} compilacion={compilacionDelServidor()} contar={contarAvisosYDespliegue} />
      <IdaQueNoSalio />
      <div className="flex flex-1">
        <BarraLateral plegado={plegado} permisos={perfil.permisos} esAdmin={esAdmin} rolCodigo={perfil.rol.codigo} pendientes={pendientes.porRuta} sinComprobar={pendientes.sinComprobar}>
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
      <BarraInferior plegado={plegado} permisos={perfil.permisos} esAdmin={esAdmin} rolCodigo={perfil.rol.codigo} pendientes={pendientes.porRuta} sinComprobar={pendientes.sinComprobar}>
        <PerfilMenu puesto={perfil.puesto} rol={perfil.rol.nombre} />
      </BarraInferior>
    </div></ContextoMenu>
  )
}

/** El valor de la cookie del menú, con o sin codificar: una cookie dañada deja el menú como lo fija el puesto. */
function leerPlegado(valor: string | undefined) {
  try {
    const texto = valor?.startsWith('%') ? decodeURIComponent(valor) : valor
    if (!texto) return '{}'
    const v: unknown = JSON.parse(texto)
    return v && typeof v === 'object' && !Array.isArray(v) ? texto : '{}'
  } catch {
    return '{}'
  }
}

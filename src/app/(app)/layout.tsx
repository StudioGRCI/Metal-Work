import { BarraInferior } from '@/components/estructura/barra-inferior'
import { BarraLateral } from '@/components/estructura/barra-lateral'
import { BarraSuperior } from '@/components/estructura/barra-superior'
import { AvisoInstalar } from '@/components/estructura/instalar-app'
import { exigirSesion } from '@/lib/sesion'

export default async function LayoutAplicacion({ children }: LayoutProps<'/'>) {
  const perfil = await exigirSesion()
  const esAdmin = perfil.rol.codigo === 'ADMIN'

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSuperior perfil={perfil} />
      <AvisoInstalar />
      <div className="flex flex-1">
        <BarraLateral permisos={perfil.permisos} esAdmin={esAdmin} />
        {/* En el teléfono el contenido deja abajo el alto de la barra de
            pestañas, más el borde del iPhone: así la última fila de una lista
            nunca queda debajo de la barra. */}
        <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-6">
          {children}
        </main>
      </div>
      <BarraInferior permisos={perfil.permisos} esAdmin={esAdmin} />
    </div>
  )
}

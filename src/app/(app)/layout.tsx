import { BarraLateral } from '@/components/estructura/barra-lateral'
import { BarraSuperior } from '@/components/estructura/barra-superior'
import { exigirSesion } from '@/lib/sesion'

export default async function LayoutAplicacion({ children }: LayoutProps<'/'>) {
  const perfil = await exigirSesion()

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSuperior perfil={perfil} />
      <div className="flex flex-1">
        <BarraLateral permisos={perfil.permisos} esAdmin={perfil.rol.codigo === 'ADMIN'} />
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  )
}

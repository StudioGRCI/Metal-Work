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
        {/* El hueco de abajo en el teléfono no es estético: el botón del menú
            va fijo en esa esquina y, sin él, se sienta encima de la última fila
            de cada lista. En las capturas tapaba la última cotización y media
            tarjeta de avance. En monitor el botón no existe y el hueco sobra. */}
        <main className="min-w-0 flex-1 px-4 pt-6 pb-24 lg:px-6 lg:pb-6">{children}</main>
      </div>
    </div>
  )
}

import { ShieldAlert } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { obtenerSesion } from '@/lib/sesion'

export const metadata = { title: 'Sin permiso' }

export default async function PaginaSinPermiso() {
  const perfil = await obtenerSesion()

  return (
    // Menos aire arriba y abajo en el teléfono: con `py-20` el botón de volver
    // caía fuera de la pantalla y parecía que no había salida.
    <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center sm:py-20">
      <ShieldAlert aria-hidden className="size-10 text-aviso" />
      <h1 className="mt-4 text-lg font-semibold text-texto">No tienes acceso a esta sección</h1>
      {/* Con qué cuenta está la sesión, y la salida para entrar con otra: se
          llega aquí también al recargar una pestaña que era de otra cuenta
          (`useOtraCuentaEnLaPestana`), y «solicítalo al administrador» era el
          consejo equivocado para quien solo tenía que volver a entrar con la
          suya (vigesimoprimera pasada). */}
      <p className="mt-2 text-sm text-texto-suave">
        Estás con la cuenta de <strong className="text-texto">{perfil?.puesto ?? 'sin rol'}</strong>, y su perfil no incluye
        este permiso. Si no es tu cuenta, sal y entra con la tuya; si necesitas acceso, solicítalo al administrador del
        sistema.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <EnlaceBoton href="/" variante="secundario">
          Volver al dashboard
        </EnlaceBoton>
        {/* Formulario y no enlace: /auth/salir solo acepta POST. */}
        <form action="/auth/salir" method="post">
          <Boton type="submit" variante="contorno">
            Salir y entrar con otra cuenta
          </Boton>
        </form>
      </div>
    </div>
  )
}

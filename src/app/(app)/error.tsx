'use client'

import { AlertTriangle, RotateCw } from 'lucide-react'
import { useEffect } from 'react'

import { Boton } from '@/components/ui/boton'
import { EnlaceBoton } from '@/components/ui/enlace-boton'

/**
 * Un error dentro de un módulo se queda en ese módulo: el menú sigue a la vista
 * y se puede seguir trabajando en lo demás. Antes lo atrapaba solo el límite
 * de la raíz, que reemplazaba la aplicación entera por una pantalla en blanco
 * con un botón.
 */
export default function ErrorDelModulo({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-aviso-suave text-aviso">
        <AlertTriangle aria-hidden className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-texto">Esta pantalla no se pudo abrir</h1>
      <p className="mt-2 text-sm text-texto-suave">
        El resto del sistema sigue funcionando: puedes reintentar o ir a otro módulo desde el menú. Si vuelve a pasar,
        avisa al administrador con este código: <span className="tabular font-medium text-texto">{error.digest ?? 'sin código'}</span>.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {/* retry vuelve a pedir los datos al servidor; reset solo redibujaba lo que ya había fallado. */}
        <Boton type="button" onClick={() => retry()}>
          <RotateCw aria-hidden className="size-4" />
          Reintentar
        </Boton>
        <EnlaceBoton href="/" variante="secundario">
          Ir al tablero
        </EnlaceBoton>
      </div>
    </div>
  )
}

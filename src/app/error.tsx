'use client'

import { useEffect } from 'react'

import { Boton } from '@/components/ui/boton'

export default function ErrorGlobal({
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
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold text-texto">Ocurrió un error inesperado</h1>
      <p className="mt-2 max-w-md text-sm text-texto-suave">
        No se pudo completar la operación. Si el problema persiste, informa al administrador
        indicando el código {error.digest ?? 'sin código'}.
      </p>
      {/* retry vuelve a pedir los datos al servidor; reset solo redibujaba lo que ya había fallado. */}
      <Boton type="button" onClick={() => retry()} className="mt-6">
        Reintentar
      </Boton>
    </main>
  )
}

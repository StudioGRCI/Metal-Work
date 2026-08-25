'use client'

import { useEffect } from 'react'

export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
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
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-[var(--radius-base)] bg-acento px-4 py-2 text-sm font-medium text-acento-texto"
      >
        Reintentar
      </button>
    </main>
  )
}

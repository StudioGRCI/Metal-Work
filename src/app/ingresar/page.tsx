import type { Metadata } from 'next'

import { FormularioIngreso } from './formulario-ingreso'

export const metadata: Metadata = { title: 'Ingresar' }

export default async function PaginaIngreso({ searchParams }: PageProps<'/ingresar'>) {
  const params = await searchParams
  const redirigir = typeof params.redirigir === 'string' ? params.redirigir : '/'

  return (
    <main className="flex min-h-dvh items-center justify-center bg-fondo px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-[var(--radius-base)] bg-acento text-lg font-bold text-acento-texto">
            MW
          </div>
          <h1 className="text-xl font-semibold text-texto">Metal-Work</h1>
          <p className="mt-1 text-sm text-texto-suave">
            Gestión de órdenes de trabajo y producción
          </p>
        </div>

        <FormularioIngreso redirigir={redirigir} />

        <p className="mt-6 text-center text-xs text-texto-tenue">
          ¿Problemas para ingresar? Comunícate con el administrador del sistema.
        </p>
      </div>
    </main>
  )
}

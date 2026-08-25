import Link from 'next/link'

export default function NoEncontrado() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-acento">404</p>
      <h1 className="mt-2 text-xl font-semibold text-texto">Página no encontrada</h1>
      <p className="mt-2 max-w-sm text-sm text-texto-suave">
        La dirección no existe o el registro que buscas fue movido o anulado.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-[var(--radius-base)] bg-acento px-4 py-2 text-sm font-medium text-acento-texto"
      >
        Volver al tablero
      </Link>
    </main>
  )
}

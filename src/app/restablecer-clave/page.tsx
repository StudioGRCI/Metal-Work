import type { Metadata } from 'next'
import Link from 'next/link'

import { FormularioRestablecer } from './formulario-restablecer'

export const metadata: Metadata = { title: 'Restablecer contraseña' }

export default function PaginaRestablecer() {
  return <main className="flex min-h-dvh items-center justify-center bg-fondo px-4 py-10">
    <section className="w-full max-w-md rounded-[var(--radius-base)] border border-borde bg-superficie p-6">
      <h1 className="text-lg font-semibold text-texto">Restablecer contraseña</h1>
      <p className="mt-1 text-sm text-texto-suave">Recibirás un enlace en tu correo de Metal Work.</p>
      <FormularioRestablecer />
      <p className="mt-4 text-center text-sm"><Link href="/ingresar" className="text-acento underline underline-offset-2">Volver a ingresar</Link></p>
    </section>
  </main>
}

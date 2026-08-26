import type { Metadata } from 'next'
import Image from 'next/image'

import { LogoMetalWork } from '@/components/marca/logo-metal-work'

import { FormularioIngreso } from './formulario-ingreso'

export const metadata: Metadata = { title: 'Ingresar' }

export default async function PaginaIngreso({ searchParams }: PageProps<'/ingresar'>) {
  const params = await searchParams
  const redirigir = typeof params.redirigir === 'string' ? params.redirigir : '/'
  const motivo = typeof params.motivo === 'string' ? params.motivo : null

  const AVISOS: Record<string, string> = {
    'sin-perfil':
      'Tu cuenta existe pero todavía no tiene un perfil en el sistema. Pídele al administrador que te dé de alta y vuelve a entrar.',
    inactivo:
      'Tu cuenta está dada de baja. Si crees que es un error, comunícate con el administrador.',
  }
  const aviso = motivo ? AVISOS[motivo] : null

  return (
    <main className="relative min-h-dvh">
      {/* El taller de fondo. `priority` porque es lo primero que se ve. */}
      <Image
        src="/marca/taller.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      {/* Velo oscuro: sin él, ni el texto blanco ni la tarjeta se leen sobre la foto. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-black/55 lg:bg-gradient-to-r lg:from-black/80 lg:via-black/55 lg:to-black/25"
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center gap-10 px-5 py-12 lg:flex-row lg:items-center lg:gap-16 lg:px-8">
        {/* Presentación */}
        <section className="lg:flex-1">
          {/* La marca es azul sobre blanco, así que sobre la foto va en su placa. */}
          <div className="inline-flex rounded-[calc(var(--radius-base)*1.5)] bg-white px-5 py-4 shadow-lg shadow-black/25">
            <LogoMetalWork className="h-11 w-auto lg:h-14" />
          </div>
          <h1 className="mt-8 max-w-md text-2xl font-semibold text-white lg:text-4xl">
            Control de órdenes de trabajo, taller y costos
          </h1>
          <p className="mt-3 max-w-md text-sm text-white/70 lg:text-base">
            De la cotización a la entrega de la unidad: cada etapa, cada material y cada hora
            en un solo lugar.
          </p>
        </section>

        {/* Ingreso */}
        <section className="w-full lg:w-[26rem] lg:shrink-0">
          <div className="rounded-[calc(var(--radius-base)*2)] bg-superficie p-6 shadow-2xl shadow-black/30 sm:p-7">
            <h2 className="text-base font-semibold text-texto">Ingresar al sistema</h2>
            <p className="mt-1 text-xs text-texto-suave">
              Usa el correo que te dio administración.
            </p>

            {aviso && (
              <div
                role="status"
                className="mt-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-aviso"
              >
                {aviso}
              </div>
            )}

            <div className="mt-5">
              <FormularioIngreso redirigir={redirigir} />
            </div>

            {motivo && (
              <p className="mt-4 text-center text-xs">
                <a href="/auth/salir" className="text-acento underline underline-offset-2">
                  Cerrar sesión y entrar con otra cuenta
                </a>
              </p>
            )}

            <p className="mt-5 border-t border-borde pt-4 text-center text-xs text-texto-tenue">
              ¿Problemas para ingresar? Comunícate con el administrador del sistema.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}

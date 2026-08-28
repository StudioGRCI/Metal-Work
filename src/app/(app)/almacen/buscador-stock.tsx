'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Loader2, Search } from 'lucide-react'

import { Entrada } from '@/components/ui/campos'

export function BuscadorStock() {
  const router = useRouter()
  const params = useSearchParams()
  const [pendiente, iniciarTransicion] = useTransition()
  const [busqueda, setBusqueda] = useState(params.get('q') ?? '')

  function navegar(cambios: Record<string, string | null>) {
    const query = new URLSearchParams(params.toString())
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) query.set(clave, valor)
      else query.delete(clave)
    }
    iniciarTransicion(() => router.push(`/almacen?${query}`))
  }

  useEffect(() => {
    const actual = params.get('q') ?? ''
    if (busqueda === actual) return

    const temporizador = setTimeout(() => navegar({ q: busqueda || null }), 350)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  // Lo escrito todavía no llegó a la URL, o la lista se está rehaciendo: en los
  // dos casos lo de abajo ya no es la respuesta a lo que se pidió, y con la
  // pantalla chica eso no se nota si nadie lo dice.
  const buscando = pendiente || busqueda !== (params.get('q') ?? '')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        {buscando ? (
          <Loader2
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-acento motion-reduce:animate-none"
          />
        ) : (
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-texto-tenue"
          />
        )}
        <Entrada
          type="search"
          className="pl-9"
          placeholder="Buscar por código o descripción del material"
          aria-label="Buscar materiales"
          autoComplete="off"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {buscando ? 'Buscando…' : ''}
      </p>

      {/* La etiqueta entera es el blanco del dedo: 44 px de alto en el teléfono
          —con guante puesto, un cuadrito de 14 px no se acierta— y los 36 px de
          siempre en el monitor. `min-h` le gana a `h`, así que en `sm:` hay que
          soltarlo o el escritorio se queda con la altura del teléfono. */}
      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 text-sm text-texto-suave sm:h-9 sm:min-h-0">
        <input
          type="checkbox"
          className="size-4 accent-[var(--acento)] sm:size-3.5"
          checked={params.get('bajo') === '1'}
          onChange={(e) => navegar({ bajo: e.target.checked ? '1' : null })}
        />
        Solo bajo mínimo
      </label>
    </div>
  )
}

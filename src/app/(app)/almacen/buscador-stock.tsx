'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Search } from 'lucide-react'

import { Entrada } from '@/components/ui/campos'

export function BuscadorStock() {
  const router = useRouter()
  const params = useSearchParams()
  const [, iniciarTransicion] = useTransition()
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-texto-tenue"
        />
        <Entrada
          type="search"
          className="pl-9"
          placeholder="Buscar por código o descripción del material"
          aria-label="Buscar materiales"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <label className="flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 text-sm text-texto-suave">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--acento)]"
          checked={params.get('bajo') === '1'}
          onChange={(e) => navegar({ bajo: e.target.checked ? '1' : null })}
        />
        Solo bajo mínimo
      </label>
    </div>
  )
}

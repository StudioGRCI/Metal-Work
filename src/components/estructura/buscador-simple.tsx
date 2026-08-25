'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Search, X } from 'lucide-react'

import { Entrada } from '@/components/ui/campos'

/** Caja de búsqueda que escribe el término en la URL tras una breve pausa. */
export function BuscadorSimple({
  ruta,
  etiqueta,
  marcador,
}: {
  ruta: string
  etiqueta: string
  marcador: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [, iniciarTransicion] = useTransition()
  const [busqueda, setBusqueda] = useState(params.get('q') ?? '')

  useEffect(() => {
    const actual = params.get('q') ?? ''
    if (busqueda === actual) return

    const temporizador = setTimeout(() => {
      const query = new URLSearchParams(params.toString())
      if (busqueda) query.set('q', busqueda)
      else query.delete('q')
      query.delete('pagina')
      iniciarTransicion(() => router.push(`${ruta}?${query}`))
    }, 350)

    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-texto-tenue"
        />
        <Entrada
          type="search"
          className="pl-9"
          placeholder={marcador}
          aria-label={etiqueta}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {params.get('q') && (
        <button
          type="button"
          onClick={() => {
            setBusqueda('')
            iniciarTransicion(() => router.push(ruta))
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-base)] px-3 text-sm text-texto-suave hover:bg-superficie-2 hover:text-texto"
        >
          <X aria-hidden className="size-3.5" />
          Limpiar
        </button>
      )}
    </div>
  )
}

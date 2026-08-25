'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Search, X } from 'lucide-react'

import { Entrada, Seleccion } from '@/components/ui/campos'
import { ESTADO_OT, ORDEN_ESTADO_OT, PRIORIDAD, opciones } from '@/lib/dominio/estados'

const ESTADOS = opciones(ESTADO_OT, ORDEN_ESTADO_OT)
const PRIORIDADES = opciones(PRIORIDAD)

export function FiltrosOrdenes() {
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
    // Cualquier cambio de filtro devuelve a la primera página.
    query.delete('pagina')
    iniciarTransicion(() => router.push(`/ordenes?${query}`))
  }

  // La búsqueda se envía sola tras una pausa, sin necesidad de pulsar Enter.
  useEffect(() => {
    const actual = params.get('q') ?? ''
    if (busqueda === actual) return

    const temporizador = setTimeout(() => navegar({ q: busqueda || null }), 350)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  const hayFiltros = ['q', 'estado', 'prioridad', 'atrasadas'].some((k) => params.get(k))

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
          placeholder="Buscar por número, cliente, placa o descripción"
          aria-label="Buscar órdenes"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <Seleccion
        className="w-auto"
        aria-label="Filtrar por estado"
        value={params.get('estado') ?? ''}
        onChange={(e) => navegar({ estado: e.target.value || null })}
      >
        <option value="">Todos los estados</option>
        <option value="ABIERTAS">En taller (abiertas)</option>
        {ESTADOS.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </Seleccion>

      <Seleccion
        className="w-auto"
        aria-label="Filtrar por prioridad"
        value={params.get('prioridad') ?? ''}
        onChange={(e) => navegar({ prioridad: e.target.value || null })}
      >
        <option value="">Toda prioridad</option>
        {PRIORIDADES.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </Seleccion>

      <label className="flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 text-sm text-texto-suave">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--acento)]"
          checked={params.get('atrasadas') === '1'}
          onChange={(e) => navegar({ atrasadas: e.target.checked ? '1' : null })}
        />
        Solo atrasadas
      </label>

      {hayFiltros && (
        <button
          type="button"
          onClick={() => {
            setBusqueda('')
            iniciarTransicion(() => router.push('/ordenes'))
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

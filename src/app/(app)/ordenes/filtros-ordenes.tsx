'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Loader2, Search, X } from 'lucide-react'

import { Entrada, Seleccion } from '@/components/ui/campos'
import { ESTADO_OT, ORDEN_ESTADO_OT, PRIORIDAD, opciones } from '@/lib/dominio/estados'

const ESTADOS = opciones(ESTADO_OT, ORDEN_ESTADO_OT)
const PRIORIDADES = opciones(PRIORIDAD)

export function FiltrosOrdenes() {
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

  // Lo escrito todavía no está en la URL, o la tabla se está rehaciendo: en
  // ambos casos lo que se ve abajo ya no responde a lo que se acaba de pedir.
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
          placeholder="Buscar por número, cliente, placa o descripción"
          aria-label="Buscar órdenes"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {buscando ? 'Buscando órdenes…' : ''}
      </p>

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

      {/* Alto de dedo en el teléfono y el de siempre en el monitor: la casilla
          y su rótulo son un solo blanco de 44 px, que es lo que ocupa un guante. */}
      <label className="flex h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 text-sm text-texto-suave sm:h-9">
        <input
          type="checkbox"
          className="size-5 accent-[var(--acento)] sm:size-3.5"
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
          className="inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-base)] px-3 text-sm text-texto-suave hover:bg-superficie-2 hover:text-texto sm:h-9"
        >
          <X aria-hidden className="size-3.5" />
          Limpiar
        </button>
      )}
    </div>
  )
}

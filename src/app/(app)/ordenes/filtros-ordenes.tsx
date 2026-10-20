'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Search, X } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Entrada, Seleccion } from '@/components/ui/campos'
import { ESTADO_OT, ORDEN_ESTADO_OT, PRIORIDAD, opciones } from '@/lib/dominio/estados'

const ESTADOS = opciones(ESTADO_OT, ORDEN_ESTADO_OT)
const PRIORIDADES = opciones(PRIORIDAD)

export function FiltrosOrdenes() {
  const router = useRouter()
  const params = useSearchParams()
  const [pendiente, iniciarTransicion] = useTransition()
  const actual = params.get('q') ?? ''
  const [busqueda, setBusqueda] = useState(actual)
  // Si la URL cambia por otro lado (un enlace, el menú), la caja la sigue,
  // como en `BuscadorSimple`; lo que esta misma caja pidió no la toca.
  const [pedido, setPedido] = useState<string | null>(null)
  // Se vigila la URL entera: con solo el término, un «Limpiar» que volvía a la
  // misma URL dejaba un `pedido` viejo y la caja vacía sobre una lista filtrada.
  const consulta = params.toString()
  const [vista, setVista] = useState(consulta)
  if (consulta !== vista) {
    const antes = new URLSearchParams(vista).get('q') ?? ''
    setVista(consulta)
    // El eco de lo pedido se consume: si después «atrás» trae ese mismo valor,
    // ya no es eco y la caja lo sigue. Lo escrito sin pedir todavía se queda
    // si el término de la URL no cambió.
    if (actual !== pedido && (actual !== antes || pedido !== null)) setBusqueda(actual)
    setPedido(null)
  }

  // La búsqueda que espera su pausa. Un filtro tocado en esa pausa la cancela y
  // se lleva lo escrito: si no, la búsqueda salía después con la URL de antes
  // del filtro y lo deshacía.
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // La consulta que va en viaje: lo que se pide después se arma sobre ella, o
  // la búsqueda que salía con un filtro en viaje lo deshacía.
  const enViaje = useRef<string | null>(null)
  useEffect(() => {
    enViaje.current = null
  }, [consulta])

  function navegar(cambios: Record<string, string | null>, reemplazar = false) {
    clearTimeout(espera.current)
    const query = new URLSearchParams(enViaje.current ?? window.location.search)
    if (!('q' in cambios) && busqueda !== actual) {
      if (busqueda) query.set('q', busqueda)
      else query.delete('q')
      setPedido(busqueda)
    }
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) query.set(clave, valor)
      else query.delete(clave)
    }
    // Cualquier cambio de filtro devuelve a la primera página.
    query.delete('pagina')
    enViaje.current = query.toString()
    // Lo que se escribe reemplaza la entrada del historial: con `push`,
    // «atrás» recorría la búsqueda letra por letra.
    iniciarTransicion(() => (reemplazar ? router.replace : router.push)(`/ordenes?${query}`))
  }

  // La búsqueda se envía sola tras una pausa, sin necesidad de pulsar Enter.
  useEffect(() => {
    // Se compara con lo último pedido —también el vacío de «Limpiar»—, o con la
    // URL si no hay nada en viaje: pedir otra vez el vacío reponía la prioridad
    // que «Limpiar» acababa de quitar, y volver al valor de antes con otro en
    // viaje dejaba la caja con un término y la lista con otro.
    if (busqueda === (pedido ?? actual)) return

    espera.current = setTimeout(() => {
      setPedido(busqueda)
      navegar({ q: busqueda || null }, true)
    }, 350)
    return () => clearTimeout(espera.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  const hayFiltros = ['q', 'estado', 'prioridad', 'atrasadas'].some((k) => params.get(k))

  // Lo escrito todavía no está en la URL, o la tabla se está rehaciendo: en
  // ambos casos lo que se ve abajo ya no responde a lo que se acaba de pedir.
  const buscando = pendiente || busqueda !== actual

  return (
    // En el teléfono, una rejilla de dos: el buscador y el estado a todo lo
    // ancho —«Todos excepto anuladas» no entra en media fila— y debajo la
    // prioridad junto a «Solo atrasadas». Con `flex-wrap` cada uno medía lo que
    // su texto y la fila quedaba en dientes de sierra.
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <div className="relative col-span-2 sm:min-w-56 sm:flex-1">
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
          className="pl-9 [&::-webkit-search-cancel-button]:appearance-none"
          placeholder="Número, cliente, placa, código o trabajo"
          aria-label="Buscar órdenes"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {buscando ? 'Buscando órdenes…' : ''}
      </p>

      <Seleccion
        className="col-span-2 min-w-0 sm:w-auto"
        aria-label="Filtrar por estado"
        value={params.get('estado') ?? ''}
        onChange={(e) => navegar({ estado: e.target.value || null })}
      >
        <option value="">Todos excepto anuladas</option>
        <option value="ABIERTAS">En taller (abiertas)</option>
        {ESTADOS.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </Seleccion>

      <Seleccion
        className="min-w-0 sm:w-auto"
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
      <label className="flex h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-base)] border border-borde-fuerte bg-superficie px-3 text-sm text-texto-suave sm:h-9">
        <input
          type="checkbox"
          className="size-5 accent-[var(--acento)] sm:size-3.5"
          checked={params.get('atrasadas') === '1'}
          onChange={(e) => navegar({ atrasadas: e.target.checked ? '1' : null })}
        />
        Solo atrasadas
      </label>

      {hayFiltros && (
        <Boton
          type="button"
          variante="fantasma"
          className="px-3"
          onClick={() => {
            clearTimeout(espera.current)
            setBusqueda('')
            setPedido('')
            enViaje.current = ''
            iniciarTransicion(() => router.push('/ordenes'))
          }}
        >
          <X aria-hidden className="size-3.5" />
          Limpiar
        </Boton>
      )}
    </div>
  )
}

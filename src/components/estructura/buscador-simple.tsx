'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Loader2, Search, X } from 'lucide-react'

import { Entrada } from '@/components/ui/campos'

/**
 * El buscador de toda lista: busca mientras se escribe —sin botón «Buscar»—,
 * escribe el término en la URL tras una breve pausa y conserva los demás
 * filtros puestos. Cómo se busca (sin tildes, por palabras) lo decide
 * `src/lib/dominio/busqueda.ts`.
 */
export function BuscadorSimple({
  ruta,
  etiqueta,
  marcador,
  clave = 'q',
}: {
  ruta: string
  etiqueta: string
  marcador: string
  /** El nombre del término en la URL, cuando la pantalla ya lo tenía con otro (`codigo`, `buscar`). */
  clave?: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pendiente, iniciarTransicion] = useTransition()
  const actual = params.get(clave) ?? ''
  const [busqueda, setBusqueda] = useState(actual)
  // Lo último que este buscador escribió en la URL. Si la URL cambia a otra
  // cosa —«Ver todos los clientes», el menú—, la caja la sigue; si no, quedaba
  // con un término que ya no filtraba y el ícono de «Buscando…» girando.
  const [pedido, setPedido] = useState<string | null>(null)
  // Se vigila la URL entera, no solo el término: si otro enlace la cambia con
  // una búsqueda en viaje, esa búsqueda se perdió, y quedaba la caja con un
  // término que no filtraba y el ícono girando sin fin.
  const consulta = params.toString()
  const [vista, setVista] = useState(consulta)
  if (consulta !== vista) {
    const antes = new URLSearchParams(vista).get(clave) ?? ''
    setVista(consulta)
    // El eco de lo pedido se consume: si después «atrás» trae ese mismo valor,
    // ya no es eco y la caja lo sigue. Lo escrito sin pedir todavía se queda
    // si el término de la URL no cambió.
    if (actual !== pedido && (actual !== antes || pedido !== null)) setBusqueda(actual)
    setPedido(null)
  }

  useEffect(() => {
    // Nada que llevar: la URL ya dice lo escrito.
    if (busqueda === actual) return
    // Lo escrito espera su pausa, o ya va en viaje (`pedido`).
    const enEspera = busqueda !== (pedido ?? actual)

    const disparar = () => {
      // La URL de ahora, no la de cuando se escribió.
      const query = new URLSearchParams(window.location.search)
      if (busqueda) query.set(clave, busqueda)
      else query.delete(clave)
      query.delete('pagina')
      // `replace`, no `push`: cada letra escrita era una entrada en el
      // historial y «atrás» recorría la búsqueda letra por letra.
      setPedido(busqueda)
      iniciarTransicion(() => router.replace(`${ruta}?${query}`))
    }
    const temporizador = enEspera ? setTimeout(disparar, 350) : undefined
    // Una pastilla tocada antes de que lo escrito llegue a la URL se lleva lo
    // escrito, como los filtros de Órdenes. Si no, la búsqueda salía después
    // con la URL de antes de la pastilla —o se perdía en viaje— y la deshacía.
    const alTocar = (e: MouseEvent) => {
      const enlace = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[data-filtro]') : null
      if (!enlace || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      const destino = new URL(enlace.href)
      if (destino.pathname !== window.location.pathname) return
      e.preventDefault()
      clearTimeout(temporizador)
      if (busqueda) destino.searchParams.set(clave, busqueda)
      else destino.searchParams.delete(clave)
      setPedido(busqueda)
      iniciarTransicion(() => router.push(`${destino.pathname}${destino.search}`))
    }
    document.addEventListener('click', alTocar, true)

    return () => {
      clearTimeout(temporizador)
      document.removeEventListener('click', alTocar, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, consulta, pedido])

  // Lo escrito todavía no está en la URL, o la pantalla se está rehaciendo: en
  // ambos casos lo que se ve abajo ya no corresponde a lo que se pidió.
  const buscando = pendiente || busqueda !== actual

  return (
    // A todo lo ancho de un monitor la caja medía más de mil píxeles para diez
    // letras: se corta donde se lee el término de un vistazo.
    <div className="flex w-full max-w-xl items-center gap-2">
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
          className="pl-9 [&::-webkit-search-cancel-button]:appearance-none"
          placeholder={marcador}
          aria-label={etiqueta}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {buscando ? 'Buscando…' : ''}
      </p>

      {actual && (
        <button
          type="button"
          onClick={() => {
            setBusqueda('')
            setPedido('')
            // Quita solo el término: los filtros puestos se quedan.
            const query = new URLSearchParams(params.toString())
            query.delete(clave)
            query.delete('pagina')
            const resto = query.toString()
            iniciarTransicion(() => router.replace(resto ? `${ruta}?${resto}` : ruta))
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

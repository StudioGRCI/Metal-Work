'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Search, X } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
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

  // La consulta que va en viaje y todavía no llegó a la URL. Lo que se pide
  // después se arma sobre ella: armado sobre la URL de antes, la búsqueda que
  // salía con una pastilla en viaje la deshacía.
  const enViaje = useRef<string | null>(null)
  const base = () => new URLSearchParams(enViaje.current ?? window.location.search)
  function ir(query: URLSearchParams, reemplazar: boolean) {
    query.delete('pagina')
    const resto = query.toString()
    enViaje.current = resto
    const destino = resto ? `${ruta}?${resto}` : ruta
    iniciarTransicion(() => (reemplazar ? router.replace : router.push)(destino))
  }
  // Llegó una URL: lo que iba en viaje ya está en ella, o lo reemplazó otra.
  useEffect(() => {
    enViaje.current = null
  }, [consulta])

  useEffect(() => {
    // Lo escrito espera su pausa; si ya va en viaje (`pedido`) o la URL ya lo
    // dice, no hay nada que esperar.
    const enEspera = busqueda !== actual && busqueda !== (pedido ?? actual)

    const disparar = () => {
      const query = base()
      if (busqueda) query.set(clave, busqueda)
      else query.delete(clave)
      // `replace`, no `push`: cada letra escrita era una entrada en el
      // historial y «atrás» recorría la búsqueda letra por letra.
      setPedido(busqueda)
      ir(query, true)
    }
    const temporizador = enEspera ? setTimeout(disparar, 350) : undefined
    // Una pastilla se lleva lo escrito, como los filtros de Órdenes, y deja
    // anotado su destino para lo que se escriba mientras viaja. Si no, la
    // búsqueda salía con la URL de antes de la pastilla y la deshacía.
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
      ir(destino.searchParams, false)
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
        <Boton
          type="button"
          variante="fantasma"
          className="px-3"
          onClick={() => {
            setBusqueda('')
            setPedido('')
            // Quita solo el término: los filtros puestos —también uno en
            // viaje— se quedan.
            const query = base()
            query.delete(clave)
            ir(query, true)
          }}
        >
          <X aria-hidden className="size-3.5" />
          Limpiar
        </Boton>
      )}
    </div>
  )
}

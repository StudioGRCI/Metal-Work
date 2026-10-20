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
/** Una navegación que salió de aquí: la URL que pidió y el término que llevaba. */
type Pedido = { consulta: string; termino: string }

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
  // Lo que este buscador pidió y todavía no volvió en la URL, en orden. Si la
  // URL cambia a otra cosa —«Ver todos los clientes», el menú—, la caja la
  // sigue; si no, quedaba con un término que ya no filtraba y el ícono de
  // «Buscando…» girando.
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  // Se vigila la URL entera, no solo el término: si otro enlace la cambia con
  // una búsqueda en viaje, esa búsqueda se perdió, y quedaba la caja con un
  // término que no filtraba y el ícono girando sin fin.
  const consulta = params.toString()
  const [vista, setVista] = useState(consulta)
  if (consulta !== vista) {
    const antes = new URLSearchParams(vista).get(clave) ?? ''
    setVista(consulta)
    // Las respuestas llegan en el orden en que salieron: si la que llegó es una
    // de las pedidas, se consumen ella y las anteriores, y la caja no se toca,
    // porque lo escrito después ya va en viaje. Con un solo pedido anotado, la
    // respuesta vieja que llegaba con otra en viaje copiaba a la caja el término
    // de antes y se comía lo escrito entretanto: en producción, escribiendo
    // despacio, «carroceria» quedaba «caroei» (2026-10-20). Se reconoce por la
    // URL entera y no por el término: un enlace que deja el mismo término con
    // otros filtros («Ver todos») no es eco, y la caja lo sigue.
    const eco = pedidos.findIndex((p) => p.consulta === consulta)
    if (eco >= 0) setPedidos(pedidos.slice(eco + 1))
    else {
      // Lo escrito sin pedir todavía se queda si el término de la URL no cambió.
      if (actual !== antes || pedidos.length > 0) setBusqueda(actual)
      setPedidos([])
    }
  }
  // Ya no queda nada en viaje y algo de lo pedido nunca volvió: otra navegación
  // —el menú, «atrás»— lo reemplazó. Tomarlo por eco dejaba la caja con un
  // término que no filtraba y el ícono girando sin fin. Si después de lo
  // perdido no se escribió nada, la caja sigue a la URL; si se escribió, se
  // queda y sale en su pausa.
  if (!pendiente && pedidos.length > 0) {
    setPedidos([])
    if (busqueda === pedidos[pedidos.length - 1].termino) setBusqueda(actual)
  }
  const ultimoPedido = pedidos.length > 0 ? pedidos[pedidos.length - 1].termino : null

  // La consulta que va en viaje y todavía no llegó a la URL. Lo que se pide
  // después se arma sobre ella: armado sobre la URL de antes, la búsqueda que
  // salía con una pastilla en viaje la deshacía.
  const enViaje = useRef<string | null>(null)
  const base = () => new URLSearchParams(enViaje.current ?? window.location.search)
  function ir(query: URLSearchParams, reemplazar: boolean, termino: string) {
    query.delete('pagina')
    const resto = query.toString()
    enViaje.current = resto
    setPedidos((anteriores) => [...anteriores, { consulta: resto, termino }])
    const destino = resto ? `${ruta}?${resto}` : ruta
    iniciarTransicion(() => (reemplazar ? router.replace : router.push)(destino))
  }
  // Se olvida cuando ya volvió todo lo pedido, o se perdió. No con cualquier
  // URL que llegue: el eco de una búsqueda vieja la borraba con una pastilla
  // todavía en viaje, y lo siguiente salía sin ella.
  const sinPedidos = pedidos.length === 0
  useEffect(() => {
    if (sinPedidos) enViaje.current = null
  }, [consulta, sinPedidos])

  useEffect(() => {
    // Lo escrito espera su pausa; si ya va en viaje o la URL ya lo dice, no hay
    // nada que esperar.
    const enEspera = busqueda !== actual && busqueda !== (ultimoPedido ?? actual)

    const disparar = () => {
      const query = base()
      if (busqueda) query.set(clave, busqueda)
      else query.delete(clave)
      // `replace`, no `push`: cada letra escrita era una entrada en el
      // historial y «atrás» recorría la búsqueda letra por letra.
      ir(query, true, busqueda)
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
      ir(destino.searchParams, false, busqueda)
    }
    document.addEventListener('click', alTocar, true)

    return () => {
      clearTimeout(temporizador)
      document.removeEventListener('click', alTocar, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, consulta, ultimoPedido])

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
            // Quita solo el término: los filtros puestos —también uno en
            // viaje— se quedan.
            const query = base()
            query.delete(clave)
            ir(query, true, '')
          }}
        >
          <X aria-hidden className="size-3.5" />
          Limpiar
        </Boton>
      )}
    </div>
  )
}

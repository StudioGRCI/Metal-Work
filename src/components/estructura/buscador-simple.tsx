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
  const [vista, setVista] = useState(actual)
  if (actual !== vista) {
    setVista(actual)
    // El eco de lo pedido se consume: si después «atrás» trae ese mismo valor,
    // ya no es eco y la caja lo sigue.
    if (actual !== pedido) setBusqueda(actual)
    setPedido(null)
  }

  const consulta = params.toString()
  useEffect(() => {
    if (busqueda === (pedido ?? actual)) return

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
    let temporizador = setTimeout(disparar, 350)
    // Un enlace tocado en la pausa —una pastilla— manda: la búsqueda espera a
    // que su URL llegue, que vuelve a correr este efecto, y sale sobre ella.
    // Si salía antes, con la URL de antes del enlace, lo deshacía. El plazo
    // largo cubre un enlace que no cambia la URL.
    const alTocar = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('a[href]')) return
      clearTimeout(temporizador)
      temporizador = setTimeout(disparar, 3000)
    }
    document.addEventListener('click', alTocar, true)

    return () => {
      clearTimeout(temporizador)
      document.removeEventListener('click', alTocar, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, consulta])

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

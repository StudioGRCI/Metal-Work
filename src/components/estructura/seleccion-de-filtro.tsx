'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState, useTransition } from 'react'

import { Seleccion } from '@/components/ui/campos'
import { cn } from '@/lib/utils'

/** Una opción del filtro ya resuelta a su enlace: la arma `PastillaFiltro` en el servidor. */
export type OpcionResuelta = { etiqueta: string; href: string; activa: boolean }

/**
 * El mismo filtro que las pastillas, en una lista desplegable para el teléfono:
 * nueve pastillas en cuatro filas dejaban el primer resultado a media pantalla
 * (Cotización, Adquisiciones, el kardex; auditoría del 27/10/2026). Elegir una
 * navega al enlace que la pastilla llevaba, así que conserva lo demás de la URL.
 *
 * Con el teclado, las flechas solo mueven la elección: se navega con Enter o al
 * salir de la lista, para no cargar una página por cada opción que se pasa.
 * Mientras carga, la lista lo dice (`aria-busy`) y gira el aviso de carga.
 */
export function SeleccionDeFiltro({ etiqueta, opciones, className }: { etiqueta: string; opciones: OpcionResuelta[]; className?: string }) {
  const router = useRouter()
  const id = useId()
  const [pendiente, iniciar] = useTransition()
  const activa = opciones.find((o) => o.activa) ?? opciones[0]
  const [elegido, setElegido] = useState(activa?.href ?? '')
  const [vigente, setVigente] = useState(activa?.href ?? '')
  const conTeclado = useRef(false)

  // Si la página cambió el filtro por otro lado (una pastilla, atrás), la lista lo sigue.
  if ((activa?.href ?? '') !== vigente) {
    setVigente(activa?.href ?? '')
    setElegido(activa?.href ?? '')
  }

  const ir = (href: string) => {
    conTeclado.current = false
    if (!href || href === activa?.href) return
    iniciar(() => router.push(href))
  }

  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="block text-xs font-medium text-texto-suave">
        {etiqueta}
      </label>
      <div className="relative">
        <Seleccion
          id={id}
          value={elegido}
          aria-busy={pendiente}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ir(elegido)
            } else if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.length === 1) {
              conTeclado.current = true
            }
          }}
          onBlur={() => {
            if (conTeclado.current) ir(elegido)
          }}
          onChange={(e) => {
            setElegido(e.target.value)
            // Con el dedo o el ratón la elección es una sola: se navega ya.
            if (!conTeclado.current) ir(e.target.value)
          }}
          className={cn(pendiente && 'pr-16')}
        >
          {opciones.map((o) => (
            <option key={o.href} value={o.href}>
              {o.etiqueta}
            </option>
          ))}
        </Seleccion>
        {pendiente && (
          <Loader2
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-9 size-4 -translate-y-1/2 animate-spin text-acento motion-reduce:animate-none"
          />
        )}
      </div>
    </div>
  )
}

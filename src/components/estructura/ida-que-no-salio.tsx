'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { Boton } from '@/components/ui/boton'
import { ponerIdaQueNoSalio, useIdaQueNoSalio } from '@/lib/envio'

/**
 * Lo que entró y no llevó a su pantalla porque la persona ya estaba en otra
 * cosa (`navegarSiEsDeLaPestana`): arriba, con su enlace. La ida se llevaba la
 * ventana que la persona estaba llenando, o el menú que había pedido (W1 de la
 * crítica de la trigesimoctava pasada). Dice lo que pasó y no cómo está ahora:
 * eso lo dice su pantalla.
 *
 * Se va al seguir el enlace, al llegar a esa pantalla por otro camino, al
 * quitarlo o con la ida siguiente que no salga. No se guarda en la pestaña: una
 * recarga lo olvida. La región está siempre montada: una que nace con su texto
 * el lector no la lee.
 */
export function IdaQueNoSalio() {
  const ida = useIdaQueNoSalio()
  const ruta = usePathname()

  useEffect(() => {
    if (!ida) return
    const destino = new URL(ida.url, window.location.href)
    if (destino.pathname === window.location.pathname && destino.search === window.location.search) ponerIdaQueNoSalio(null)
  }, [ida, ruta])

  return (
    <div
      role="status"
      className={ida ? 'flex items-center gap-3 border-b border-borde bg-exito-suave px-4 py-1.5 print:hidden' : 'sr-only'}
      data-ida-que-no-salio={ida ? '' : undefined}
    >
      {ida && (
        <>
          <p className="min-w-0 flex-1 text-xs text-texto text-pretty">
            <span className="font-medium">{ida.dice}</span>{' '}
            <Link href={ida.url} className="font-medium text-acento underline" onClick={() => ponerIdaQueNoSalio(null)}>
              {ida.enlace}
            </Link>
          </p>
          <Boton type="button" variante="fantasma" tamano="icono" aria-label="Quitar este aviso" onClick={() => ponerIdaQueNoSalio(null)}>
            <X aria-hidden className="size-4" />
          </Boton>
        </>
      )}
    </div>
  )
}

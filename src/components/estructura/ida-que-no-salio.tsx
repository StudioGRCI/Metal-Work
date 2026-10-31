'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { Boton } from '@/components/ui/boton'
import { type IdaQueNoSalio as Ida, ponerIdaQueNoSalio, useIdaQueNoSalio } from '@/lib/envio'

// Lo que la ida le pone a su dirección solo para esa vez («?creada=1»,
// «?contrato=pendiente») o para elegir pestaña o filtrar («vista», «q»): llegar
// a la pantalla sin eso también es llegar. La orden abierta desde la lista no
// lleva «?creada=1», y la línea la seguía (H2 de diseño, H1 de funcionalidad y A
// de realización de la trigesimonovena pasada). «estado» sí cuenta: Activos no
// es Bajas.
const DE_UNA_VEZ = new Set(['creada', 'subido', 'abierta', 'contrato', 'vista', 'q'])

/** La persona está en la pantalla a la que lleva `url`, haya llegado como haya llegado. */
function yaEstaEn(url: string, ruta: string, busqueda: URLSearchParams) {
  const destino = new URL(url, 'http://pantalla')
  if (destino.pathname !== ruta) return false
  for (const [clave, valor] of destino.searchParams) if (!DE_UNA_VEZ.has(clave) && busqueda.get(clave) !== valor) return false
  return true
}

/** Una dirección escrita como la dan `usePathname` y `useSearchParams`, para compararla. */
function comoDireccion(direccion: string) {
  const u = new URL(direccion, 'http://pantalla')
  return `${u.pathname}?${u.searchParams}`
}

/**
 * Lo que entró y no llevó a su pantalla porque la persona ya estaba en otra
 * cosa (`navegarSiEsDeLaPestana`): arriba, con su enlace. La ida se llevaba la
 * ventana que la persona estaba llenando, o el menú que había pedido (W1 de la
 * crítica de la trigesimoctava pasada). Dice lo que pasó y no cómo está ahora:
 * eso lo dice su pantalla.
 *
 * Se va al seguir el enlace, al llegar a esa pantalla por otro camino, al
 * quitarlo, con la ida siguiente que salga o con la siguiente que no salga. No
 * se guarda en la pestaña: una recarga lo olvida. Calla mientras la persona siga
 * en el formulario que ya lo dice junto a su botón (`YaQuedo`). La región está
 * siempre montada: una que nace con su texto el lector no la lee.
 */
export function IdaQueNoSalio() {
  const ida = useIdaQueNoSalio()
  // La dirección es la de Next, no la de `window.location`: al pintar la
  // pantalla nueva el navegador todavía dice la de antes, y la línea seguía
  // callada en la lista como si la persona siguiera en el formulario.
  const ruta = usePathname()
  const busqueda = useSearchParams()
  const aqui = `${ruta}?${busqueda}`

  // Ya en su pantalla calla desde la primera pintada: si esperara al efecto que
  // la quita, la línea asomaba un instante en la pantalla a la que lleva.
  const llego = ida ? yaEstaEn(ida.url, ruta, busqueda) : false
  useEffect(() => {
    if (llego) ponerIdaQueNoSalio(null)
  }, [llego])

  const visible = ida && !llego && (!ida.dichaEn || comoDireccion(ida.dichaEn) !== aqui) ? ida : null
  return (
    <div
      role="status"
      className={visible ? 'flex items-center gap-3 border-b border-borde bg-exito-suave px-4 py-1.5 print:hidden' : 'sr-only'}
      data-ida-que-no-salio={visible ? '' : undefined}
    >
      {visible && (
        <>
          <p className="min-w-0 flex-1 text-xs text-texto text-pretty">
            <span className="font-medium">{visible.dice}</span>{' '}
            <Link href={visible.url} className="font-medium text-acento underline" onClick={() => ponerIdaQueNoSalio(null)}>
              {visible.enlace}
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

/**
 * Lo mismo junto al botón de un formulario de página entera (la orden, el
 * trabajo, el cliente, el reporte): lo enviado ya entró, el formulario se traba y
 * esto dice adónde quedó, salga la ida o no. Si no salía —al entrar había otra
 * ventana abierta, como «Más» en el teléfono—, la persona volvía al formulario
 * lleno y con el botón vivo, y un segundo toque registraba otro trabajo igual
 * (X1 de la crítica de la trigesimonovena pasada). Siempre montada, como la de
 * arriba.
 */
export function YaQuedo({ ida }: { ida: Omit<Ida, 'dichaEn'> | null }) {
  return (
    <p
      role="status"
      className={ida ? 'rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-texto text-pretty' : 'sr-only'}
      data-ya-quedo={ida ? '' : undefined}
    >
      {ida && (
        <>
          <span className="font-medium">{ida.dice}</span>{' '}
          <Link href={ida.url} className="font-medium text-acento underline">
            {ida.enlace}
          </Link>
        </>
      )}
    </p>
  )
}

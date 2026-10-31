'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useReducer, useRef } from 'react'

import { Boton } from '@/components/ui/boton'
import { type IdaQueNoSalio as Ida, ponerIdaQueNoSalio, sigueMontado, useIdaQueNoSalio } from '@/lib/envio'

// Lo que la ida le pone a su dirección solo para esa vez («?creada=1»,
// «?contrato=pendiente») o para elegir pestaña o filtrar («vista», «q»): llegar
// a la pantalla sin eso también es llegar. La orden abierta desde la lista no
// lleva «?creada=1», y la línea la seguía (H2 de diseño, H1 de funcionalidad y A
// de realización de la trigesimonovena pasada). «estado» sí cuenta: Activos no
// es Bajas.
const DE_UNA_VEZ = new Set(['creada', 'subido', 'abierta', 'contrato', 'vista', 'q'])

/**
 * La persona está en la pantalla a la que lleva la ida, haya llegado como haya
 * llegado. Lo que la pantalla toma cuando la dirección no lo dice (`porOmision`)
 * cuenta igual: la vuelta a Activos no se iba al llegar a /personal desde el
 * menú (H4 de funcionalidad, cuadragésima pasada).
 */
function yaEstaEn({ url, porOmision }: Ida, ruta: string, busqueda: URLSearchParams) {
  const destino = new URL(url, 'http://pantalla')
  if (destino.pathname !== ruta) return false
  for (const [clave, valor] of destino.searchParams) {
    if (!DE_UNA_VEZ.has(clave) && (busqueda.get(clave) ?? porOmision?.[clave]) !== valor) return false
  }
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
 * quitarlo o con la ida siguiente a otro documento: la que sale se lo lleva y
 * la que no sale pone lo suyo. La de un aviso no lo toca. No se guarda en la
 * pestaña: una recarga lo olvida. Calla mientras la persona siga
 * en el formulario que ya lo dice junto a su botón (`YaQuedo`). La región está
 * siempre montada: una que nace con su texto el lector no la lee.
 *
 * También dice, en rojo, el rechazo que volvió cuando la persona ya se había
 * ido del formulario (`decirElRechazoSiSeFue`), con el camino de vuelta; en
 * ámbar, lo que quedó a medias, y en azul, lo que ya había quedado la primera
 * vez. Si la dirección cambió y el formulario que la puso sigue en la pantalla
 * (otra pestaña de la lista que lo pinta encima), lo dice él y la línea se va.
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
  // la quita, la línea asomaba un instante en la pantalla a la que lleva. El
  // rechazo no se va al volver al formulario: nace estando ahí, con la ida en
  // cola, y en el formulario vacío su motivo es lo único que dice qué corregir.
  // Se va al enviar otra vez (`mientrasSeEnvia`) o al quitarlo.
  // El rechazo es de su formulario, en su dirección exacta: en la OT, «vista»
  // elige la pestaña, y en la de Taller el formulario del gasto no está.
  const ahi = ida ? (ida.rechazo ? comoDireccion(ida.url) === aqui : yaEstaEn(ida, ruta, busqueda)) : false
  const llego = ahi && !ida?.rechazo
  // El formulario que la puso sigue en la pantalla, en otra dirección: lo dice
  // él, y la línea calla. Al pintar la pantalla nueva, la que se va todavía
  // está en el registro: aquí solo calla, y el efecto, que corre cuando React
  // ya la desmontó, la quita o la vuelve a pintar. Quitarla al pintar se
  // llevaba el rechazo que llegó antes que la pantalla pedida (el plano, con
  // su subida retenida, y la tarea del informe al Dashboard). La dirección es
  // la del formulario, no la del enlace: lo que ya había quedado lleva al
  // reporte, y con la ida todavía en cola, en el formulario, se quitaba.
  const pareceSuya = Boolean(ida?.de && !ahi && comoDireccion(ida.desde ?? ida.url) !== aqui && sigueMontado(ida.de))
  // Con la pantalla pedida todavía en camino, el rechazo nace en la dirección
  // de su formulario, que sigue montado y lo dice junto a su botón: arriba se
  // asomaba hasta que llegaba la otra, y el lector lo decía dos veces (H1 de la
  // crítica, cuadragésima cuarta pasada). Solo calla: al llegar la pantalla
  // pedida, si el formulario se fue con la vieja, la línea lo dice.
  const loDiceEl = Boolean(ida?.rechazo && ahi && sigueMontado(ida.de))
  const [, repintar] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (llego) return ponerIdaQueNoSalio(null)
    if (!pareceSuya) return
    if (sigueMontado(ida?.de)) ponerIdaQueNoSalio(null)
    else repintar()
  }, [llego, pareceSuya, ida])

  const visible = ida && !llego && !pareceSuya && !loDiceEl && (!ida.dichaEn || comoDireccion(ida.dichaEn) !== aqui) ? ida : null

  // La línea nace en el flujo, debajo de la barra pegada de arriba. Si la
  // página estaba bajada unos pocos píxeles, el navegador la baja lo que mide
  // la línea para no mover lo que se leía, y Next no sube porque el principio
  // de la pantalla nueva se ve: quedaba entera debajo de la barra (A de diseño
  // y R6 de realización, cuadragésima segunda y tercera pasadas). Hasta que se
  // vea una vez, se sube lo justo; si la persona bajó más que eso, no se la
  // mueve. Cada línea nueva cuenta, aunque diga lo mismo: el segundo rechazo
  // del mismo PDF, el del reintento que la línea pide, quedaba debajo de la
  // barra (V1 de la crítica, cuadragésima cuarta pasada).
  const region = useRef<HTMLDivElement>(null)
  const vista = useRef<Ida | null>(null)
  useEffect(() => {
    if (!visible || vista.current === visible) return
    const cuadro = requestAnimationFrame(() => {
      const linea = region.current?.getBoundingClientRect()
      if (!linea) return
      const barra = document.querySelector('[data-barra-superior]')?.getBoundingClientRect().bottom ?? 0
      if (linea.top >= barra) {
        vista.current = visible
        return
      }
      if (window.scrollY > linea.height + 80) return
      vista.current = visible
      window.scrollTo({ top: Math.max(0, window.scrollY - (barra - linea.top)) })
    })
    return () => cancelAnimationFrame(cuadro)
  }, [visible, aqui])

  const fondo = !visible ? '' : visible.tono === 'aviso' ? 'bg-aviso-suave' : visible.tono === 'info' ? 'bg-info-suave' : visible.rechazo ? 'bg-peligro-suave' : 'bg-exito-suave'
  return (
    <div
      ref={region}
      role="status"
      className={visible ? `flex items-center gap-3 border-b border-borde px-4 py-1.5 print:hidden ${fondo}` : 'sr-only'}
      data-ida-que-no-salio={visible ? (visible.tono === 'aviso' ? 'a-medias' : visible.rechazo ? 'rechazo' : visible.tono === 'info' ? 'ya-habia-quedado' : '') : undefined}
    >
      {visible && (
        <>
          <p className="min-w-0 flex-1 text-xs text-texto text-pretty">
            <span className={visible.rechazo && !visible.tono ? 'font-medium text-peligro' : 'font-medium'}>{visible.dice}</span>{' '}
            {!ahi && (
              <Link
                href={visible.url}
                className="font-medium text-acento underline"
                onClick={() => {
                  if (!visible.rechazo) ponerIdaQueNoSalio(null)
                }}
              >
                {visible.enlace}
              </Link>
            )}
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

import Link from 'next/link'

import { SeleccionDeFiltro } from '@/components/estructura/seleccion-de-filtro'
import { cn } from '@/lib/utils'

type Params = Record<string, string | string[] | undefined>

/** Una pastilla del grupo. */
export type OpcionFiltro = {
  /**
   * Lo que se escribe en la URL. `null` es la pastilla «Todas»: no enciende
   * nada, apaga el filtro.
   */
  valor: string | null
  etiqueta: string
  /**
   * Solo para el grupo que mezcla dos claves —«Sin confirmar» de movimientos
   * enciende `estado` mientras sus vecinas encienden `tipo`—. Sin esto, esa
   * pantalla tendría que volver a armar el enlace a mano y perdería otra vez
   * lo escrito en el buscador.
   */
  clave?: string
}

type Comun = {
  opciones: OpcionFiltro[]
  /** El valor puesto ahora. Vacío o ausente equivale a la opción «Todas». */
  activo?: string | null
  /** Para qué filtra este grupo; lo lee el lector de pantalla. */
  etiqueta?: string
  className?: string
}

/** Lo normal: cada pastilla es un enlace que cambia la URL de la pantalla. */
type ConEnlaces = Comun & {
  ruta: string
  clave: string
  /** Los `searchParams` ya resueltos de la página: sin ellos no hay qué conservar. */
  params: Params
  alPulsar?: never
}

/** El caso raro: la pastilla no navega, avisa (`informes/rango-de-fechas.tsx`). */
type ConBotones = Comun & {
  alPulsar: (valor: string | null) => void
  ruta?: never
  clave?: never
  params?: never
}

export type PropsPastillaFiltro = ConEnlaces | ConBotones

// Alto táctil en el teléfono —44 px se marcan con el guante puesto— y el de
// siempre en el monitor. `min-height` le gana a `height`, así que en `sm:` hay
// que soltarlo o el escritorio se quedaría con la altura del teléfono.
// Las que no están puestas llevan su caja, con el contorno de 3:1 que
// `globals.css` pide para todo control: sin ella, en el teléfono «Validados» se
// leía como texto suelto y no como algo que se toca.
export const PASTILLA =
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-base)] border px-3 text-sm whitespace-nowrap transition-colors sm:h-8 sm:min-h-0'

// El relleno sólido y el subrayado distinguen la selección incluso sin color.
export const ACTIVA = 'border-acento bg-acento font-semibold text-acento-texto underline underline-offset-4'
export const INACTIVA = 'border-borde-fuerte bg-superficie text-texto-suave hover:bg-superficie-2 hover:text-texto'

// El grupo parte línea también en el teléfono: deslizado de costado dejaba
// filtros fuera de la vista —en /codigos-internos se veían dos de cinco— y
// dentro de una fila flex ensanchaba la página entera (/subcontratos medía
// 438 px en 390). `min-w-0` para que un padre flex nunca lo estire.
export const GRUPO_PASTILLAS = 'flex min-w-0 flex-wrap gap-2 sm:gap-1'

// Desde cuántas pastillas el teléfono las cambia por una lista desplegable:
// nueve en cuatro filas dejaban el primer resultado a media pantalla.
const PASTILLAS_PARA_LISTA = 5

/** Vacío, `null` y ausente son la misma cosa: no hay filtro puesto. */
function mismo(a: string | null | undefined, b: string | null | undefined) {
  return (a || null) === (b || null)
}

/**
 * Grupo de pastillas para filtrar una lista.
 *
 * Es componente de servidor —no lleva `'use client'`— pero al no importar nada
 * de servidor también sirve dentro de un componente de cliente, que es como lo
 * usa la variante de botón.
 */
export function PastillaFiltro(props: PropsPastillaFiltro) {
  const { opciones, activo, etiqueta = 'Filtros', className } = props

  if (opciones.length === 0) return null

  // Las claves que manda este grupo: la suya y las que traiga alguna opción
  // suelta. Al pulsar una se apagan todas y se enciende la pulsada; si no, dos
  // pastillas del mismo grupo quedarían encendidas a la vez.
  const claves = new Set<string>(props.clave ? [props.clave] : [])
  for (const opcion of opciones) if (opcion.clave) claves.add(opcion.clave)

  // Con muchas opciones, en el teléfono una lista desplegable con los mismos enlaces.
  const muchas = !props.alPulsar && opciones.length >= PASTILLAS_PARA_LISTA
  const lista = muchas ? (
    <SeleccionDeFiltro
      etiqueta={etiqueta}
      className={cn('sm:hidden', className)}
      opciones={opciones.map((opcion) => ({
        etiqueta: opcion.etiqueta,
        href: enlace(props.ruta as string, props.params as Params, claves, opcion, props.clave),
        activa: mismo(activo, opcion.valor),
      }))}
    />
  ) : null

  return (
    <>
    {lista}
    <div role="group" aria-label={etiqueta} className={cn(GRUPO_PASTILLAS, muchas && 'hidden sm:flex', className)}>
      {opciones.map((opcion) => {
        const activa = mismo(activo, opcion.valor)
        const clases = cn(PASTILLA, activa ? ACTIVA : INACTIVA)
        const llave = `${opcion.clave ?? ''}:${opcion.valor ?? ''}`

        if (props.alPulsar) {
          const pulsar = props.alPulsar
          return (
            <button
              key={llave}
              type="button"
              onClick={() => pulsar(opcion.valor)}
              aria-pressed={activa}
              className={clases}
            >
              {opcion.etiqueta}
            </button>
          )
        }

        return (
          <Link
            key={llave}
            href={enlace(props.ruta, props.params, claves, opcion, props.clave)}
            aria-current={activa ? 'page' : undefined}
            // `BuscadorSimple` reconoce el filtro por esta marca y le suma lo
            // que se está escribiendo, que todavía no llegó a la URL.
            data-filtro=""
            className={clases}
          >
            {opcion.etiqueta}
          </Link>
        )
      })}
    </div>
    </>
  )
}

/**
 * Arma el enlace de una pastilla conservando lo demás de la URL —la búsqueda
 * escrita, sobre todo: armarlo desde cero la borraba— y tirando siempre
 * `pagina`, porque volver a filtrar empieza por la primera. Es la misma regla
 * que ya seguían `filtros-ordenes.tsx` y `paginacion.tsx`.
 */
function enlace(
  ruta: string,
  params: Params,
  claves: Set<string>,
  opcion: OpcionFiltro,
  clave: string,
) {
  const query = new URLSearchParams()

  for (const [nombre, valor] of Object.entries(params)) {
    if (nombre === 'pagina' || claves.has(nombre)) continue
    if (typeof valor === 'string') {
      if (valor) query.set(nombre, valor)
    } else if (Array.isArray(valor)) {
      for (const uno of valor) if (uno) query.append(nombre, uno)
    }
  }

  if (opcion.valor) query.set(opcion.clave ?? clave, opcion.valor)

  const cadena = query.toString()
  return cadena ? `${ruta}?${cadena}` : ruta
}

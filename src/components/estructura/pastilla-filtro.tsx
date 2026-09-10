import Link from 'next/link'

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
const PASTILLA =
  'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-base)] px-3 text-sm whitespace-nowrap transition-colors sm:h-8 sm:min-h-0'

// Sin borde: la que está puesta se reconoce por el fondo, no por el contorno.
const ACTIVA = 'bg-acento-suave font-medium text-acento'
const INACTIVA = 'text-texto-suave hover:bg-superficie-2 hover:text-texto'

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

  return (
    <div
      role="group"
      aria-label={etiqueta}
      className={cn('flex flex-wrap gap-2 sm:gap-1', className)}
    >
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
            className={clases}
          >
            {opcion.etiqueta}
          </Link>
        )
      })}
    </div>
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

'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { cookieDelMenu, menuDe, rutaActiva, pendientesEnPalabras, type GrupoNavegacion } from '@/lib/navegacion'
import { cn } from '@/lib/utils'

/**
 * Cómo dejó cada persona los grupos del menú: comodidad de quien mira, no un
 * dato del sistema. Va en una cookie por puesto y no en `localStorage` porque
 * el servidor la lee (`app/(app)/layout.tsx`) y pinta el menú ya plegado: con
 * `localStorage` el servidor lo pintaba abierto y al hidratar se cerraba, un
 * salto en cada carga (auditoría de diseño de la entrega 2). Si el navegador
 * no deja guardar, el menú sale como lo fija su puesto.
 */
const EVENTO = 'mw:menu-plegado'

function leer(rol: string) {
  try {
    const par = document.cookie.split('; ').find((c) => c.startsWith(`${cookieDelMenu(rol)}=`))
    return par ? decodeURIComponent(par.slice(par.indexOf('=') + 1)) : '{}'
  } catch {
    return '{}'
  }
}

function guardar(rol: string, titulo: string, abierto: boolean) {
  let estado: Record<string, boolean> = {}
  try {
    const previo: unknown = JSON.parse(leer(rol))
    if (previo && typeof previo === 'object' && !Array.isArray(previo)) estado = previo as Record<string, boolean>
  } catch {
    // Una cookie dañada se reemplaza por una nueva.
  }
  estado[titulo] = abierto
  try {
    document.cookie = `${cookieDelMenu(rol)}=${encodeURIComponent(JSON.stringify(estado))}; path=/; max-age=31536000; samesite=lax`
  } catch {
    // Sin cookies tampoco hay sesión: el menú queda como lo fija el puesto.
  }
  window.dispatchEvent(new Event(EVENTO))
}

function suscribir(avisar: () => void) {
  window.addEventListener(EVENTO, avisar)
  return () => window.removeEventListener(EVENTO, avisar)
}

/**
 * El menú de módulos, uno solo para las dos formas en que se muestra: la barra
 * fija del monitor y el cajón «Más» del teléfono.
 *
 * Desde la entrega 2 del plan de orden y diseño (2026-11-25) es compacto en el
 * monitor y sus grupos se pliegan: a 900 px de alto el de Administración (17
 * entradas) dejaba sus cuatro últimas bajo el borde, y con una OT abierta
 * sumaba seis más. Las secciones de la OT ya no cuelgan de aquí: van arriba del
 * documento, como las del código interno (`SeccionesDelDocumento`). En el
 * teléfono cada fila sigue midiendo 44 px, que es lo que pide el dedo.
 */
export function NavegacionLista({
  permisos,
  esAdmin,
  rolCodigo,
  alNavegar,
  compacto = false,
  pendientes = {},
  sinComprobar = [],
  plegado = '{}',
}: {
  permisos: string[]
  esAdmin: boolean
  rolCodigo: string
  /** El cajón del teléfono se cierra al elegir; la barra del monitor no hace nada. */
  alNavegar?: () => void
  /** Filas de 32 px, para la barra del monitor con ratón; con el dedo (tablet), el cajón y la pantalla táctil, 44. */
  compacto?: boolean
  /** Cuántos pendientes cuelgan de cada módulo, por su ruta: el número al lado del nombre. */
  pendientes?: Record<string, number>
  /** Rutas con un pendiente que no se pudo contar: el globo dice «!», nunca cero. */
  sinComprobar?: string[]
  /** La cookie del menú tal como llegó al servidor: el menú sale plegado desde el primer cuadro. */
  plegado?: string
}) {
  const ruta = usePathname()
  const prefijo = useId()

  // El menú de su puesto, el mismo que arma la barra de abajo del teléfono.
  const grupos = menuDe(permisos, esAdmin, rolCodigo)

  // El mismo criterio que la barra de abajo del teléfono: los dos marcan igual.
  const activa = rutaActiva(
    ruta,
    grupos.flatMap((g) => g.items).map((i) => i.ruta),
  )

  const crudo = useSyncExternalStore(suscribir, () => leer(rolCodigo), () => plegado)
  const guardado = useMemo<Record<string, boolean>>(() => {
    try {
      const v: unknown = JSON.parse(crudo)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  }, [crudo])
  // El grupo de la pantalla abierta se abre solo, para que se vea dónde se
  // está; si la persona lo pliega estando ahí, se queda plegado mientras no
  // cambie de pantalla.
  const [plegadoAqui, setPlegadoAqui] = useState<{ titulo: string; ruta?: string } | null>(null)

  const estaAbierto = (g: GrupoNavegacion, conActiva: boolean) => {
    if (g.pliegue === 'fijo') return true
    if (conActiva) return !(plegadoAqui?.titulo === g.titulo && plegadoAqui.ruta === activa)
    return guardado[g.titulo] ?? g.pliegue !== 'plegado'
  }

  const cambiar = (g: GrupoNavegacion, conActiva: boolean, abierto: boolean) => {
    if (conActiva) setPlegadoAqui(abierto ? { titulo: g.titulo, ruta: activa } : null)
    guardar(rolCodigo, g.titulo, !abierto)
  }

  // Al cargar la página entera (F5, la campana, un enlace guardado) la lista
  // empieza arriba, y en un menú largo la pantalla abierta quedaba bajo el
  // borde: se trae a la vista solo dentro del menú, sin mover la página.
  const navRef = useRef<HTMLElement>(null)
  // Se mide un cuadro después, con el menú ya pintado.
  useEffect(() => {
    const cuadro = requestAnimationFrame(() => {
      const nav = navRef.current
      const enlace = nav?.querySelector<HTMLElement>('a[aria-current="page"]')
      if (!nav || !enlace) return
      const n = nav.getBoundingClientRect()
      const e = enlace.getBoundingClientRect()
      if (e.top >= n.top && e.bottom <= n.bottom) return
      nav.scrollTop += e.top - n.top - (nav.clientHeight - e.height) / 2
    })
    return () => cancelAnimationFrame(cuadro)
  }, [activa])

  const base = (r: string) => r.split('?')[0]

  return (
    <nav ref={navRef} aria-label="Menú principal" className={cn('flex h-full flex-col overflow-y-auto px-3', compacto ? 'gap-1 py-2' : 'gap-4 py-5')}>
      {grupos.map((grupo, indice) => {
        const conActiva = grupo.items.some((i) => i.ruta === activa)
        const abierto = estaAbierto(grupo, conActiva)
        const id = `${prefijo}-grupo-${indice}`
        // Plegado, el grupo suma lo que esperan sus módulos: lo que le toca a
        // la persona no se esconde con el pliegue.
        const suma = grupo.items.reduce((n, i) => n + (pendientes[base(i.ruta)] ?? 0), 0)
        const fallaEnGrupo = grupo.items.some((i) => sinComprobar.includes(base(i.ruta)))
        return (
          // `data-grupo`: el título que leen las pruebas del banco, sea texto fijo o botón.
          <div key={grupo.titulo} data-grupo={grupo.titulo}>
            {grupo.pliegue === 'fijo' ? (
              <p className={cn('px-3 text-xs font-semibold tracking-wide text-texto-suave', compacto ? 'pb-1' : 'pb-2')}>{grupo.titulo}</p>
            ) : (
              <button
                type="button"
                aria-expanded={abierto}
                aria-controls={id}
                onClick={() => cambiar(grupo, conActiva, abierto)}
                aria-label={
                  !abierto && fallaEnGrupo
                    ? `${grupo.titulo}, un pendiente no se pudo comprobar`
                    : !abierto && suma > 0
                      ? `${grupo.titulo}, ${pendientesEnPalabras(suma)}`
                      : undefined
                }
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold tracking-wide text-texto-suave transition-colors hover:bg-superficie-2 hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento',
                  compacto ? 'min-h-7 pointer-coarse:min-h-11' : 'min-h-11',
                )}
              >
                <span className="min-w-0 flex-1">{grupo.titulo}</span>
                {!abierto && (fallaEnGrupo || suma > 0) && (
                  <span aria-hidden className="tabular rounded-full bg-aviso-suave px-1.5 font-semibold text-aviso">
                    {fallaEnGrupo ? '!' : suma > 99 ? '99+' : suma}
                  </span>
                )}
                <ChevronDown aria-hidden className={cn('size-3.5 shrink-0 transition-transform', !abierto && '-rotate-90')} />
              </button>
            )}
            <ul id={id} hidden={!abierto} className="space-y-0.5">
              {grupo.items.map((item) => {
                const activo = item.ruta === activa
                const Icono = item.icono

                // Los módulos todavía no construidos se muestran para que se vea
                // el alcance del sistema, pero sin enlace que lleve a un error.
                if (!item.disponible) {
                  return (
                    <li key={item.ruta}>
                      <span
                        title="Módulo en construcción"
                        className="flex cursor-default items-center gap-2.5 rounded-[var(--radius-base)] px-3 py-2 text-sm text-texto-tenue"
                      >
                        <Icono aria-hidden className="size-4 shrink-0" />
                        <span className="truncate">{item.titulo}</span>
                        <span className="ml-auto text-xs tracking-wide uppercase">pronto</span>
                      </span>
                    </li>
                  )
                }

                // Los pendientes van por la ruta base, sin `?…`, como se cuentan.
                const n = pendientes[base(item.ruta)] ?? 0
                const falla = sinComprobar.includes(base(item.ruta))
                return (
                  <li key={item.ruta}>
                    <Link
                      href={item.ruta}
                      onClick={alNavegar}
                      aria-current={activo ? 'page' : undefined}
                      aria-label={falla ? `${item.titulo}, un pendiente no se pudo comprobar` : n > 0 ? `${item.titulo}, ${pendientesEnPalabras(n)}` : undefined}
                      className={cn(
                        'flex items-center rounded-xl border text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento',
                        compacto ? 'min-h-8 gap-2.5 px-3 py-1 pointer-coarse:min-h-11' : 'min-h-11 gap-3 px-3 py-2.5',
                        activo
                          ? 'border-acento bg-acento font-semibold text-acento-texto'
                          : 'border-transparent text-texto-suave hover:border-borde hover:bg-superficie-2 hover:text-texto',
                      )}
                    >
                      <Icono aria-hidden className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        {item.titulo}
                        {/* El «!» solo no explica nada a quien mira: una línea dice qué pasó. */}
                        {falla && <span className="block text-xs font-normal text-texto-suave">No se pudo contar; vuelve a cargar</span>}
                      </span>
                      {activo && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
                      {/* Lo que le toca a este puesto en ese módulo, a la vista
                          sin entrar: el mismo globo de la campana. */}
                      {(falla || n > 0) && (
                        <span className="tabular ml-auto rounded-full bg-aviso-suave px-1.5 text-xs font-semibold text-aviso">
                          {falla ? '!' : n > 99 ? '99+' : n}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

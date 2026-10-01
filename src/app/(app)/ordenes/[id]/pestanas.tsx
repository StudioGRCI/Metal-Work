'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef } from 'react'
import { useContextoOrden } from '@/components/estructura/contexto-orden'
import { cn } from '@/lib/utils'

const SECCIONES = [
  { clave: 'resumen', titulo: 'Resumen' },
  { clave: 'expediente', titulo: 'Expediente' },
  { clave: 'etapas', titulo: 'Etapas' },
  { clave: 'planos', titulo: 'Planos y revisiones' },
  { clave: 'materiales', titulo: 'Materiales' },
  { clave: 'actividades', titulo: 'Taller y fotos' },
  { clave: 'costos', titulo: 'Costos' },
  { clave: 'entrega', titulo: 'Entrega' },
  { clave: 'bitacora', titulo: 'Historial' },
] as const

function rutaDe(ordenId: string, clave: string) {
  if (clave === 'planos') return `/ordenes/${ordenId}/planos`
  if (clave === 'expediente') return `/ordenes/${ordenId}/expediente`
  return `/ordenes/${ordenId}?vista=${clave}`
}

/**
 * Las secciones de una OT. En el monitor viven en la barra lateral, debajo de
 * «Órdenes de trabajo» (se publican por el contexto); en el teléfono son una
 * fila de pestañas que se desliza con el dedo.
 *
 * Antes, en el teléfono, cambiar de sección era abrir el menú general y buscar
 * la sublista de la OT dentro de él: dos toques y una lista larga para pasar
 * de «Resumen» a «Taller y fotos», que es lo que el supervisor hace diez veces
 * al día. La pestaña activa se trae a la vista al entrar, porque «Historial»
 * queda fuera de la pantalla y nadie adivina que hay que deslizar para verla.
 */
export function Pestanas({ ordenId, numero, activa, contadores, visibles }: {
  ordenId: string
  numero: string
  activa: string
  contadores?: Record<string, number>
  visibles: string[]
}) {
  const { publicar } = useContextoOrden()
  const orden = useMemo(() => ({
    id: ordenId, numero, activa,
    secciones: SECCIONES.filter(s => visibles.includes(s.clave)).map(s => ({
      ...s,
      href: rutaDe(ordenId, s.clave),
      pendientes: contadores?.[s.clave] ?? 0,
    })),
  }), [ordenId, numero, activa, contadores, visibles])
  useEffect(() => {
    publicar(orden)
    return () => publicar(null)
  }, [orden, publicar])

  const activaRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    activaRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [activa])

  return (
    <nav aria-label={`Secciones de la OT ${numero}`} className="-mx-4 lg:hidden print:hidden">
      <ul className="pestanas-con-corte flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {orden.secciones.map((s) => {
          const esActiva = s.clave === activa
          return (
            <li key={s.clave} className="shrink-0">
              <Link
                ref={esActiva ? activaRef : undefined}
                href={s.href}
                aria-current={esActiva ? 'page' : undefined}
                aria-label={s.pendientes > 0 ? `${s.titulo}, ${s.pendientes} pendientes` : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap transition-colors',
                  esActiva
                    ? 'border-acento bg-acento font-semibold text-acento-texto'
                    : 'border-borde bg-superficie text-texto-suave hover:text-texto',
                )}
              >
                {s.titulo}
                {s.pendientes > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      'tabular rounded-full px-1.5 text-[11px] font-semibold',
                      esActiva ? 'bg-acento-texto/20 text-acento-texto' : 'bg-aviso-suave text-aviso',
                    )}
                  >
                    {s.pendientes}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

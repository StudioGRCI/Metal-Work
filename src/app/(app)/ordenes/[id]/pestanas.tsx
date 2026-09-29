'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const SECCIONES = [
  { clave: 'resumen', titulo: 'Resumen' },
  { clave: 'ficha', titulo: 'Ficha de taller' },
  { clave: 'etapas', titulo: 'Etapas' },
  { clave: 'planos', titulo: 'Planos' },
  { clave: 'materiales', titulo: 'Materiales' },
  { clave: 'costos', titulo: 'Costos y control' },
  { clave: 'actividades', titulo: 'Avance de Taller' },
  { clave: 'avance', titulo: 'Fotos del taller' },
  { clave: 'bitacora', titulo: 'Trazabilidad' },
] as const

export function Pestanas({ ordenId, activa, contadores = {}, visibles }: {
  ordenId: string
  activa: string
  contadores?: Record<string, number>
  visibles: string[]
}) {
  const activaRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    activaRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [activa])

  return <nav aria-label="Secciones de la orden" className="pestanas-con-corte my-5 flex snap-x snap-mandatory gap-1 overflow-x-auto border-b border-borde overscroll-x-contain">
    {SECCIONES.filter((s) => visibles.includes(s.clave)).map((s) => {
      const esActiva = s.clave === activa
      const n = contadores[s.clave] ?? 0
      return <Link
        key={s.clave}
        ref={esActiva ? activaRef : undefined}
        href={s.clave === 'planos' ? `/ordenes/${ordenId}/planos` : `/ordenes/${ordenId}?vista=${s.clave}`}
        aria-current={esActiva ? 'page' : undefined}
        className={cn('-mb-px inline-flex min-h-11 shrink-0 snap-center items-center border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acento sm:min-h-0',
          esActiva ? 'border-acento bg-acento-suave font-semibold text-acento' : 'border-transparent text-texto-suave hover:border-borde-fuerte hover:text-texto')}
      >
        {s.titulo}
        {n > 0 && <span aria-label={`${n} pendientes`} className="ml-1.5 rounded-full bg-aviso-suave px-1.5 text-xs font-medium text-aviso">{n}</span>}
      </Link>
    })}
  </nav>
}

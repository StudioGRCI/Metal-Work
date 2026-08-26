'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import { Entrada } from '@/components/ui/campos'
import { cn } from '@/lib/utils'

/** El período del informe, con los atajos que se usan de verdad. */
export function RangoDeFechas({
  ruta,
  desde,
  hasta,
}: {
  ruta: string
  desde: string
  hasta: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pendiente, iniciarTransicion] = useTransition()

  function ir(nuevoDesde: string, nuevoHasta: string) {
    const query = new URLSearchParams(params.toString())
    query.set('desde', nuevoDesde)
    query.set('hasta', nuevoHasta)
    iniciarTransicion(() => router.push(`${ruta}?${query}`))
  }

  const hoy = new Date()
  const texto = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const atajos = [
    {
      titulo: 'Este mes',
      desde: texto(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
      hasta: texto(hoy),
    },
    {
      titulo: 'Mes pasado',
      desde: texto(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
      hasta: texto(new Date(hoy.getFullYear(), hoy.getMonth(), 0)),
    },
    {
      titulo: 'Últimos 90 días',
      desde: texto(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 90)),
      hasta: texto(hoy),
    },
    {
      titulo: 'Este año',
      desde: `${hoy.getFullYear()}-01-01`,
      hasta: texto(hoy),
    },
  ]

  return (
    <div className={cn('flex flex-wrap items-end gap-3', pendiente && 'opacity-60')}>
      <div>
        <label htmlFor="desde" className="mb-1 block text-xs text-texto-suave">
          Desde
        </label>
        <Entrada
          id="desde"
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => ir(e.target.value, hasta)}
        />
      </div>
      <div>
        <label htmlFor="hasta" className="mb-1 block text-xs text-texto-suave">
          Hasta
        </label>
        <Entrada
          id="hasta"
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => ir(desde, e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-1 pb-0.5">
        {atajos.map((a) => {
          const activo = a.desde === desde && a.hasta === hasta
          return (
            <button
              key={a.titulo}
              type="button"
              onClick={() => ir(a.desde, a.hasta)}
              aria-pressed={activo}
              className={
                activo
                  ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
                  : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
              }
            >
              {a.titulo}
            </button>
          )
        })}
      </div>
    </div>
  )
}

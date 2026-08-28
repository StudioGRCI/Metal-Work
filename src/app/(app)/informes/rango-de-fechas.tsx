'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
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

  // El atajo puesto es el que coincide con las dos fechas; con un rango escrito
  // a mano no hay ninguno marcado, que es lo correcto.
  const atajoActivo = atajos.find((a) => a.desde === desde && a.hasta === hasta)?.titulo ?? null

  return (
    <div className={cn('flex flex-wrap items-end gap-3', pendiente && 'opacity-60')}>
      {/* En el teléfono los dos campos se reparten la línea; en el monitor
          conservan su ancho natural de siempre. */}
      <div className="min-w-36 flex-1 sm:min-w-0 sm:flex-initial">
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
      <div className="min-w-36 flex-1 sm:min-w-0 sm:flex-initial">
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

      {/* Mismas pastillas que filtran las listas: aquí no navegan, avisan qué
          rango se pulsó y esta pantalla escribe las dos fechas en la URL. */}
      <PastillaFiltro
        className="pb-0.5"
        etiqueta="Período"
        activo={atajoActivo}
        opciones={atajos.map((a) => ({ valor: a.titulo, etiqueta: a.titulo }))}
        alPulsar={(valor) => {
          const atajo = atajos.find((a) => a.titulo === valor)
          if (atajo) ir(atajo.desde, atajo.hasta)
        }}
      />
    </div>
  )
}

'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Entrada } from '@/components/ui/campos'
import { cn } from '@/lib/utils'

/**
 * El período del informe, con los atajos que se usan de verdad.
 *
 * `hoy` llega resuelto desde el servidor (`hoyLima()`) y toda la aritmética va
 * en UTC sobre ese texto. Calcularlo aquí con `new Date()` daba un día distinto
 * en el servidor (UTC) y en el navegador (Lima) a partir de las siete de la
 * tarde: React marcaba error de hidratación cada tarde y los atajos del cierre
 * de mes salían corridos.
 */
export function RangoDeFechas({
  ruta,
  hoy,
  desde,
  hasta,
}: {
  ruta: string
  hoy: string
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

  // Date.UTC absorbe el mes 0 y el día 0 o negativo: «día 0 del mes que viene»
  // es el último de este, y restar 90 días retrocede de mes solo.
  const [anio, mes, dia] = hoy.split('-').map(Number)
  const texto = (t: number) => new Date(t).toISOString().slice(0, 10)

  const atajos = [
    {
      titulo: 'Este mes',
      desde: texto(Date.UTC(anio, mes - 1, 1)),
      hasta: hoy,
    },
    {
      titulo: 'Mes pasado',
      desde: texto(Date.UTC(anio, mes - 2, 1)),
      hasta: texto(Date.UTC(anio, mes - 1, 0)),
    },
    {
      titulo: 'Últimos 90 días',
      desde: texto(Date.UTC(anio, mes - 1, dia - 90)),
      hasta: hoy,
    },
    {
      titulo: 'Este año',
      desde: `${anio}-01-01`,
      hasta: hoy,
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

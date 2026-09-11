import { AlertTriangle, CalendarClock, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { ActividadDelCronograma } from '@/lib/datos/actividades'
import { fecha as fmtFecha, numero } from '@/lib/format'

/**
 * Lo que toca reportar, según el cronograma de cada orden (migración 099): lo
 * que está en marcha hoy y lo que pasó su fecha sin llegar al 100 %. Lo
 * atrasado va primero, en rojo, porque es lo que el jefe va a preguntar.
 *
 * Si ninguna orden tiene cronograma con fechas, no ocupa lugar.
 */
export function LoQueTocaHoy({
  actividades,
  hoy,
  conArea,
}: {
  actividades: ActividadDelCronograma[]
  hoy: string
  /** El jefe ve todas las áreas y necesita saber de cuál es cada una. */
  conArea: boolean
}) {
  if (actividades.length === 0) return null

  const atrasadas = actividades.filter((a) => a.fecha_fin_plan !== null && a.fecha_fin_plan < hoy)
  const enMarcha = actividades.filter((a) => !(a.fecha_fin_plan !== null && a.fecha_fin_plan < hoy))
  const faltanHoy = enMarcha.filter((a) => a.ultimo_reporte !== hoy).length

  return (
    <Tarjeta className="mb-4">
      <TarjetaCabecera
        titulo="Lo que toca reportar"
        descripcion="Según el cronograma de cada orden: lo que está en marcha hoy y lo que ya pasó su fecha sin llegar al 100 %."
        acciones={
          faltanHoy > 0 ? (
            <Insignia tono="aviso">{faltanHoy} sin reporte de hoy</Insignia>
          ) : (
            <Insignia tono="exito">Todo reportado hoy</Insignia>
          )
        }
      />
      <TarjetaCuerpo className="space-y-4">
        {atrasadas.length > 0 && (
          <section aria-label="Atrasadas">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-peligro uppercase">
              <AlertTriangle aria-hidden className="size-3.5" />
              Atrasadas ({atrasadas.length})
            </p>
            <ul className="divide-y divide-borde">
              {atrasadas.map((a) => (
                <Fila key={a.id} a={a} hoy={hoy} conArea={conArea} atrasada />
              ))}
            </ul>
          </section>
        )}

        {enMarcha.length > 0 && (
          <section aria-label="En marcha hoy">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-texto-suave uppercase">
              <CalendarClock aria-hidden className="size-3.5" />
              Toca hoy ({enMarcha.length})
            </p>
            <ul className="divide-y divide-borde">
              {enMarcha.map((a) => (
                <Fila key={a.id} a={a} hoy={hoy} conArea={conArea} />
              ))}
            </ul>
          </section>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Fila({
  a,
  hoy,
  conArea,
  atrasada = false,
}: {
  a: ActividadDelCronograma
  hoy: string
  conArea: boolean
  atrasada?: boolean
}) {
  const reportadaHoy = a.ultimo_reporte === hoy

  return (
    <li>
      <Link
        href={`/ordenes/${a.orden_id}?vista=actividades`}
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 hover:bg-superficie-2"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-texto">
            {a.nombre}
            {a.referencia && <span className="font-normal text-texto-suave"> · {a.referencia}</span>}
          </span>
          <span className="block text-[11px] text-texto-suave">
            {[a.orden_numero, conArea ? a.area : null, `va en ${numero(a.avance_pct, 0)} %`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px]">
          {atrasada ? (
            <span className="font-medium text-peligro">debía terminar el {fmtFecha(a.fecha_fin_plan)}</span>
          ) : (
            a.fecha_fin_plan && <span className="text-texto-suave">hasta el {fmtFecha(a.fecha_fin_plan)}</span>
          )}
          {reportadaHoy ? (
            <span className="flex items-center gap-1 text-exito">
              <CheckCircle2 aria-hidden className="size-3.5" />
              reportada hoy
            </span>
          ) : (
            <Insignia tono={atrasada ? 'peligro' : 'aviso'}>falta el de hoy</Insignia>
          )}
        </span>
      </Link>
    </li>
  )
}

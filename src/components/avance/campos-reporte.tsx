'use client'

import { CalendarDays, X } from 'lucide-react'
import { useState } from 'react'

import { Campo, Entrada } from '@/components/ui/campos'
import { fecha as formatearFecha, hoyLima } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Los campos que se repiten en los reportes del día, pensados para escribirse
 * con una mano y el teléfono en la otra: tocar en vez de teclear, y lo de todos
 * los días —la fecha de hoy— ya puesto.
 */

const MARCAS = [25, 50, 75, 100]

/**
 * El porcentaje con cuatro toques —25, 50, 75, 100— y un casillero para el
 * número exacto cuando hace falta. Un toque sobre la marca que ya está elegida
 * la quita: el porcentaje casi siempre es opcional.
 */
export function CampoPorcentaje({
  id,
  name,
  etiqueta,
  ayuda,
  defaultValue,
  max = 100,
  disabled = false,
  requerido = false,
}: {
  id: string
  name: string
  etiqueta: string
  ayuda?: string
  defaultValue?: number | null
  max?: number
  disabled?: boolean
  requerido?: boolean
}) {
  const [valor, setValor] = useState(defaultValue === null || defaultValue === undefined ? '' : String(defaultValue))

  return (
    <Campo etiqueta={etiqueta} htmlFor={id} ayuda={ayuda} requerido={requerido}>
      <div className="flex flex-wrap items-center gap-1.5">
        {MARCAS.filter((m) => m <= max).map((m) => {
          const elegida = valor === String(m)
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              aria-pressed={elegida}
              aria-label={`${m} %`}
              onClick={() => setValor(elegida ? '' : String(m))}
              className={cn(
                'h-11 min-w-12 rounded-[var(--radius-base)] border px-2 text-sm font-medium tabular transition-colors disabled:opacity-50 sm:h-9',
                elegida
                  ? 'border-transparent bg-acento text-acento-texto'
                  : 'border-borde bg-superficie text-texto hover:bg-superficie-2',
              )}
            >
              {m}
            </button>
          )
        })}
        <Entrada
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step="1"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          disabled={disabled}
          required={requerido}
          placeholder="otro"
          className="w-20 text-right tabular"
        />
        <span className="text-sm text-texto-suave">%</span>
      </div>
    </Campo>
  )
}

/**
 * La fecha del reporte, que casi siempre es hoy: se dice «Hoy, 10/09/2026» y
 * solo si hace falta se abre el calendario. Un reporte atrasado es la
 * excepción, no un campo que se llena cada vez.
 */
export function FechaDelReporte({
  id,
  name = 'fecha',
  deOtroDia = false,
}: {
  id: string
  name?: string
  /** Abre directo el calendario: para reportar el día que se olvidó. */
  deOtroDia?: boolean
}) {
  const hoy = hoyLima()
  const [otroDia, setOtroDia] = useState(deOtroDia)

  if (otroDia) {
    return (
      <Campo etiqueta="Fecha" htmlFor={id} requerido>
        <Entrada id={id} name={name} type="date" required defaultValue={hoy} max={hoy} autoFocus={!deOtroDia} />
      </Campo>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <input type="hidden" name={name} value={hoy} />
      <span className="flex items-center gap-1.5 text-texto">
        <CalendarDays aria-hidden className="size-4 text-texto-suave" />
        Hoy, {formatearFecha(hoy)}
      </span>
      <button
        type="button"
        onClick={() => setOtroDia(true)}
        className="inline-flex min-h-11 items-center text-acento hover:underline sm:min-h-0"
      >
        Es de otro día
      </button>
    </div>
  )
}

/**
 * «¿Algo lo traba?» con la traba de hoy ya escrita. La traba vigente es la del
 * último reporte (migración 097): si el formulario llegara vacío, cualquier
 * reporte nuevo la quitaría sin que nadie lo decida. Así, se mantiene si nadie
 * la toca, y se quita a propósito con «Ya se destrabó».
 */
export function CampoTraba({
  id,
  name = 'impedimento',
  actual,
  ayuda,
}: {
  id: string
  name?: string
  actual?: string | null
  ayuda: string
}) {
  const [valor, setValor] = useState(actual ?? '')

  return (
    <Campo
      etiqueta="¿Algo lo traba?"
      htmlFor={id}
      ayuda={actual ? 'Sigue así desde el último reporte. Si ya se resolvió, quítalo.' : ayuda}
    >
      <div className="flex items-center gap-1.5">
        <Entrada
          id={id}
          name={name}
          autoComplete="off"
          maxLength={500}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Nada"
          className={cn('flex-1', valor && 'border-peligro text-peligro')}
        />
        {valor && (
          <button
            type="button"
            onClick={() => setValor('')}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-[var(--radius-base)] border border-borde px-2.5 text-xs font-medium text-texto hover:bg-superficie-2 sm:h-9"
          >
            <X aria-hidden className="size-3.5" />
            Ya se destrabó
          </button>
        )}
      </div>
    </Campo>
  )
}

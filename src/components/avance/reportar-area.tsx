'use client'

import { ListChecks } from 'lucide-react'
import { useState } from 'react'

import { reportarDiaDeArea } from '@/app/(app)/ordenes/[id]/acciones-actividades'
import { CampoPorcentaje, FechaDelReporte } from '@/components/avance/campos-reporte'
import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { numero } from '@/lib/format'

/**
 * El reporte del día de un área entera, en una sola ventana: una fila por
 * actividad en marcha, con las marcas 25/50/75/100 y una nota. Las filas que
 * se dejan en blanco no se mandan. Antes eran ocho ventanas —abrir, tocar,
 * reportar— para ocho actividades; ahora es una, con un solo envío.
 */
export function ReportarArea({
  ordenId,
  area,
  actividades,
}: {
  ordenId: string
  area: { id: string; nombre: string }
  /** Las que todavía no llegaron al 100 % ni tienen reporte de hoy. */
  actividades: { id: string; nombre: string; avance_pct: number | string; referencia: string | null }[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(reportarDiaDeArea, (r) => {
    setAbierto(false)
    setAviso(r.mensaje ?? 'Reportado.')
  })

  if (actividades.length === 0) {
    return aviso ? (
      <span role="status" className="text-xs font-medium text-exito">
        {aviso}
      </span>
    ) : null
  }

  return (
    <>
      <Boton
        variante="primario"
        tamano="sm"
        onClick={() => {
          limpiar()
          setAviso(null)
          setAbierto(true)
        }}
      >
        <ListChecks aria-hidden className="size-3.5" />
        Reportar el día
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`${area.nombre}: el día de hoy`}
        descripcion="Lo que avanzó hoy cada actividad, no el acumulado. Las que no se tocaron quedan en blanco y no se mandan."
        ancho="lg"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="orden_id" value={ordenId} />
          <input type="hidden" name="area_id" value={area.id} />

          <ul className="divide-y divide-borde">
            {actividades.map((a) => {
              const falta = Math.max(0, 100 - Number(a.avance_pct))
              return (
                <li key={a.id} className="space-y-2 py-3 first:pt-0">
                  <p className="text-sm font-medium text-texto">
                    {a.nombre}
                    {a.referencia && <span className="font-normal text-texto-suave"> · {a.referencia}</span>}
                    <span className="ml-2 text-xs font-normal text-texto-suave">
                      va en {numero(a.avance_pct, 0)} % · le falta {numero(falta, 0)} %
                    </span>
                  </p>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <CampoPorcentaje id={`area-${a.id.slice(0, 8)}-pct`} name={`avance_${a.id}`} etiqueta="Avancé" max={falta} />
                    <Entrada
                      name={`nota_${a.id}`}
                      aria-label={`Qué se hizo en ${a.nombre}`}
                      placeholder="Qué se hizo (opcional)"
                      maxLength={500}
                      className="sm:w-64"
                    />
                  </div>
                </li>
              )
            })}
          </ul>

          <FechaDelReporte id={`area-${area.id.slice(0, 8)}-fecha`} />

          {error && (
            <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} className="w-full sm:w-auto">
              Reportar lo del día
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

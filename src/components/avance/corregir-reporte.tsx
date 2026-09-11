'use client'

import { MessageSquareWarning, PencilLine } from 'lucide-react'
import { useState } from 'react'

import { corregirReporte } from '@/app/(app)/avance/acciones-revision'
import { CampoPorcentaje, CampoTraba } from '@/components/avance/campos-reporte'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { fecha as formatearFecha } from '@/lib/format'

/** Lo que se puede corregir de cada reporte, con lo que dice hoy. */
export type ReporteACorregir =
  | {
      clase: 'flota'
      id: string
      fecha: string
      descripcion: string
      avance_porcentaje: number | null
      impedimento: string | null
    }
  | { clase: 'orden'; id: string; fecha: string; descripcion: string; impedimento: string | null }
  | {
      clase: 'hoja'
      id: string
      fecha: string
      actividad: string
      avance_pct: number
      nota: string | null
      /** Hasta cuánto puede llegar este reporte sin que la actividad pase de 100. */
      tope: number
    }

/**
 * Corregir un reporte que no está aprobado: el texto, la traba y, donde se
 * puede, el porcentaje. Si el jefe lo observó, lo que pidió va arriba de todo:
 * es lo que hay que resolver. Al guardar, lo observado vuelve a «por aprobar».
 */
export function CorregirReporte({
  reporte,
  observacion,
  etiqueta = 'Corregir',
  destacado = false,
}: {
  reporte: ReporteACorregir
  /** Lo que pidió el jefe, si lo observó. */
  observacion?: string | null
  etiqueta?: string
  /** Observado: el botón se ve, no se esconde entre los demás. */
  destacado?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(corregirReporte, (r) => {
    setAbierto(false)
    setAviso(r.mensaje ?? 'Reporte corregido.')
  })

  const prefijo = `c-${reporte.id.slice(0, 8)}`

  function abrir() {
    limpiar()
    setAviso(null)
    setAbierto(true)
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Boton
          type="button"
          tamano="sm"
          variante={destacado ? 'primario' : 'fantasma'}
          onClick={abrir}
        >
          <PencilLine aria-hidden className="size-3.5" />
          {etiqueta}
        </Boton>
        {aviso && (
          <span role="status" className="text-xs font-medium text-exito">
            {aviso}
          </span>
        )}
      </span>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={
          reporte.clase === 'hoja'
            ? `${reporte.actividad}: el reporte del ${formatearFecha(reporte.fecha)}`
            : `El reporte del ${formatearFecha(reporte.fecha)}`
        }
        descripcion="Corrige lo que haga falta. Si el jefe lo observó, vuelve a pedirle el visto."
        ancho="lg"
      >
        <form onSubmit={alEnviar} className="space-y-3">
          <input type="hidden" name="clase" value={reporte.clase} />
          <input type="hidden" name="id" value={reporte.id} />

          {observacion && (
            <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
              <MessageSquareWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-medium">El jefe pidió:</span> {observacion}
              </span>
            </p>
          )}

          {reporte.clase === 'hoja' ? (
            <>
              <CampoPorcentaje
                id={`${prefijo}-pct`}
                name="avance_pct"
                etiqueta="Avancé ese día"
                ayuda={`Lo del día, no el acumulado. Hasta ${Math.floor(reporte.tope)} %.`}
                defaultValue={reporte.avance_pct}
                max={reporte.tope}
                requerido
              />
              <Campo etiqueta="Qué se hizo" htmlFor={`${prefijo}-nota`}>
                <Entrada id={`${prefijo}-nota`} name="nota" defaultValue={reporte.nota ?? ''} maxLength={500} />
              </Campo>
            </>
          ) : (
            <>
              <Campo etiqueta="Qué se hizo" htmlFor={`${prefijo}-desc`} requerido>
                <AreaTexto
                  id={`${prefijo}-desc`}
                  name="descripcion"
                  rows={3}
                  required
                  minLength={5}
                  defaultValue={reporte.descripcion}
                />
              </Campo>

              <div className="grid gap-3 sm:grid-cols-2">
                {reporte.clase === 'flota' && (
                  <CampoPorcentaje
                    id={`${prefijo}-avance`}
                    name="avance_porcentaje"
                    etiqueta="Cuánto va"
                    ayuda="Del 0 al 100, como lo ves."
                    defaultValue={reporte.avance_porcentaje}
                  />
                )}
                <CampoTraba
                  id={`${prefijo}-traba`}
                  actual={reporte.impedimento}
                  ayuda="Material que falta, decisión del cliente, pieza en el proveedor"
                />
              </div>

              {reporte.clase === 'orden' && (
                <p className="text-[11px] text-texto-tenue">
                  El porcentaje de la etapa no se corrige acá: movió la etapa al registrarse. Si quedó mal,
                  registra un avance nuevo con el que va.
                </p>
              )}
            </>
          )}

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
              Guardar la corrección
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

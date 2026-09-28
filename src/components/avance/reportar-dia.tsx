'use client'

import { CalendarDays, TrendingUp } from 'lucide-react'
import { useState } from 'react'

import { reportarAvance } from '@/app/(app)/ordenes/[id]/acciones-actividades'
import { CampoPorcentaje, FechaDelReporte } from '@/components/avance/campos-reporte'
import { SelectorFotos, fotosParaEnviar, hayFallidas, haySubiendo, type FotoLista } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { numero } from '@/lib/format'

function Error_({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * El reporte del día de una actividad, en una ventana: en el teléfono la tabla
 * no deja lugar para un formulario en la celda. Lo del día con un toque —25,
 * 50, 75, 100, hasta lo que le falta— y la fecha de hoy ya puesta.
 *
 * Vive fuera de la orden porque también se reporta desde «Lo que toca
 * reportar» en /avance: la lista ya nombra la actividad, y entrar a la OT para
 * tocar el mismo botón eran dos pantallas de más.
 */
export function ReportarDia({
  actividad,
  ordenId,
  deOtroDia = false,
  compacto = false,
  esNueva = false,
  despachos = [],
}: {
  actividad: { id: string; nombre: string; avance_pct: number | string }
  ordenId: string
  /** Para el día que se olvidó, cuando el de hoy ya está. */
  deOtroDia?: boolean
  /** Solo el botón, sin el aviso al lado: para listas apretadas. */
  compacto?: boolean
  esNueva?: boolean
  despachos?: { id: string; nombre: string; unidad: string; area: string; cantidad: number }[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(reportarAvance, (r) => {
    setAbierto(false)
    setAviso(r.mensaje ?? 'Avance del día reportado.')
  })

  const falta = Math.max(0, 100 - Number(actividad.avance_pct))
  const prefijo = `${deOtroDia ? 'o' : 'r'}-${actividad.id.slice(0, 8)}`

  return (
    <>
      <Boton
        variante={deOtroDia ? 'fantasma' : 'secundario'}
        tamano="sm"
        onClick={() => {
          limpiar()
          setAviso(null)
          setAbierto(true)
        }}
      >
        {deOtroDia ? (
          <CalendarDays aria-hidden className="size-3.5" />
        ) : (
          <TrendingUp aria-hidden className="size-3.5" />
        )}
        {deOtroDia ? 'Otro día' : 'Reportar día'}
      </Boton>
      {aviso && !compacto && (
        <span role="status" className="text-xs font-medium text-exito">
          {aviso}
        </span>
      )}

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={actividad.nombre}
        descripcion={`Lo que avanzó ${deOtroDia ? 'ese día' : 'hoy'}, no el acumulado. Va en ${numero(actividad.avance_pct, 0)} %: le falta ${numero(falta, 0)} %.`}
        ancho="md"
      >
        <form onSubmit={(e) => {
          if (esNueva) {
            const listas = fotosParaEnviar(fotos)
            if (listas.length !== 1 || haySubiendo(fotos) || hayFallidas(fotos)) {
              e.preventDefault()
              return
            }
            alEnviar(e, (datos) => {
              datos.set('foto_ruta', listas[0].ruta_storage)
              datos.set('materiales_usados', JSON.stringify(despachos.flatMap(d => {
                const cantidad = Number(datos.get(`material-${d.id}`) || 0)
                return cantidad > 0 ? [{ movimiento_id: d.id, cantidad }] : []
              })))
            })
            return
          }
          alEnviar(e)
        }} className="space-y-4">
          <input type="hidden" name="actividad_id" value={actividad.id} />
          <input type="hidden" name="orden_id" value={ordenId} />

          <CampoPorcentaje
            id={`${prefijo}-pct`}
            name="avance_pct"
            etiqueta="Avancé"
            ayuda="Lo del día, del 100 % de la actividad."
            max={falta}
            requerido
          />

          <Campo etiqueta="Qué se hizo" htmlFor={`${prefijo}-nota`}>
            <Entrada id={`${prefijo}-nota`} name="nota" placeholder="Opcional" maxLength={500} />
          </Campo>

          {esNueva && <>
            <SelectorFotos fotos={fotos} alCambiar={setFotos} prefijoRuta={`ot/${ordenId}/taller`} maximo={1} />
            <p className="text-xs text-texto-suave">Adjunta una sola foto para sustentar el porcentaje.</p>
            {despachos.length > 0 && <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-texto">Materiales usados</legend>
              {despachos.map(d => <Campo key={d.id} etiqueta={`${d.nombre} · ${d.area} · despachado ${d.cantidad} ${d.unidad}`} htmlFor={`material-${d.id}`}>
                <Entrada id={`material-${d.id}`} name={`material-${d.id}`} type="number" inputMode="decimal" min={0} max={d.cantidad} step="any" defaultValue="0" />
              </Campo>)}
            </fieldset>}
            {fotos.length > 1 && <p role="alert" className="text-xs text-peligro">Deja una sola foto para este reporte.</p>}
          </>}

          <FechaDelReporte id={`${prefijo}-fecha`} deOtroDia={deOtroDia} />

          <Error_ texto={error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} disabled={esNueva && (fotosParaEnviar(fotos).length !== 1 || haySubiendo(fotos) || hayFallidas(fotos))} className="w-full sm:w-auto">
              Reportar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

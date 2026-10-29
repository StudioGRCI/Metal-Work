'use client'

import { CalendarDays, TrendingUp } from 'lucide-react'
import { useState } from 'react'

import { reportarAvance } from '@/app/(app)/ordenes/[id]/acciones-actividades'
import { CampoPorcentaje, FechaDelReporte } from '@/components/avance/campos-reporte'
import { EstadoDelEnvio, SelectorFotos, fotosParaEnviar, hayFallidas, haySubiendo, useFotosDelEnvio } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'
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
  // La orden pinta cada actividad dos veces (la tarjeta del teléfono y la fila
  // del monitor): las dos comparten el envío en camino, su desenlace y el aviso
  // verde, o al girar el teléfono el que queda a la vista no sabía de ellos
  // (vigesimoctava pasada).
  const clave = `reportar-dia:${actividad.id}:${deOtroDia ? 'otro' : 'hoy'}`
  const [aviso, setAviso] = useEstadoCompartido<string | null>(`${clave}:aviso`, null)
  // Mientras se envía, la foto se queda: el reporte que está entrando la nombra,
  // y la base exige que esté en Storage (`validar_reporte_taller`). Tampoco se
  // quita si no se sabe si entró, ni tras un rechazo con la ventana abierta: se
  // corrige el porcentaje y se vuelve a enviar sin tomarla de nuevo. Antes
  // cualquier rechazo, o un corte de la señal, la quitaba en el acto
  // (vigesimosexta pasada). Como en «Registrar avance» (`useFotosDelEnvio`).
  const envio = useFotosDelEnvio('fotos-avance', clave)
  const { fotos, setFotos } = envio
  const { alEnviar, enviando, error, limpiar } = useEnvio(envio.conFotos(reportarAvance), (r) => {
    if (!envio.seCerroAlEnviar()) setAbierto(false)
    setAviso(r.mensaje ?? 'Avance del día reportado.')
  })
  function cancelar() {
    envio.cerrar()
    setAbierto(false)
  }

  const falta = Math.max(0, 100 - Number(actividad.avance_pct))
  const prefijo = `${deOtroDia ? 'o' : 'r'}-${actividad.id.slice(0, 8)}`
  // Cerrada mientras el reporte va en camino: no se abre otra hasta que conteste.
  // Tampoco mientras la página se pone al día tras el ok: salía trabada y
  // girando (vigesimoctava pasada).
  const { sigue, idDelEstado } = envio
  const ocupado = sigue || (enviando && !abierto)

  return (
    <>
      <Boton
        variante={deOtroDia ? 'fantasma' : 'secundario'}
        tamano="sm"
        ocupado={ocupado}
        aria-describedby={sigue ? idDelEstado : undefined}
        onClick={() => {
          limpiar()
          setAviso(null)
          envio.abrir()
          setAbierto(true)
        }}
      >
        {ocupado ? null : deOtroDia ? (
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
      {/* También en la lista apretada: si no entró, nadie más lo diría. */}
      <EstadoDelEnvio id={idDelEstado} sigue={sigue} desenlace={envio.desenlace} registro="El reporte" />

      <Ventana
        abierta={abierto}
        alCerrar={cancelar}
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

          {/* Trabado mientras se envía: la foto que se quitaba entonces era la
              que el reporte nombraba (vigesimoséptima pasada). */}
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
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
          </fieldset>

          <Error_ texto={error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={cancelar}>
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

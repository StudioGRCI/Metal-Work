'use client'

import { CalendarDays } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_ETAPA, ORDEN_ESTADO_ETAPA, definir, opciones } from '@/lib/dominio/estados'
import { cantidad, fecha } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import type { Vistas } from '@/types/database'

import { actualizarEtapa } from '../acciones'

type Etapa = Vistas<'ot_tablero_etapas'> & { observaciones: string | null }

const ESTADOS = opciones(ESTADO_ETAPA, ORDEN_ESTADO_ETAPA)

/**
 * En qué va la etapa contra su programa: vencida si pasó su fecha de fin sin
 * terminar, «toca ahora» si ya empezó según el programa. Es la misma cuenta que
 * hace /plazos, y la que hacía falta acá: el jefe veía «Vencido» en el control
 * de plazos y al abrir la orden no sabía a qué etapa correspondía.
 */
export function programaDeEtapa(etapa: Pick<Etapa, 'estado' | 'fecha_fin_real' | 'fecha_inicio_programada' | 'fecha_fin_programada'>, hoy: string) {
  const cerrada = Boolean(etapa.fecha_fin_real) || etapa.estado === 'TERMINADA' || etapa.estado === 'OMITIDA'
  const fin = etapa.fecha_fin_programada
  const inicio = etapa.fecha_inicio_programada
  const vencida = !cerrada && fin !== null && fin < hoy
  const tocaAhora = !cerrada && !vencida && inicio !== null && inicio <= hoy
  return { vencida, tocaAhora, inicio, fin }
}

export function Etapas({
  ordenId,
  etapas,
  hoy,
  puedeRegistrar,
  puedePlanificar,
}: {
  ordenId: string
  etapas: Etapa[]
  /** La fecha del taller (hoyLima), resuelta en el servidor. */
  hoy: string
  puedeRegistrar: boolean
  /** `produccion.planificar`: mover las fechas del programa. */
  puedePlanificar: boolean
}) {
  const [editando, setEditando] = useState<string | null>(null)

  if (etapas.length === 0) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="py-10 text-center text-sm text-texto-suave">
            Esta orden todavía no tiene etapas. Se generan automáticamente al aprobarla.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  const vencidas = etapas.filter((e) => programaDeEtapa(e, hoy).vencida).length

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Etapas de producción"
        descripcion="El avance de cada etapa alimenta el avance total de la orden, ponderado por sus horas. Las fechas son el programa: contra ellas corre el control de plazos."
        acciones={vencidas > 0 ? <Insignia tono="peligro">{vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}</Insignia> : null}
      />
      <TarjetaCuerpo className="space-y-2 p-2">
        {etapas.map((etapa) => {
          const estado = definir(ESTADO_ETAPA, etapa.estado)
          const abierta = editando === etapa.etapa_id
          const programa = programaDeEtapa(etapa, hoy)

          return (
            <div
              key={etapa.etapa_id}
              id={`etapa-${etapa.etapa_id}`}
              className="scroll-mt-20 rounded-[var(--radius-base)] border border-borde p-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="tabular w-6 shrink-0 text-xs text-texto-tenue">
                  {etapa.orden_secuencia}
                </span>

                <div className="min-w-40 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-texto">
                    {etapa.etapa}
                  </p>
                  <p className="text-[11px] text-texto-suave">
                    {cantidad(etapa.horas_estimadas)} h estimadas
                    {etapa.fecha_fin_real && ` · terminada el ${fecha(etapa.fecha_fin_real)}`}
                  </p>
                  {(programa.inicio || programa.fin) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-texto-suave">
                      <CalendarDays aria-hidden className="size-3 shrink-0" />
                      <span className="tabular">
                        {fecha(programa.inicio) ?? '—'} → {fecha(programa.fin) ?? '—'}
                      </span>
                      {programa.vencida && <Insignia tono="peligro">Vencida</Insignia>}
                      {programa.tocaAhora && <Insignia tono="aviso">Toca ahora</Insignia>}
                    </p>
                  )}
                </div>

                {/* La barra ocupa la línea entera en el teléfono, donde si no
                    se queda apretada entre el nombre y la insignia; en el
                    monitor vuelve a sus 160 px de siempre. */}
                <div className="w-full sm:w-40">
                  <Progreso valor={etapa.avance_porcentaje} mostrarValor alto="sm" />
                </div>

                <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>

                {puedeRegistrar && (
                  <Boton
                    variante="fantasma"
                    tamano="sm"
                    onClick={() => setEditando(abierta ? null : etapa.etapa_id!)}
                    aria-expanded={abierta}
                  >
                    {abierta ? 'Cerrar' : 'Registrar'}
                  </Boton>
                )}
              </div>

              {abierta && (
                <FormularioEtapa
                  ordenId={ordenId}
                  etapa={etapa}
                  puedePlanificar={puedePlanificar}
                  alTerminar={() => setEditando(null)}
                />
              )}
            </div>
          )
        })}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function FormularioEtapa({
  ordenId,
  etapa,
  puedePlanificar,
  alTerminar,
}: {
  ordenId: string
  etapa: Etapa
  puedePlanificar: boolean
  alTerminar: () => void
}) {
  const [avance, setAvance] = useState(Number(etapa.avance_porcentaje ?? 0))
  // El formulario se cierra únicamente cuando el guardado fue correcto.
  const { alEnviar, enviando, error } = useEnvio(actualizarEtapa, alTerminar)

  return (
    <form onSubmit={alEnviar} className="mt-3 grid gap-3 border-t border-borde pt-3 sm:grid-cols-3">
      <input type="hidden" name="etapa_id" value={etapa.etapa_id ?? ''} />
      <input type="hidden" name="orden_id" value={ordenId} />

      <Campo etiqueta="Avance" htmlFor={`avance-${etapa.etapa_id}`}>
        <div className="flex items-center gap-2">
          <input
            id={`avance-${etapa.etapa_id}`}
            name="avance_porcentaje"
            type="range"
            min={0}
            max={100}
            step={5}
            value={avance}
            onChange={(e) => setAvance(Number(e.target.value))}
            // El riel mide 4 px; el blanco para agarrarlo, 44 en el teléfono.
            // En el monitor vuelve al alto natural del control.
            className="h-11 w-full accent-[var(--acento)] sm:h-auto"
          />
          <Entrada
            aria-label="Avance en porcentaje"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={avance}
            onChange={(e) => setAvance(Number(e.target.value))}
            className="tabular w-16 text-right"
          />
        </div>
      </Campo>

      <Campo etiqueta="Estado" htmlFor={`estado-${etapa.etapa_id}`}>
        <Seleccion
          id={`estado-${etapa.etapa_id}`}
          name="estado"
          defaultValue={etapa.estado ?? 'PENDIENTE'}
        >
          {ESTADOS.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </Seleccion>
      </Campo>

      <Campo etiqueta="Observaciones" htmlFor={`obs-${etapa.etapa_id}`}>
        <AreaTexto
          id={`obs-${etapa.etapa_id}`}
          name="observaciones"
          rows={2}
          defaultValue={etapa.observaciones ?? ''}
          placeholder="Novedades del trabajo en esta etapa"
        />
      </Campo>

      {/* El programa lo mueve quien planifica (`produccion.planificar`): los
          jefes. Los campos solo se pintan con el permiso, y la acción los
          rechaza sin él: ocultarlos no es una puerta. */}
      {puedePlanificar && (
        <>
          <Campo etiqueta="Programada desde" htmlFor={`pi-${etapa.etapa_id}`} ayuda="Según el cronograma; vacío la deja sin fecha">
            <Entrada
              id={`pi-${etapa.etapa_id}`}
              name="fecha_inicio_programada"
              type="date"
              defaultValue={etapa.fecha_inicio_programada ?? ''}
            />
          </Campo>
          <Campo etiqueta="Programada hasta" htmlFor={`pf-${etapa.etapa_id}`} ayuda="Contra esta fecha corre el plazo">
            <Entrada
              id={`pf-${etapa.etapa_id}`}
              name="fecha_fin_programada"
              type="date"
              defaultValue={etapa.fecha_fin_programada ?? ''}
            />
          </Campo>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro sm:col-span-3">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 sm:col-span-3">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Guardar avance
        </Boton>
      </div>
    </form>
  )
}

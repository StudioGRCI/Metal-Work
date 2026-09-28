'use client'

import { CalendarDays } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_ETAPA, ORDEN_ESTADO_ETAPA, definir, opciones } from '@/lib/dominio/estados'
import { programaDeEtapa } from '@/lib/dominio/programa-etapa'
import { cantidad, fecha } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import type { Vistas } from '@/types/database'

import { actualizarEtapa } from '../acciones'
import { definirEtapas, programarEtapa } from './acciones-etapas'

type Etapa = Vistas<'ot_tablero_etapas'> & { observaciones: string | null; etapa_catalogo_id: string | null }
type EtapaCatalogo = { id: string; nombre: string; orden_secuencia: number }

const ESTADOS = opciones(ESTADO_ETAPA, ORDEN_ESTADO_ETAPA)

export function Etapas({
  ordenId,
  etapas,
  catalogo,
  hoy,
  puedeRegistrar,
  puedeDefinir,
  puedeProgramar,
}: {
  ordenId: string
  etapas: Etapa[]
  catalogo: EtapaCatalogo[]
  /** La fecha del taller (hoyLima), resuelta en el servidor. */
  hoy: string
  puedeRegistrar: boolean
  puedeDefinir: boolean
  puedeProgramar: boolean
}) {
  const [editando, setEditando] = useState<string | null>(null)
  const [programando, setProgramando] = useState<string | null>(null)

  if (etapas.length === 0 && !puedeDefinir) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="py-10 text-center text-sm text-texto-suave">
            Esta orden todavía no tiene etapas. Diseño debe elegirlas.
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
        {puedeDefinir && <FormularioDefinicion ordenId={ordenId} catalogo={catalogo} etapas={etapas} />}
        {etapas.length === 0 && (
          <p className="py-6 text-center text-sm text-texto-suave">Diseño todavía no ha definido las etapas de esta orden.</p>
        )}
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
                {puedeProgramar && (
                  <Boton variante="fantasma" tamano="sm"
                    onClick={() => setProgramando(programando === etapa.etapa_id ? null : etapa.etapa_id)}
                    aria-expanded={programando === etapa.etapa_id}>
                    {programando === etapa.etapa_id ? 'Cerrar fechas' : 'Programar'}
                  </Boton>
                )}
              </div>

              {abierta && (
                <FormularioEtapa
                  ordenId={ordenId}
                  etapa={etapa}
                  alTerminar={() => setEditando(null)}
                />
              )}
              {programando === etapa.etapa_id && (
                <FormularioProgramacion ordenId={ordenId} etapa={etapa}
                  alTerminar={() => setProgramando(null)} />
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
  alTerminar,
}: {
  ordenId: string
  etapa: Etapa
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

function FormularioDefinicion({ ordenId, catalogo, etapas }: {
  ordenId: string
  catalogo: EtapaCatalogo[]
  etapas: Etapa[]
}) {
  const { alEnviar, enviando, error } = useEnvio(definirEtapas)
  const existentes = new Map(etapas.map((e) => [e.etapa_catalogo_id, e.orden_secuencia]))
  return (
    <form onSubmit={alEnviar} className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
      <input type="hidden" name="orden_id" value={ordenId} />
      <p className="text-sm font-medium text-texto">Diseño: elige y ordena las etapas</p>
      <p className="text-xs text-texto-suave">Las etapas ya registradas deben permanecer seleccionadas para conservar sus reportes.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalogo.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-[var(--radius-base)] border border-borde p-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-texto">
              <input type="checkbox" name="etapa_id" value={item.id} defaultChecked={existentes.has(item.id)} />
              <span>{item.nombre}</span>
            </label>
            <Entrada type="number" min={1} max={100} name={`posicion_${item.id}`}
              aria-label={`Posición de ${item.nombre}`} defaultValue={existentes.get(item.id) ?? item.orden_secuencia}
              className="w-16 tabular text-right" />
          </div>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
      <Boton type="submit" tamano="sm" cargando={enviando}>Guardar etapas</Boton>
    </form>
  )
}

function FormularioProgramacion({ ordenId, etapa, alTerminar }: {
  ordenId: string
  etapa: Etapa
  alTerminar: () => void
}) {
  const { alEnviar, enviando, error } = useEnvio(programarEtapa, alTerminar)
  return (
    <form onSubmit={alEnviar} className="mt-3 grid gap-3 border-t border-borde pt-3 sm:grid-cols-3">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="etapa_id" value={etapa.etapa_id ?? ''} />
      <Campo etiqueta="Inicio programado" htmlFor={`inicio-${etapa.etapa_id}`}>
        <Entrada id={`inicio-${etapa.etapa_id}`} name="inicio" type="date"
          defaultValue={etapa.fecha_inicio_programada ?? ''} required />
      </Campo>
      <Campo etiqueta="Fin programado" htmlFor={`fin-${etapa.etapa_id}`}>
        <Entrada id={`fin-${etapa.etapa_id}`} name="fin" type="date"
          defaultValue={etapa.fecha_fin_programada ?? ''} required />
      </Campo>
      {error && <p role="alert" className="text-sm text-peligro sm:col-span-3">{error}</p>}
      <div className="flex items-end justify-end gap-2">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>Cancelar</Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>Guardar fechas</Boton>
      </div>
    </form>
  )
}

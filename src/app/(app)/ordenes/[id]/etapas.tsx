'use client'

import { CalendarDays } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_ETAPA, definir } from '@/lib/dominio/estados'
import { programaDeEtapa } from '@/lib/dominio/programa-etapa'
import { cantidad, fecha } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import type { Vistas } from '@/types/database'

import { definirEtapas, programarEtapa } from './acciones-etapas'

type Etapa = Vistas<'ot_tablero_etapas'> & { observaciones: string | null; etapa_catalogo_id: string | null; area_id: string | null; peso_pct: number | null }
type EtapaCatalogo = { id: string; nombre: string; orden_secuencia: number; area_id: string | null }
type Area = { id: string; nombre: string }

export function Etapas({
  ordenId,
  etapas,
  catalogo,
  areas,
  hoy,
  esNueva,
  puedeDefinir,
  puedeProgramar,
}: {
  ordenId: string
  etapas: Etapa[]
  catalogo: EtapaCatalogo[]
  areas: Area[]
  /** La fecha del taller (hoyLima), resuelta en el servidor. */
  hoy: string
  esNueva: boolean
  puedeDefinir: boolean
  puedeProgramar: boolean
}) {
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
        descripcion={esNueva
          ? 'Cada etapa aporta según su peso. El avance sale de los reportes de tareas y revisiones de planos; las fechas controlan los plazos.'
          : 'Esta OT conserva su plan histórico: el avance se pondera por las horas estimadas de cada etapa. Las fechas controlan los plazos.'}
        acciones={vencidas > 0 ? <Insignia tono="peligro">{vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}</Insignia> : null}
      />
      <TarjetaCuerpo className="space-y-2 p-2">
        {puedeDefinir && <FormularioDefinicion ordenId={ordenId} catalogo={catalogo} areas={areas} etapas={etapas} />}
        {etapas.length === 0 && (
          <p className="py-6 text-center text-sm text-texto-suave">Diseño todavía no ha definido las etapas de esta orden.</p>
        )}
        {etapas.map((etapa) => {
          const estado = definir(ESTADO_ETAPA, etapa.estado)
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
                    {etapa.area_id && ` · ${areas.find((a) => a.id === etapa.area_id)?.nombre ?? 'Área asignada'}`}
                    {etapa.peso_pct !== null && ` · peso ${cantidad(etapa.peso_pct)} %`}
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

                {puedeProgramar && (
                  <Boton variante="fantasma" tamano="sm"
                    onClick={() => setProgramando(programando === etapa.etapa_id ? null : etapa.etapa_id)}
                    aria-expanded={programando === etapa.etapa_id}>
                    {programando === etapa.etapa_id ? 'Cerrar fechas' : 'Programar'}
                  </Boton>
                )}
              </div>

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
function FormularioDefinicion({ ordenId, catalogo, areas, etapas }: {
  ordenId: string
  catalogo: EtapaCatalogo[]
  areas: Area[]
  etapas: Etapa[]
}) {
  const { alEnviar, enviando, error } = useEnvio(definirEtapas)
  const [seleccion, setSeleccion] = useState(() => etapas
    .filter((e) => e.etapa_catalogo_id !== null)
    .map((e) => ({ id: e.etapa_catalogo_id!, area: e.area_id ?? catalogo.find((c) => c.id === e.etapa_catalogo_id)?.area_id ?? areas[0]?.id ?? '', peso: e.peso_pct ?? 0 })))
  const [porAgregar, setPorAgregar] = useState('')
  const existentes = new Set(etapas.map((e) => e.etapa_catalogo_id))
  const disponibles = catalogo.filter((item) => !seleccion.some((e) => e.id === item.id))
  const total = seleccion.reduce((suma, item) => suma + Number(item.peso || 0), 0)
  function mover(indice: number, cambio: number) {
    const copia = [...seleccion]
    const [item] = copia.splice(indice, 1)
    copia.splice(indice + cambio, 0, item)
    setSeleccion(copia)
  }
  return (
    <form onSubmit={alEnviar} className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
      <input type="hidden" name="orden_id" value={ordenId} />
      <p className="text-sm font-medium text-texto">Diseño: etapas de la OT</p>
      <p className="text-xs text-texto-suave">Agrega las etapas necesarias, asigna su área y reparte el 100 % del trabajo.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Etapa para agregar" htmlFor="etapa-para-agregar" className="min-w-56 flex-1">
          <Seleccion id="etapa-para-agregar" value={porAgregar} onChange={(e) => setPorAgregar(e.target.value)}>
            <option value="">Selecciona una etapa</option>
            {disponibles.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </Seleccion>
        </Campo>
        <Boton type="button" variante="secundario" tamano="sm" disabled={!porAgregar} onClick={() => {
          const item = catalogo.find((c) => c.id === porAgregar)
          if (!item) return
          setSeleccion((actual) => [...actual, { id: item.id, area: item.area_id ?? areas[0]?.id ?? '', peso: 0 }])
          setPorAgregar('')
        }}>Agregar etapa</Boton>
      </div>
      {seleccion.length === 0 && <p className="text-sm text-texto-suave">Selecciona una etapa para empezar.</p>}
      <div className="space-y-2">
        {seleccion.map((item, indice) => {
          const nombre = catalogo.find((c) => c.id === item.id)?.nombre ?? 'Etapa'
          return <div key={item.id} className="grid gap-2 rounded-[var(--radius-base)] border border-borde p-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,1fr)_7rem_auto] sm:items-end">
            <input type="hidden" name="etapa_id" value={item.id} />
            <div>
              <p className="text-sm font-medium text-texto">{indice + 1}. {nombre}</p>
              <div className="mt-1 flex gap-1">
                <Boton type="button" variante="fantasma" tamano="sm" disabled={indice === 0} onClick={() => mover(indice, -1)} aria-label={`Subir ${nombre}`}>↑</Boton>
                <Boton type="button" variante="fantasma" tamano="sm" disabled={indice === seleccion.length - 1} onClick={() => mover(indice, 1)} aria-label={`Bajar ${nombre}`}>↓</Boton>
              </div>
            </div>
            <Campo etiqueta="Área responsable" htmlFor={`area-${item.id}`} requerido>
              <Seleccion id={`area-${item.id}`} name={`area_${item.id}`} required value={item.area} onChange={(e) => setSeleccion((actual) => actual.map((fila) => fila.id === item.id ? { ...fila, area: e.target.value } : fila))}>
                <option value="">Elige el área</option>
                {areas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Peso (%)" htmlFor={`peso-${item.id}`} requerido>
              <Entrada id={`peso-${item.id}`} name={`peso_${item.id}`} type="number" min={1} max={100} step={1} required value={item.peso || ''} onChange={(e) => setSeleccion((actual) => actual.map((fila) => fila.id === item.id ? { ...fila, peso: Number(e.target.value) } : fila))} className="tabular text-right" />
            </Campo>
            <Boton type="button" variante="fantasma" tamano="sm" disabled={existentes.has(item.id)} onClick={() => setSeleccion((actual) => actual.filter((fila) => fila.id !== item.id))} aria-label={`Quitar ${nombre}`} title={existentes.has(item.id) ? 'Una etapa ya guardada conserva su historial' : undefined}>Quitar</Boton>
          </div>
        })}
      </div>
      <p className={`text-sm tabular ${total === 100 ? 'text-exito' : 'text-peligro'}`} role="status">Peso total: {total} % de 100 %</p>
      {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
      <Boton type="submit" tamano="sm" cargando={enviando} disabled={seleccion.length === 0 || total !== 100}>Guardar etapas</Boton>
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

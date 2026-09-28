'use client'

import { CalendarDays } from 'lucide-react'
import Link from 'next/link'
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

type Etapa = Vistas<'ot_tablero_etapas'> & { observaciones: string | null; area_id: string | null; peso_pct: number | null; horas_reales: number | null }
type Area = { id: string; nombre: string; codigo: string }
type ActividadPorVincular = { id: string; nombre: string; area_id: string }

export function Etapas({
  ordenId,
  etapas,
  areas,
  actividadesPorVincular,
  hoy,
  esNueva,
  puedeDefinir,
  puedeProgramar,
}: {
  ordenId: string
  etapas: Etapa[]
  areas: Area[]
  actividadesPorVincular: ActividadPorVincular[]
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
            Esta orden todavía no tiene etapas. Diseño debe crearlas para programar el trabajo.
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
        descripcion={etapas.length === 0
          ? 'Diseño define las etapas y sus porcentajes. Administración programa las fechas después.'
          : esNueva
            ? 'El avance sale de los reportes de tareas y revisiones de planos; las fechas controlan los plazos.'
            : 'Esta OT conserva su plan histórico: el avance se pondera por las horas estimadas de cada etapa.'}
        acciones={vencidas > 0 ? <Insignia tono="peligro">{vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}</Insignia> : null}
      />
      <TarjetaCuerpo className="space-y-2 p-2">
        {etapas.length > 0 && puedeDefinir && <p className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-sm text-texto-suave">
          Etapas definidas. Continúa en <Link href={`/ordenes/${ordenId}?vista=planos`} className="font-medium text-acento underline">Planos y revisiones</Link>; Administración pondrá las fechas.
        </p>}
        {etapas.length > 0 && puedeProgramar && <p className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-sm text-texto-suave">
          Programa el inicio y fin de cada etapa con su botón «Programar».
        </p>}
        {puedeDefinir && (etapas.length === 0
          ? <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 p-4 sm:p-5">
              <FormularioDefinicion ordenId={ordenId} areas={areas} etapas={[]} conversion={!esNueva}
                actividadesPorVincular={actividadesPorVincular} />
            </div>
          : <details className="rounded-[var(--radius-base)] border border-borde p-3">
              <summary className="cursor-pointer text-sm font-medium text-texto">Editar etapas de la OT</summary>
              <FormularioDefinicion ordenId={ordenId} areas={areas}
                etapas={etapas} conversion={false} actividadesPorVincular={[]} />
            </details>)}
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
function FormularioDefinicion({ ordenId, areas, etapas, conversion, actividadesPorVincular }: {
  ordenId: string
  areas: Area[]
  etapas: Etapa[]
  conversion: boolean
  actividadesPorVincular: ActividadPorVincular[]
}) {
  const { alEnviar, enviando, error } = useEnvio(definirEtapas)
  const [seleccion, setSeleccion] = useState(() => etapas
    .filter((e) => e.etapa_id !== null)
    .map((e) => ({ id: e.etapa_id!, nombre: e.etapa ?? '', area: e.area_id ?? '', peso: e.peso_pct ?? 0,
      avance: e.avance_porcentaje ?? 0,
      iniciada: e.fecha_inicio_real !== null || e.fecha_fin_real !== null || (e.horas_reales ?? 0) > 0 })))
  const [etapaActividad, setEtapaActividad] = useState('')
  const total = seleccion.reduce((suma, item) => suma + Number(item.peso || 0), 0)
  const etapasDiseno = seleccion.filter((item) => areas.find((area) => area.id === item.area)?.codigo === 'DIS')
  const actividadExistente = actividadesPorVincular[0]
  const etapasDeActividad = seleccion.filter((item) => item.area === actividadExistente?.area_id)
  const etapaActividadElegida = etapaActividad || (etapasDeActividad.length === 1 ? etapasDeActividad[0].id : '')
  const areaActividad = areas.find((area) => area.id === actividadExistente?.area_id)?.nombre ?? 'Producción'
  const bloqueos = [
    seleccion.length === 0 ? 'Agrega al menos una etapa.' : null,
    seleccion.length > 0 && total !== 100 ? `Reparte el 100 %; ahora suman ${total} %.` : null,
    conversion && etapasDiseno.length !== 1 ? 'Incluye exactamente una etapa de Diseño para vincular el plano existente.' : null,
    conversion && actividadesPorVincular.length !== 1 ? 'No se pudo identificar la actividad histórica; recarga la orden.' : null,
    conversion && actividadExistente && etapasDeActividad.length === 0
      ? `«${actividadExistente.nombre}» pertenece a ${areaActividad}. Agrega una etapa de esa área para conservarla.` : null,
    conversion && etapasDeActividad.length > 0 && !etapasDeActividad.some((item) => item.id === etapaActividadElegida)
      ? `Elige la etapa de ${areaActividad} para «${actividadExistente?.nombre}».` : null,
  ].filter((mensaje): mensaje is string => typeof mensaje === 'string')
  function mover(indice: number, cambio: number) {
    const copia = [...seleccion]
    const [item] = copia.splice(indice, 1)
    copia.splice(indice + cambio, 0, item)
    setSeleccion(copia)
  }
  return (
    <form onSubmit={alEnviar} className="max-w-5xl space-y-5">
      <input type="hidden" name="orden_id" value={ordenId} />
      {conversion && <input type="hidden" name="conversion" value="1" />}
      <div>
        <h3 className="text-base font-semibold text-texto">Definir etapas de esta OT</h3>
        <p className="mt-1 text-sm text-texto-suave">Crea cada etapa con su área responsable y reparte el 100 % del avance. Administración añadirá las fechas.</p>
      </div>
      {seleccion.length === 0 && <div className="rounded-[var(--radius-base)] border border-dashed border-borde-fuerte bg-superficie px-4 py-6 text-center">
        <p className="text-sm font-medium text-texto">Aún no hay etapas</p>
        <p className="mt-1 text-xs text-texto-suave">Agrega la primera para organizar el trabajo de esta orden.</p>
      </div>}
      <div className="space-y-2">
        {seleccion.map((item, indice) => {
          const etiqueta = item.nombre.trim() || `Etapa ${indice + 1}`
          return <div key={item.id} className="rounded-[var(--radius-base)] border border-borde bg-superficie p-3">
            <input type="hidden" name="etapa_id" value={item.id} />
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-texto">Etapa {indice + 1}</span>
              <div className="flex items-center gap-1">
                <Boton type="button" variante="fantasma" tamano="sm" disabled={indice === 0} onClick={() => mover(indice, -1)} aria-label={`Subir ${etiqueta}`}>↑</Boton>
                <Boton type="button" variante="fantasma" tamano="sm" disabled={indice === seleccion.length - 1} onClick={() => mover(indice, 1)} aria-label={`Bajar ${etiqueta}`}>↓</Boton>
                <Boton type="button" variante="fantasma" tamano="sm" disabled={item.avance > 0 || item.iniciada}
                  onClick={() => setSeleccion((actual) => actual.filter((fila) => fila.id !== item.id))}
                  aria-label={`Quitar ${etiqueta}`} title={item.avance > 0 || item.iniciada ? 'La etapa ya tiene avance' : undefined}>Quitar</Boton>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_7rem] sm:items-end">
              <Campo etiqueta="Nombre" htmlFor={`nombre-${item.id}`} requerido>
                <Entrada id={`nombre-${item.id}`} name={`nombre_${item.id}`} value={item.nombre} minLength={2} maxLength={120} required
                  onChange={(e) => setSeleccion((actual) => actual.map((fila) => fila.id === item.id ? { ...fila, nombre: e.target.value } : fila))} />
              </Campo>
              <Campo etiqueta="Área responsable" htmlFor={`area-${item.id}`} requerido>
                <Seleccion id={`area-${item.id}`} name={`area_${item.id}`} required value={item.area} onChange={(e) => setSeleccion((actual) => actual.map((fila) => fila.id === item.id ? { ...fila, area: e.target.value } : fila))}>
                  <option value="">Elige el área</option>
                  {areas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}
                </Seleccion>
              </Campo>
              <Campo etiqueta="Peso (%)" htmlFor={`peso-${item.id}`} requerido>
                <Entrada id={`peso-${item.id}`} name={`peso_${item.id}`} type="number" min={1} max={100} step={1} required value={item.peso || ''} onChange={(e) => setSeleccion((actual) => actual.map((fila) => fila.id === item.id ? { ...fila, peso: Number(e.target.value) } : fila))} className="tabular text-right" />
              </Campo>
            </div>
          </div>
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Boton type="button" variante={seleccion.length === 0 ? 'primario' : 'secundario'} tamano="sm" onClick={() => setSeleccion((actual) => [
          ...actual, { id: crypto.randomUUID(), nombre: '', area: '', peso: 0, avance: 0, iniciada: false },
        ])}>+ Agregar etapa</Boton>
        {seleccion.length > 0 && <p className={`text-sm font-medium tabular ${total === 100 ? 'text-exito' : total > 100 ? 'text-peligro' : 'text-texto-suave'}`} role="status">Porcentaje asignado: {total} % de 100 %</p>}
      </div>
      {conversion && seleccion.length > 0 && actividadesPorVincular.map((actividad) => (
        <Campo key={actividad.id} etiqueta={`Actividad existente: ${actividad.nombre}`} htmlFor="etapa-actividad" requerido>
          <Seleccion id="etapa-actividad" name="etapa_actividad" required value={etapaActividadElegida}
            onChange={(e) => setEtapaActividad(e.target.value)}>
            <option value="">Elige la etapa de su área</option>
            {seleccion.filter((item) => item.area === actividad.area_id).map((item) => (
              <option key={item.id} value={item.id}>{item.nombre || 'Etapa sin nombre'}</option>
            ))}
          </Seleccion>
        </Campo>
      ))}
      {conversion && <p className="text-xs text-texto-suave">El plano y la actividad históricos se conservarán y quedarán vinculados a las etapas que elijas.</p>}
      {bloqueos.length > 0 && <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm text-texto" role="status">
        <p className="font-medium">Para guardar falta:</p>
        <ul className="mt-1 list-inside list-disc space-y-1">{bloqueos.map((bloqueo) => <li key={bloqueo}>{bloqueo}</li>)}</ul>
      </div>}
      {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
      <Boton type="submit" tamano="sm" cargando={enviando}
        disabled={bloqueos.length > 0}>
        Guardar etapas
      </Boton>
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

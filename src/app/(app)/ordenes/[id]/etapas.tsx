'use client'

import { CalendarDays, Pencil } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_ETAPA, definir } from '@/lib/dominio/estados'
import { programaDeEtapa } from '@/lib/dominio/programa-etapa'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import { cn } from '@/lib/utils'
import type { Vistas } from '@/types/database'

import { definirEtapas, programarEtapa } from './acciones-etapas'

type Etapa = Vistas<'ot_tablero_etapas'> & { observaciones: string | null; area_id: string | null; peso_pct: number | null; horas_reales: number | null; creado_en: string | null }
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
  // Corregir o agregar etapas reemplaza la lista por el formulario: las dos a
  // la vez repetían cada etapa en pantalla.
  const [editando, setEditando] = useState(false)

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
  const terminadas = etapas.filter((e) => e.estado === 'TERMINADA').length
  // Diseño guarda las etapas por partes: lo que todavía no repartió cuenta como
  // pendiente en el avance de la OT, y aquí se dice cuánto es.
  const contemplado = Math.round(etapas.reduce((suma, e) => suma + Number(e.peso_pct ?? 0), 0) * 100) / 100
  const faltaContemplar = Math.max(0, Math.round((100 - contemplado) * 100) / 100)

  // Los avisos de quién hace qué («Diseño puede vincular cada plano…»,
  // «Programa el inicio y fin…») se retiraron el 2026-10-01: confundían más de
  // lo que ayudaban. Lo dicen los botones de cada uno.
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Etapas de producción"
        descripcion={etapas.length === 0
          ? 'Diseño define las etapas y sus porcentajes. Administración programa las fechas después.'
          : `${etapas.length} ${etapas.length === 1 ? 'etapa' : 'etapas'} · ${terminadas} ${terminadas === 1 ? 'terminada' : 'terminadas'}. ${esNueva
            ? 'El avance sale de los reportes de tareas y de las revisiones de planos.'
            : 'Esta OT conserva su plan histórico: el avance se pondera por las horas estimadas de cada etapa.'}`}
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            {vencidas > 0 && <Insignia tono="peligro">{vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}</Insignia>}
            {puedeDefinir && etapas.length > 0 && !editando && (
              <Boton variante="secundario" tamano="sm" onClick={() => setEditando(true)}>
                <Pencil aria-hidden className="size-3.5" />
                Editar o agregar etapa
              </Boton>
            )}
          </div>
        }
      />
      <TarjetaCuerpo className="space-y-3 p-3 sm:p-4">
        {esNueva && etapas.length > 0 && !editando && (
          <div className="rounded-[var(--radius-base)] border border-borde p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-texto">Contemplado en etapas: <strong className="tabular">{cantidad(contemplado)} %</strong></span>
              <span className={faltaContemplar > 0 ? 'text-aviso' : 'text-exito'}>
                {faltaContemplar > 0 ? <>Falta contemplar: <strong className="tabular">{cantidad(faltaContemplar)} %</strong></> : 'El 100 % está contemplado'}
              </span>
            </div>
            <Progreso valor={contemplado} etiqueta="Porcentaje contemplado en etapas" alto="sm" />
            {faltaContemplar > 0 && (
              <p className="mt-2 text-xs text-texto-suave">Mientras falte, esa parte cuenta como pendiente en el avance de la OT.</p>
            )}
          </div>
        )}
        {puedeDefinir && (etapas.length === 0 || editando) ? (
          <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 p-4 sm:p-5">
            <FormularioDefinicion ordenId={ordenId} areas={areas} etapas={etapas}
              conversion={etapas.length === 0 && !esNueva}
              actividadesPorVincular={etapas.length === 0 ? actividadesPorVincular : []}
              alTerminar={etapas.length > 0 ? () => setEditando(false) : undefined}
              alCancelar={etapas.length > 0 ? () => setEditando(false) : undefined} />
          </div>
        ) : (
          <ol className="space-y-2">
            {etapas.map((etapa) => {
              const estado = definir(ESTADO_ETAPA, etapa.estado)
              const programa = programaDeEtapa(etapa, hoy)
              const area = etapa.area_id ? areas.find((a) => a.id === etapa.area_id)?.nombre ?? 'Área asignada' : null
              const abierta = programando === etapa.etapa_id

              return (
                <li
                  key={etapa.etapa_id}
                  id={`etapa-${etapa.etapa_id}`}
                  className={cn(
                    'scroll-mt-20 rounded-[var(--radius-base)] border p-3 sm:p-4',
                    programa.vencida ? 'border-peligro/40' : 'border-borde',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-superficie-2 text-xs font-semibold text-texto-suave">
                      {etapa.orden_secuencia}
                    </span>

                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-sm font-medium text-texto">{etapa.etapa}</p>
                      <p className="mt-0.5 text-xs text-texto-suave">
                        {[
                          area,
                          etapa.peso_pct !== null ? `${cantidad(etapa.peso_pct)} % del avance` : null,
                          // Las horas solo pesan en el plan histórico; en las OT
                          // nuevas valen 0 y decirlo era ruido.
                          Number(etapa.horas_estimadas ?? 0) > 0 ? `${cantidad(etapa.horas_estimadas)} h estimadas` : null,
                          etapa.fecha_fin_real ? `terminada el ${fecha(etapa.fecha_fin_real)}` : null,
                          // Cuándo la guardó Diseño: lo pidió Diseño (2026-10-01).
                          etapa.creado_en ? `guardada el ${fechaHora(etapa.creado_en)}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-texto-suave">
                        <CalendarDays aria-hidden className="size-3.5 shrink-0" />
                        {programa.inicio || programa.fin ? (
                          <span className="tabular">{fecha(programa.inicio) ?? '—'} → {fecha(programa.fin) ?? '—'}</span>
                        ) : (
                          <span className="text-texto-tenue">Sin fechas programadas</span>
                        )}
                        {programa.vencida && <Insignia tono="peligro">Vencida</Insignia>}
                        {programa.tocaAhora && <Insignia tono="aviso">Toca ahora</Insignia>}
                      </p>
                    </div>

                    {/* La barra ocupa la línea entera en el teléfono, donde si no
                        se queda apretada entre el nombre y la insignia. */}
                    <div className="flex w-full items-center gap-3 sm:w-auto">
                      <Progreso valor={etapa.avance_porcentaje} mostrarValor alto="sm" className="flex-1 sm:w-44 sm:flex-none" />
                      <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                    </div>

                    {puedeProgramar && (
                      <Boton variante={abierta ? 'fantasma' : 'secundario'} tamano="sm"
                        onClick={() => setProgramando(abierta ? null : etapa.etapa_id)}
                        aria-expanded={abierta}>
                        {abierta ? 'Cerrar' : programa.inicio || programa.fin ? 'Cambiar fechas' : 'Programar fechas'}
                      </Boton>
                    )}
                  </div>

                  {abierta && (
                    <FormularioProgramacion ordenId={ordenId} etapa={etapa}
                      alTerminar={() => setProgramando(null)} />
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
function FormularioDefinicion({ ordenId, areas, etapas, conversion, actividadesPorVincular, alTerminar, alCancelar }: {
  ordenId: string
  areas: Area[]
  etapas: Etapa[]
  conversion: boolean
  actividadesPorVincular: ActividadPorVincular[]
  /** Guardadas las etapas, vuelve a la lista. */
  alTerminar?: () => void
  /** Sin cambios, vuelve a la lista. */
  alCancelar?: () => void
}) {
  const { alEnviar, enviando, error, resultado } = useEnvio(definirEtapas, alTerminar)
  const corrigiendo = etapas.length > 0
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
    total > 100 ? `Las etapas suman ${total} %: baja alguna, no pueden pasar de 100 %.` : null,
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
        <h3 className="text-base font-semibold text-texto">{corrigiendo ? 'Editar o agregar etapas' : 'Definir etapas de esta OT'}</h3>
        <p className="mt-1 text-sm text-texto-suave">
          {corrigiendo
            ? 'Cambia el nombre, el área o el peso de cada etapa, o agrega otra. Se puede guardar por partes hasta llegar al 100 %; una etapa con avance no se quita.'
            : 'Crea cada etapa con su área responsable y su peso. Puedes guardar por partes: lo que falte para el 100 % queda por contemplar y se completa después. Administración añadirá las fechas.'}
        </p>
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
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)_8rem] lg:items-end">
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
        {seleccion.length > 0 && <p className={`text-sm font-medium tabular ${total === 100 ? 'text-exito' : total > 100 ? 'text-peligro' : 'text-texto-suave'}`} role="status">
          Contemplado: {total} %{total < 100 ? ` · falta contemplar ${100 - total} %` : total === 100 ? ' · completo' : ''}
        </p>}
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
      {resultado?.ok && <p role="status" className="text-sm text-exito">{resultado.mensaje}</p>}
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" tamano="sm" cargando={enviando}
          disabled={bloqueos.length > 0}>
          Guardar etapas
        </Boton>
        {alCancelar && (
          <Boton type="button" variante="fantasma" tamano="sm" onClick={alCancelar} disabled={enviando}>
            Cancelar
          </Boton>
        )}
      </div>
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
    <form onSubmit={alEnviar} className="mt-3 grid min-w-0 gap-3 border-t border-borde pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="etapa_id" value={etapa.etapa_id ?? ''} />
      <Campo etiqueta="Inicio programado" htmlFor={`inicio-${etapa.etapa_id}`} className="min-w-0">
        <Entrada id={`inicio-${etapa.etapa_id}`} name="inicio" type="date" className="min-w-0 max-w-full"
          defaultValue={etapa.fecha_inicio_programada ?? ''} required />
      </Campo>
      <Campo etiqueta="Fin programado" htmlFor={`fin-${etapa.etapa_id}`} className="min-w-0">
        <Entrada id={`fin-${etapa.etapa_id}`} name="fin" type="date" className="min-w-0 max-w-full"
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

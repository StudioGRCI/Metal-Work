'use client'

import { CalendarDays, Plus, Trash2, TrendingUp, Truck } from 'lucide-react'
import { useState } from 'react'

import { CampoPorcentaje, FechaDelReporte } from '@/components/avance/campos-reporte'
import { CorregirReporte } from '@/components/avance/corregir-reporte'
import { RevisarReporte } from '@/components/avance/revisar-reporte'
import { InsigniaRevision, NotaRevision } from '@/components/avance/revision'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Progreso } from '@/components/ui/progreso'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { Ventana } from '@/components/ui/ventana'
import type {
  ActividadArea,
  AvanceDeArea,
  ReporteDiario,
} from '@/lib/datos/actividades'
import { fecha as fmtFecha, hoyLima, numero } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import { cn } from '@/lib/utils'

import {
  agregarActividad,
  cambiarPesoActividad,
  quitarActividad,
  reportarAvance,
} from './acciones-actividades'

function Error_({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * La hoja de avance de cada área.
 *
 * Producción arma las actividades de la carrocería y Maestranza las suyas por
 * pieza solicitada. Cada área tiene su propio 100 % —no se suman entre ellas—
 * y el reporte es lo del día: «hoy avancé 15 %», que es lo que el jefe quiere
 * dejar escrito al cerrar la jornada.
 */
export function ActividadesDeOrden({
  ordenId,
  actividades,
  areas,
  diario,
  areasDisponibles,
  puedeArmar,
  puedeReportar,
  areaPropia,
  aprueba,
  corregibles,
}: {
  ordenId: string
  actividades: ActividadArea[]
  areas: AvanceDeArea[]
  diario: ReporteDiario[]
  areasDisponibles: { id: string; codigo: string; nombre: string }[]
  /** `produccion.actividades`: el jefe de maestranza y el supervisor. */
  puedeArmar: boolean
  /** `produccion.registrar`: quien reporta el día. */
  puedeReportar: boolean
  /** El área de quien mira, para proponerla al armar la lista. */
  areaPropia: string | null
  /** `produccion.aprobar_reportes`: el jefe de producción aprueba u observa. */
  aprueba: boolean
  /** Los reportes del diario que esta persona puede corregir, decidido en el servidor. */
  corregibles: string[]
}) {
  const [agregando, setAgregando] = useState(false)
  const hoy = hoyLima()
  const puedeCorregir = new Set(corregibles)

  const porArea = areasDisponibles
    .map((a) => ({
      area: a,
      resumen: areas.find((r) => r.area_id === a.id) ?? null,
      lista: actividades.filter((x) => x.area_id === a.id),
    }))
    .filter((g) => g.lista.length > 0)

  return (
    <div className="space-y-4">
      <Tarjeta>
        <TarjetaCabecera
          titulo="Avance por área"
          descripcion="Cada área arma su lista y reporta lo que avanzó cada día. Producción por carrocería, Maestranza por pieza solicitada. Cada una tiene su propio 100 %."
          acciones={
            puedeArmar && !agregando ? (
              <Boton variante="secundario" tamano="sm" onClick={() => setAgregando(true)}>
                <Plus aria-hidden className="size-3.5" />
                Nueva actividad
              </Boton>
            ) : null
          }
        />
        <TarjetaCuerpo>
          {areas.length === 0 ? (
            <p className="text-sm text-texto-suave">
              {puedeArmar
                ? 'Todavía no hay actividades. Arma la lista de tu área con el botón de arriba: cada actividad con lo que pesa, y después se reporta el avance de cada día.'
                : 'El jefe del área todavía no armó su lista de actividades.'}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {areas.map((a) => (
                <div key={a.area_id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-texto">{a.area}</p>
                    <p className="text-lg font-semibold tabular text-texto">
                      {numero(a.avance_pct, 1)} %
                    </p>
                  </div>
                  <Progreso valor={Number(a.avance_pct)} />
                  <p className="mt-1 text-[11px] text-texto-suave">
                    {a.terminadas} de {a.actividades} terminadas
                    {Number(a.peso_repartido) < 100 && (
                      <span className="text-aviso">
                        {' '}
                        · le falta repartir {numero(100 - Number(a.peso_repartido), 0)} % de peso
                      </span>
                    )}
                  </p>
                  {a.ultimo_reporte && (
                    <p className="text-[11px] text-texto-tenue">
                      último reporte: {fmtFecha(a.ultimo_reporte)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {agregando && puedeArmar && (
        <NuevaActividad
          ordenId={ordenId}
          areas={areasDisponibles}
          areaPropia={areaPropia}
          alCerrar={() => setAgregando(false)}
        />
      )}

      {porArea.map(({ area, lista }) => (
        <Tarjeta key={area.id}>
          <TarjetaCabecera
            titulo={area.nombre}
            descripcion={
              area.codigo === 'MTZ'
                ? 'Lo que Maestranza habilita, por pieza solicitada.'
                : 'Lo que hace el área en esta unidad.'
            }
          />
          <TarjetaCuerpo className="p-0">
            <Tabla>
              <TablaCabecera>
                <TR>
                  <TH className="w-10">#</TH>
                  <TH>Actividad</TH>
                  <TH className="text-right">Pesa</TH>
                  <TH className="w-48">Avance</TH>
                  <TH>Último</TH>
                  {(puedeReportar || puedeArmar) && <TH className="w-64" />}
                </TR>
              </TablaCabecera>
              <tbody>
                {lista.map((act) => {
                  const deHoy = diario.find((r) => r.actividad_id === act.id && r.fecha === hoy)
                  return (
                  <TR key={act.id}>
                    <TD className="text-xs text-texto-tenue">{act.orden_secuencia}</TD>
                    <TD>
                      <p className="text-sm font-medium text-texto">{act.nombre}</p>
                      {(act.referencia || act.detalle) && (
                        <p className="text-[11px] text-texto-suave">
                          {[act.referencia, act.detalle].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </TD>
                    <TD className="text-right tabular text-sm">{numero(act.peso_pct, 0)} %</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Progreso valor={Number(act.avance_pct)} />
                        <span
                          className={cn(
                            'tabular text-xs',
                            act.terminada ? 'text-exito' : 'text-texto-suave',
                          )}
                        >
                          {numero(act.avance_pct, 0)} %
                        </span>
                      </div>
                    </TD>
                    <TD className="text-xs text-texto-suave">
                      {act.ultimo_reporte ? fmtFecha(act.ultimo_reporte) : 'sin reportes'}
                    </TD>
                    {(puedeReportar || puedeArmar) && (
                      <TD>
                        <AccionesActividad
                          actividad={act}
                          ordenId={ordenId}
                          puedeArmar={puedeArmar}
                          puedeReportar={puedeReportar}
                          deHoy={deHoy ?? null}
                          corregibleHoy={deHoy ? puedeCorregir.has(deHoy.id) : false}
                        />
                      </TD>
                    )}
                  </TR>
                  )
                })}
              </tbody>
            </Tabla>
          </TarjetaCuerpo>
        </Tarjeta>
      ))}

      {diario.length > 0 && (
        <Tarjeta>
          <TarjetaCabecera
            titulo="Diario de la unidad"
            descripcion="Lo reportado día por día, lo más reciente arriba, con el visto del jefe de producción."
          />
          <TarjetaCuerpo className="p-0">
            <ul className="divide-y divide-[var(--borde)]">
              {diario.map((r) => {
                const revisa = aprueba && r.revision !== 'APROBADO'
                const corrige = puedeCorregir.has(r.id)
                return (
                  <li key={r.id} className="space-y-2 px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <CalendarDays aria-hidden className="size-4 shrink-0 text-texto-tenue" />
                      <span className="tabular text-xs text-texto-suave">{fmtFecha(r.fecha)}</span>
                      <span className="text-sm font-medium text-texto">{r.actividad}</span>
                      <span className="tabular text-sm text-exito">+{numero(r.avance_pct, 0)} %</span>
                      {r.nota && <span className="text-xs text-texto-suave">· {r.nota}</span>}
                      <span className="ml-auto flex items-center gap-2">
                        <InsigniaRevision revision={r.revision} />
                        {r.reportado_por_nombre && (
                          <span className="text-[11px] text-texto-tenue">{r.reportado_por_nombre}</span>
                        )}
                      </span>
                    </div>
                    <NotaRevision r={r} />
                    {(revisa || corrige) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {revisa && <RevisarReporte clase="hoja" id={r.id} revision={r.revision} />}
                        {corrige && (
                          <CorregirReporte
                            reporte={{
                              clase: 'hoja',
                              id: r.id,
                              fecha: r.fecha,
                              actividad: r.actividad,
                              avance_pct: Number(r.avance_pct),
                              nota: r.nota,
                              tope: 100 - (Number(r.acumulado_pct ?? 0) - Number(r.avance_pct)),
                            }}
                            observacion={r.revision === 'OBSERVADO' ? r.observacion : null}
                            destacado={r.revision === 'OBSERVADO'}
                          />
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </div>
  )
}

/**
 * El reporte del día de una actividad, en una ventana: en el teléfono la tabla
 * no deja lugar para un formulario en la celda. Lo del día con un toque —25,
 * 50, 75, 100, hasta lo que le falta— y la fecha de hoy ya puesta.
 */
function ReportarDia({
  actividad,
  ordenId,
  deOtroDia = false,
}: {
  actividad: ActividadArea
  ordenId: string
  /** Para el día que se olvidó, cuando el de hoy ya está. */
  deOtroDia?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
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
      {aviso && (
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
        <form onSubmit={alEnviar} className="space-y-4">
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

          <FechaDelReporte id={`${prefijo}-fecha`} deOtroDia={deOtroDia} />

          <Error_ texto={error} />

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="lg" cargando={enviando} className="w-full sm:w-auto">
              Reportar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

function AccionesActividad({
  actividad,
  ordenId,
  puedeArmar,
  puedeReportar,
  deHoy,
  corregibleHoy,
}: {
  actividad: ActividadArea
  ordenId: string
  puedeArmar: boolean
  puedeReportar: boolean
  /** El reporte de hoy de esta actividad, si ya lo hay: se corrige, no se repite. */
  deHoy: ReporteDiario | null
  corregibleHoy: boolean
}) {
  const [modo, setModo] = useState<'nada' | 'peso'>('nada')
  const peso = useEnvio(cambiarPesoActividad, () => setModo('nada'))
  const quitar = useEnvio(quitarActividad)

  if (modo === 'peso') {
    return (
      <form onSubmit={peso.alEnviar} className="flex items-end gap-1">
        <input type="hidden" name="id" value={actividad.id} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <Entrada
          aria-label={`Peso de ${actividad.nombre}`}
          name="peso_pct"
          type="number"
          min={0}
          max={100}
          step="1"
          defaultValue={actividad.peso_pct}
          autoFocus
          className="tabular w-20 text-right"
        />
        <Boton type="submit" tamano="sm" cargando={peso.enviando}>
          Guardar
        </Boton>
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setModo('nada')}>
          Cerrar
        </Boton>
        {peso.error && <Error_ texto={peso.error} />}
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* Un solo reporte por actividad y día (uq_avance_del_dia): si el de hoy
          ya está, el botón es para corregirlo, y el de reportar queda para el
          día que se olvidó. */}
      {puedeReportar && deHoy ? (
        <>
          {corregibleHoy ? (
            <CorregirReporte
              reporte={{
                clase: 'hoja',
                id: deHoy.id,
                fecha: deHoy.fecha,
                actividad: actividad.nombre,
                avance_pct: Number(deHoy.avance_pct),
                nota: deHoy.nota,
                tope: 100 - (Number(actividad.avance_pct) - Number(deHoy.avance_pct)),
              }}
              observacion={deHoy.revision === 'OBSERVADO' ? deHoy.observacion : null}
              etiqueta="Corregir el de hoy"
              destacado={deHoy.revision === 'OBSERVADO'}
            />
          ) : (
            <span className="px-1 text-xs text-texto-suave">Hoy ya reportado</span>
          )}
          {!actividad.terminada && <ReportarDia actividad={actividad} ordenId={ordenId} deOtroDia />}
        </>
      ) : (
        puedeReportar &&
        !actividad.terminada && <ReportarDia actividad={actividad} ordenId={ordenId} />
      )}
      {puedeArmar && (
        <>
          <Boton variante="fantasma" tamano="sm" onClick={() => setModo('peso')}>
            Peso
          </Boton>
          <form onSubmit={quitar.alEnviar}>
            <input type="hidden" name="id" value={actividad.id} />
            <input type="hidden" name="orden_id" value={ordenId} />
            <Boton
              type="submit"
              variante="fantasma"
              tamano="sm"
              cargando={quitar.enviando}
              aria-label={`Quitar ${actividad.nombre}`}
            >
              <Trash2 aria-hidden className="size-4 text-peligro" />
            </Boton>
          </form>
        </>
      )}
      {quitar.error && <Error_ texto={quitar.error} />}
    </div>
  )
}

function NuevaActividad({
  ordenId,
  areas,
  areaPropia,
  alCerrar,
}: {
  ordenId: string
  areas: { id: string; codigo: string; nombre: string }[]
  areaPropia: string | null
  alCerrar: () => void
}) {
  const { alEnviar, enviando, error } = useEnvio(agregarActividad, alCerrar)

  return (
    <Tarjeta className="border-acento">
      <TarjetaCabecera
        titulo="Nueva actividad"
        descripcion="Qué trabajo es y cuánto pesa dentro del 100 % de su área. Para Maestranza, la pieza solicitada va en «referencia»."
      />
      <TarjetaCuerpo>
        <form onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="orden_id" value={ordenId} />

          <Campo etiqueta="Área" htmlFor="na-area" requerido>
            <Seleccion id="na-area" name="area_id" required defaultValue={areaPropia ?? ''}>
              <option value="" disabled>
                Elige una
              </option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Actividad" htmlFor="na-nombre" requerido className="sm:col-span-3">
            <Entrada
              id="na-nombre"
              name="nombre"
              required
              placeholder="Armado de estructura del cajón"
            />
          </Campo>

          <Campo etiqueta="Pesa" htmlFor="na-peso" ayuda="% de su área">
            <Entrada
              id="na-peso"
              name="peso_pct"
              type="number"
              min={0}
              max={100}
              step="1"
              defaultValue={0}
              className="tabular"
            />
          </Campo>

          <Campo etiqueta="N.º" htmlFor="na-orden" ayuda="Orden">
            <Entrada
              id="na-orden"
              name="orden_secuencia"
              type="number"
              min={1}
              step="1"
              defaultValue={1}
              className="tabular"
            />
          </Campo>

          <Campo
            etiqueta="Referencia"
            htmlFor="na-ref"
            ayuda="La pieza solicitada, si es de Maestranza"
            className="sm:col-span-2"
          >
            <Entrada id="na-ref" name="referencia" placeholder="PZ-14" />
          </Campo>

          <Campo etiqueta="Detalle" htmlFor="na-detalle" className="sm:col-span-4">
            <AreaTexto id="na-detalle" name="detalle" rows={2} placeholder="Opcional" />
          </Campo>

          {error && (
            <div className="sm:col-span-6">
              <Error_ texto={error} />
            </div>
          )}

          <div className="flex justify-end gap-2 sm:col-span-6">
            <Boton type="button" variante="fantasma" tamano="sm" onClick={alCerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="sm" cargando={enviando}>
              <Truck aria-hidden className="size-4" />
              Agregar a la lista
            </Boton>
          </div>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

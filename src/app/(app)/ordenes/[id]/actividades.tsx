'use client'

import { CalendarDays, CheckCheck, MessageSquareWarning, Pencil, Plus, Trash2, Truck } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { CorregirReporte } from '@/components/avance/corregir-reporte'
import { EliminarReporte } from '@/components/avance/eliminar-reporte'
import { ReportarArea } from '@/components/avance/reportar-area'
import { ReportarDia } from '@/components/avance/reportar-dia'
import { RevisarReporte } from '@/components/avance/revisar-reporte'
import { InsigniaRevision, NotaRevision } from '@/components/avance/revision'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
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
  aprobarHojaDeOrden,
  cambiarPesoActividad,
  editarActividad,
  quitarActividad,
} from './acciones-actividades'
import { CargarCronograma } from './cargar-cronograma'

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
  areasVisibles,
  puedeArmar,
  puedeReportar,
  areaPropia,
  aprueba,
  corregibles,
  eliminables,
}: {
  ordenId: string
  actividades: ActividadArea[]
  areas: AvanceDeArea[]
  diario: ReporteDiario[]
  /** Las áreas cuya lista puede armar: las que se ofrecen al agregar o cargar el cronograma. */
  areasDisponibles: { id: string; codigo: string; nombre: string }[]
  /**
   * Las áreas cuya hoja ve con sus actividades: las que arma y las de su mano.
   * No es lo mismo que `areasDisponibles`: el operario no arma la lista, pero
   * tiene que ver la de su área para reportar el día.
   */
  areasVisibles: { id: string; codigo: string; nombre: string }[]
  /** Diseño para cualquier área; `produccion.actividades` para la suya (migración 106). */
  puedeArmar: boolean
  /** `produccion.registrar`: quien reporta el día. */
  puedeReportar: boolean
  /** El área de quien mira, para proponerla al armar la lista. */
  areaPropia: string | null
  /** `produccion.aprobar_reportes`: el jefe de producción aprueba u observa. */
  aprueba: boolean
  /** Los reportes del diario que esta persona puede corregir, decidido en el servidor. */
  corregibles: string[]
  /** Y los que puede borrar (migración 099), decidido igual. */
  eliminables: string[]
}) {
  const [agregando, setAgregando] = useState(false)
  const hoy = hoyLima()
  const puedeCorregir = new Set(corregibles)
  const puedeEliminar = new Set(eliminables)
  // Lo que el jefe observó y esta persona tiene que corregir: va primero en el
  // diario y con enlace, porque si no quedaba enterrado entre lo aprobado.
  const observadosMios = diario.filter((r) => r.revision === 'OBSERVADO' && puedeCorregir.has(r.id))
  const reportadaHoy = (actividadId: string) => diario.find((r) => r.actividad_id === actividadId && r.fecha === hoy)

  const porArea = areasVisibles
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
          descripcion="Diseño arma la lista de cada área y cada una reporta lo que avanzó cada día. Producción por carrocería, Maestranza por pieza solicitada. Cada una tiene su propio 100 %."
          acciones={
            puedeArmar && !agregando ? (
              <span className="flex flex-wrap gap-2">
                <CargarCronograma ordenId={ordenId} areasPropias={areasDisponibles} />
                <Boton variante="secundario" tamano="sm" onClick={() => setAgregando(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  Nueva actividad
                </Boton>
              </span>
            ) : null
          }
        />
        <TarjetaCuerpo>
          {areas.length === 0 ? (
            <p className="text-sm text-texto-suave">
              {puedeArmar
                ? 'Todavía no hay actividades. Arma la lista con el botón de arriba: cada actividad con su área y lo que pesa, y después cada área reporta el avance de cada día.'
                : 'Diseño todavía no armó la lista de actividades de esta orden.'}
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
          /* Lo que la actividad nueva propone por área: el peso que falta para
             llegar al 100 y el número que sigue. Antes nacía con 0 y 1 fijos y
             había que volver a corregirla fila por fila. */
          propuestas={Object.fromEntries(
            areasDisponibles.map((a) => {
              const resumen = areas.find((r) => r.area_id === a.id)
              const ultima = Math.max(0, ...actividades.filter((x) => x.area_id === a.id).map((x) => x.orden_secuencia))
              return [a.id, { peso: Math.max(0, 100 - Number(resumen?.peso_repartido ?? 0)), numero: ultima + 1 }]
            }),
          )}
          alCerrar={() => setAgregando(false)}
        />
      )}

      {porArea.map(({ area, lista }) => {
        // Las que hoy todavía no dijeron nada: el número en la cabecera y, para
        // quien reporta, una sola ventana con todas (en vez de una por actividad).
        const sinHoy = lista.filter((a) => !a.terminada && !reportadaHoy(a.id))
        const abiertas = lista.filter((a) => !a.terminada).length
        return (
        <Tarjeta key={area.id} id={`area-${area.codigo}`} className="scroll-mt-20">
          <TarjetaCabecera
            titulo={area.nombre}
            descripcion={
              area.codigo === 'MTZ'
                ? 'Lo que Maestranza habilita, por pieza solicitada.'
                : 'Lo que hace el área en esta unidad.'
            }
            acciones={
              abiertas > 0 ? (
                <span className="flex flex-wrap items-center gap-2">
                  {sinHoy.length > 0 ? (
                    <Insignia tono="aviso">{sinHoy.length} sin reporte de hoy</Insignia>
                  ) : (
                    <Insignia tono="exito">Todo reportado hoy</Insignia>
                  )}
                  {puedeReportar && (
                    <ReportarArea
                      ordenId={ordenId}
                      area={area}
                      actividades={sinHoy.map((a) => ({
                        id: a.id,
                        nombre: a.nombre,
                        avance_pct: a.avance_pct,
                        referencia: a.referencia,
                      }))}
                    />
                  )}
                </span>
              ) : null
            }
          />
          <TarjetaCuerpo className="p-0">
            {/* En el teléfono, una tarjeta por actividad con sus botones a la
                vista: la tabla obligaba a desplazarse de lado para llegar a
                «Reportar día». En el monitor, la tabla de siempre. */}
            <ul className="divide-y divide-borde sm:hidden">
              {lista.map((act) => {
                const deHoy = reportadaHoy(act.id)
                return (
                  <li key={act.id} id={`actividad-${act.id}`} className="scroll-mt-20 space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-texto">
                          <span className="tabular mr-1.5 text-xs text-texto-tenue">{act.orden_secuencia}</span>
                          {act.nombre}
                        </p>
                        {(act.referencia || act.detalle) && (
                          <p className="text-[11px] text-texto-suave">
                            {[act.referencia, act.detalle].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        <PlanDeActividad actividad={act} hoy={hoy} />
                      </div>
                      <span className="tabular shrink-0 text-xs text-texto-suave">pesa {numero(act.peso_pct, 0)} %</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progreso valor={Number(act.avance_pct)} />
                      <span className={cn('tabular text-xs', act.terminada ? 'text-exito' : 'text-texto-suave')}>
                        {numero(act.avance_pct, 0)} %
                      </span>
                    </div>
                    <p className="text-[11px] text-texto-tenue">
                      {act.ultimo_reporte ? `Último reporte: ${fmtFecha(act.ultimo_reporte)}` : 'Sin reportes'}
                    </p>
                    {(puedeReportar || puedeArmar) && (
                      <AccionesActividad
                        actividad={act}
                        ordenId={ordenId}
                        puedeArmar={puedeArmar}
                        puedeReportar={puedeReportar}
                        deHoy={deHoy ?? null}
                        corregibleHoy={deHoy ? puedeCorregir.has(deHoy.id) : false}
                      />
                    )}
                  </li>
                )
              })}
            </ul>

            <div className="hidden sm:block">
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
                  const deHoy = reportadaHoy(act.id)
                  return (
                  <TR key={act.id} id={`actividad-${act.id}`} className="scroll-mt-20">
                    <TD className="text-xs text-texto-tenue">{act.orden_secuencia}</TD>
                    <TD>
                      <p className="text-sm font-medium text-texto">{act.nombre}</p>
                      {(act.referencia || act.detalle) && (
                        <p className="text-[11px] text-texto-suave">
                          {[act.referencia, act.detalle].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      <PlanDeActividad actividad={act} hoy={hoy} />
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
            </div>
          </TarjetaCuerpo>
        </Tarjeta>
        )
      })}

      {diario.length > 0 && (
        <Tarjeta>
          <TarjetaCabecera
            titulo="Diario de la unidad"
            descripcion="Lo reportado día por día, lo más reciente arriba, con el visto del jefe de producción."
            acciones={
              aprueba &&
              diario.some((r) => r.revision === 'PENDIENTE') && (
                <AprobarHoja ordenId={ordenId} cuantos={diario.filter((r) => r.revision === 'PENDIENTE').length} />
              )
            }
          />
          <TarjetaCuerpo className="p-0">
            {observadosMios.length > 0 && (
              <div className="border-b border-borde bg-peligro-suave px-4 py-3" role="status">
                <p className="text-xs font-semibold text-peligro">
                  El jefe observó {observadosMios.length === 1 ? 'un reporte tuyo' : `${observadosMios.length} reportes tuyos`}: corrígelo{observadosMios.length === 1 ? '' : 's'} y vuelve{observadosMios.length === 1 ? '' : 'n'} a la cola.
                </p>
                <ul className="mt-1 space-y-1">
                  {observadosMios.map((r) => (
                    <li key={r.id} className="text-xs text-texto">
                      <a href={`#${r.id}`} className="font-medium hover:underline">
                        {fmtFecha(r.fecha)} · {r.actividad} · +{numero(r.avance_pct, 0)} %
                      </a>
                      {r.observacion && <span className="text-texto-suave"> — {r.observacion}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="divide-y divide-[var(--borde)]">
              {diario.map((r) => {
                const revisa = aprueba && r.revision !== 'APROBADO'
                const corrige = puedeCorregir.has(r.id)
                const elimina = puedeEliminar.has(r.id)
                return (
                  <li key={r.id} id={r.id} className="scroll-mt-20 space-y-2 px-4 py-2.5">
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
                    {(revisa || corrige || elimina) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {revisa && <RevisarReporte clase="hoja" id={r.id} revision={r.revision} />}
                        {elimina && <EliminarReporte clase="hoja" id={r.id} />}
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
 * Aprobar de una vez lo que queda por aprobar de esta orden. Pregunta antes: es
 * un gesto sobre varios reportes y el jefe tiene que haberlos mirado.
 */
function AprobarHoja({ ordenId, cuantos }: { ordenId: string; cuantos: number }) {
  const [confirmando, setConfirmando] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(aprobarHojaDeOrden, () => setConfirmando(false))

  if (!confirmando) {
    return (
      <Boton
        variante="secundario"
        tamano="sm"
        onClick={() => {
          limpiar()
          setConfirmando(true)
        }}
      >
        <CheckCheck aria-hidden className="size-3.5" />
        Aprobar los {cuantos} por aprobar
      </Boton>
    )
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orden_id" value={ordenId} />
      <span className="text-xs text-texto">
        ¿Aprobar {cuantos === 1 ? 'el reporte' : `los ${cuantos} reportes`} de esta orden que {cuantos === 1 ? 'espera' : 'esperan'}?
      </span>
      <Boton type="submit" tamano="sm" cargando={enviando}>
        Sí, aprobar
      </Boton>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setConfirmando(false)}>
        No
      </Boton>
      {error && <Error_ texto={error} />}
    </form>
  )
}

/**
 * Desde cuándo y hasta cuándo, según el cronograma, y si ya se pasó. Las fechas
 * son planas (YYYY-MM-DD) y se comparan como texto contra la fecha del taller.
 */
function PlanDeActividad({ actividad, hoy }: { actividad: ActividadArea; hoy: string }) {
  const inicio = actividad.fecha_inicio_plan
  const fin = actividad.fecha_fin_plan
  if (!inicio && !fin) return null

  const atrasada = !actividad.terminada && fin !== null && fin < hoy
  const tocaAhora = !actividad.terminada && !atrasada && inicio !== null && inicio <= hoy

  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-texto-suave">
      <CalendarDays aria-hidden className="size-3 shrink-0" />
      <span className="tabular">
        {inicio ? fmtFecha(inicio) : '—'} → {fin ? fmtFecha(fin) : '—'}
      </span>
      {atrasada && <Insignia tono="peligro">Atrasada</Insignia>}
      {tocaAhora && <Insignia tono="aviso">Toca ahora</Insignia>}
    </p>
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
  const [modo, setModo] = useState<'nada' | 'peso' | 'editar' | 'quitar'>('nada')
  const peso = useEnvio(cambiarPesoActividad, () => setModo('nada'))
  const editar = useEnvio(editarActividad, () => setModo('nada'))
  const quitar = useEnvio(quitarActividad, () => setModo('nada'))

  if (modo === 'editar') {
    return (
      <form onSubmit={editar.alEnviar} className="grid w-full gap-2 sm:grid-cols-6">
        <input type="hidden" name="id" value={actividad.id} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <Campo etiqueta="Actividad" htmlFor={`ea-nombre-${actividad.id}`} requerido className="sm:col-span-3">
          <Entrada id={`ea-nombre-${actividad.id}`} name="nombre" required defaultValue={actividad.nombre} autoFocus />
        </Campo>
        <Campo etiqueta="Referencia" htmlFor={`ea-ref-${actividad.id}`} className="sm:col-span-2">
          <Entrada id={`ea-ref-${actividad.id}`} name="referencia" defaultValue={actividad.referencia ?? ''} />
        </Campo>
        <Campo etiqueta="N.º" htmlFor={`ea-orden-${actividad.id}`}>
          <Entrada
            id={`ea-orden-${actividad.id}`}
            name="orden_secuencia"
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            defaultValue={actividad.orden_secuencia}
            className="tabular"
          />
        </Campo>
        <Campo etiqueta="Detalle" htmlFor={`ea-detalle-${actividad.id}`} className="sm:col-span-2">
          <Entrada id={`ea-detalle-${actividad.id}`} name="detalle" defaultValue={actividad.detalle ?? ''} />
        </Campo>
        <Campo etiqueta="Desde" htmlFor={`ea-inicio-${actividad.id}`} className="sm:col-span-2">
          <Entrada id={`ea-inicio-${actividad.id}`} name="fecha_inicio_plan" type="date" defaultValue={actividad.fecha_inicio_plan ?? ''} />
        </Campo>
        <Campo etiqueta="Hasta" htmlFor={`ea-fin-${actividad.id}`} className="sm:col-span-2">
          <Entrada id={`ea-fin-${actividad.id}`} name="fecha_fin_plan" type="date" defaultValue={actividad.fecha_fin_plan ?? ''} />
        </Campo>
        {editar.error && (
          <div className="sm:col-span-6">
            <Error_ texto={editar.error} />
          </div>
        )}
        <div className="flex justify-end gap-2 sm:col-span-6">
          <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setModo('nada')}>
            Cancelar
          </Boton>
          <Boton type="submit" tamano="sm" cargando={editar.enviando}>
            Guardar
          </Boton>
        </div>
      </form>
    )
  }

  // Quitar pregunta antes: el icono va pegado a «Peso» y con guante se toca sin
  // querer, y una actividad borrada hay que volver a escribirla.
  if (modo === 'quitar') {
    return (
      <form
        onSubmit={quitar.alEnviar}
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-base)] bg-peligro-suave px-2 py-1"
      >
        <input type="hidden" name="id" value={actividad.id} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <span className="text-xs text-peligro">¿Quitar «{actividad.nombre}»?</span>
        <Boton type="submit" variante="peligro" tamano="sm" cargando={quitar.enviando}>
          Sí, quitar
        </Boton>
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setModo('nada')}>
          No
        </Boton>
        {quitar.error && <Error_ texto={quitar.error} />}
      </form>
    )
  }

  if (modo === 'peso') {
    return (
      <form onSubmit={peso.alEnviar} className="flex items-end gap-1">
        <input type="hidden" name="id" value={actividad.id} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <Entrada
          aria-label={`Peso de ${actividad.nombre}`}
          name="peso_pct"
          type="number"
          inputMode="numeric"
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
            <span className="px-1 text-xs text-exito">Reportado hoy: +{numero(deHoy.avance_pct, 0)} %</span>
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
          <Boton
            type="button"
            variante="fantasma"
            tamano="sm"
            aria-label={`Editar ${actividad.nombre}`}
            onClick={() => {
              editar.limpiar()
              setModo('editar')
            }}
          >
            <Pencil aria-hidden className="size-4" />
          </Boton>
          <Boton
            type="button"
            variante="fantasma"
            tamano="sm"
            aria-label={`Quitar ${actividad.nombre}`}
            onClick={() => {
              quitar.limpiar()
              setModo('quitar')
            }}
          >
            <Trash2 aria-hidden className="size-4 text-peligro" />
          </Boton>
        </>
      )}
      {/* Un error en la actividad —mal el nombre, mal el peso, falta una— se
          anota al área que la armó, con la actividad ya escrita en el texto. */}
      {puedeReportar && !puedeArmar && (
        <Link
          href={`/ordenes/${ordenId}?vista=resumen&observar=DIS&sobre=${encodeURIComponent(`Actividad «${actividad.nombre}» (${actividad.area}): `)}#observaciones`}
          className="inline-flex min-h-11 items-center gap-1 px-1 text-[11px] text-aviso hover:underline sm:min-h-0"
          title="Anotar una observación a Diseño sobre esta actividad"
        >
          <MessageSquareWarning aria-hidden className="size-3.5" />
          Observar
        </Link>
      )}
    </div>
  )
}

function NuevaActividad({
  ordenId,
  areas,
  areaPropia,
  propuestas,
  alCerrar,
}: {
  ordenId: string
  areas: { id: string; codigo: string; nombre: string }[]
  areaPropia: string | null
  /** Por área: el peso que falta repartir y el número que sigue. */
  propuestas: Record<string, { peso: number; numero: number }>
  alCerrar: () => void
}) {
  // El formulario se queda abierto después de guardar, limpio y con el área
  // puesta: la hoja se arma de a diez actividades y abrirlo cada vez eran diez
  // toques de más. `guardadas` es la llave que lo limpia, y el texto de al lado
  // dice cuántas van.
  const [guardadas, setGuardadas] = useState(0)
  const { alEnviar, enviando, error } = useEnvio(agregarActividad, () => setGuardadas((g) => g + 1))
  const [area, setArea] = useState(areaPropia && areas.some((a) => a.id === areaPropia) ? areaPropia : (areas[0]?.id ?? ''))
  const propuesta = propuestas[area] ?? { peso: 0, numero: 1 }

  return (
    <Tarjeta className="border-acento">
      <TarjetaCabecera
        titulo="Nueva actividad"
        descripcion="Qué trabajo es y cuánto pesa dentro del 100 % de su área. Para Maestranza, la pieza solicitada va en «referencia»."
      />
      <TarjetaCuerpo>
        <form key={guardadas} onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="orden_id" value={ordenId} />

          <Campo etiqueta="Área" htmlFor="na-area" requerido>
            <Seleccion id="na-area" name="area_id" required value={area} onChange={(e) => setArea(e.target.value)}>
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

          {/* `key` por área: al cambiar de área los dos campos vuelven a proponer
              lo de esa área en vez de quedarse con lo de la anterior. */}
          <Campo
            etiqueta="Pesa"
            htmlFor="na-peso"
            ayuda={propuesta.peso > 0 ? `Quedan ${propuesta.peso} % por repartir en el área` : 'El área ya repartió su 100 %'}
          >
            <Entrada
              key={`peso-${area}`}
              id="na-peso"
              name="peso_pct"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step="1"
              defaultValue={propuesta.peso}
              className="tabular"
            />
          </Campo>

          <Campo etiqueta="N.º" htmlFor="na-orden" ayuda="Orden">
            <Entrada
              key={`orden-${area}`}
              id="na-orden"
              name="orden_secuencia"
              type="number"
              inputMode="numeric"
              min={1}
              step="1"
              defaultValue={propuesta.numero}
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

          <Campo etiqueta="Desde" htmlFor="na-inicio" ayuda="Según el cronograma, si lo hay" className="sm:col-span-3">
            <Entrada id="na-inicio" name="fecha_inicio_plan" type="date" />
          </Campo>

          <Campo etiqueta="Hasta" htmlFor="na-fin" className="sm:col-span-3">
            <Entrada id="na-fin" name="fecha_fin_plan" type="date" />
          </Campo>

          {error && (
            <div className="sm:col-span-6">
              <Error_ texto={error} />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-6">
            {guardadas > 0 && (
              <span role="status" className="mr-auto text-xs font-medium text-exito">
                {guardadas === 1 ? 'Agregada 1 actividad.' : `Agregadas ${guardadas} actividades.`} Sigue con la próxima o cierra.
              </span>
            )}
            <Boton type="button" variante="fantasma" tamano="sm" onClick={alCerrar}>
              {guardadas > 0 ? 'Listo' : 'Cancelar'}
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

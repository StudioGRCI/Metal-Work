import {
  AlertTriangle,
  ClipboardCheck,
  ClipboardList,
  MessageSquareDashed,
  MessageSquareWarning,
} from 'lucide-react'
import Link from 'next/link'

import { CorregirReporte, type ReporteACorregir } from '@/components/avance/corregir-reporte'
import { Miniaturas } from '@/components/avance/miniaturas'
import { AprobarElDia, RevisarReporte } from '@/components/avance/revisar-reporte'
import { InsigniaRevision, NotaRevision } from '@/components/avance/revision'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { avancesDelDia, hojasAbiertas } from '@/lib/datos/actividades'
import { avancesDeOrdenesDelDia, enlacesDeFotos, fotosDeAvances } from '@/lib/datos/avances'
import { flotaDelDia, flotaEnTaller, fotosDeReportesFlota } from '@/lib/datos/flota'
import { ESTADO_OT, definir, type DatosRevision } from '@/lib/dominio/estados'
import { nombreDeFlota } from '@/lib/dominio/unidades'
import { fecha as fmtFecha, hora, hoyLima, numero } from '@/lib/format'
import { exigirPermiso, puede, puedeCorregirReporte, type ClaseReporte } from '@/lib/sesion'

export const metadata = { title: 'El día en el taller' }

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

const FILTROS = [
  { valor: null, etiqueta: 'Todo lo del día' },
  { valor: 'por-aprobar', etiqueta: 'Solo lo por aprobar' },
  { valor: 'observados', etiqueta: 'Observados' },
]

/** El renglón chico de quién y a qué hora, igual en los tres tipos de reporte. */
function Firma({ quien, cuando }: { quien: string | null; cuando: string }) {
  return (
    <span className="text-xs text-texto-tenue">
      {quien ?? 'Sin registrar'} · {hora(cuando)}
    </span>
  )
}

function Traba({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{texto}</span>
    </p>
  )
}

/**
 * Lo que va al pie de cada reporte: lo que dijo el jefe y, según quién mira,
 * aprobar u observar, o corregir. Si no hay nada que hacer, no ocupa lugar.
 */
function PieDeRevision({
  clase,
  r,
  aprueba,
  corrige,
}: {
  clase: ClaseReporte
  r: DatosRevision & { id: string }
  aprueba: boolean
  corrige: ReporteACorregir | null
}) {
  const revisa = aprueba && r.revision !== 'APROBADO'
  return (
    <>
      <NotaRevision r={r} />
      {(revisa || corrige) && (
        <div className="flex flex-wrap items-center gap-2">
          {revisa && <RevisarReporte clase={clase} id={r.id} revision={r.revision} />}
          {corrige && (
            <CorregirReporte
              reporte={corrige}
              observacion={r.revision === 'OBSERVADO' ? r.observacion : null}
              destacado={r.revision === 'OBSERVADO'}
            />
          )}
        </div>
      )}
    </>
  )
}

/**
 * El parte de la jornada, que es la pantalla del jefe de producción.
 *
 * Acá llega todo lo del día junto: las hojas por área de las órdenes, el avance
 * con foto de cada unidad y los trabajos sin orden. Cada reporte nace «por
 * aprobar» y el jefe lo aprueba o lo observa desde acá mismo, de a uno o todo
 * el día de una vez. Y lo que ninguna lista de reportes enseña: **quién no
 * reportó**, que es la mitad por la que pregunta el jefe cuando cierra el día.
 *
 * Cada reporte es un renglón que se apila en el teléfono —nada que deslizar de
 * costado— y lleva sus fotos a la vista: el jefe mira desde el celular, y la
 * foto es la mitad del reporte.
 */
export default async function PaginaDiaEnElTaller({
  searchParams,
}: PageProps<'/avance/diario'>) {
  const perfil = await exigirPermiso('produccion.ver')

  const params = await searchParams
  const pedida = typeof params.fecha === 'string' && ES_FECHA.test(params.fecha) ? params.fecha : null
  const ver = params.ver === 'por-aprobar' || params.ver === 'observados' ? params.ver : null
  const hoy = hoyLima()
  const dia = pedida ?? hoy
  const aprueba = puede(perfil, 'produccion.aprobar_reportes')

  const [reportes, hojas, flotaDia, flota, conFoto] = await Promise.all([
    avancesDelDia(dia),
    hojasAbiertas(),
    flotaDelDia(dia),
    flotaEnTaller(),
    avancesDeOrdenesDelDia(dia),
  ])

  const [fotosFlota, fotosOrden] = await Promise.all([
    fotosDeReportesFlota(flotaDia.map((r) => r.id)),
    fotosDeAvances(conFoto.map((a) => a.id)),
  ])
  const enlaces = await enlacesDeFotos(
    [...Object.values(fotosFlota).flat(), ...Object.values(fotosOrden).flat()].map((f) => f.ruta_storage),
  )

  // Un área que reportó otro día pero no este: es la pregunta del jefe, y no
  // sale de la lista de reportes sino de lo que falta en ella. Los trabajos sin
  // orden entran igual, salvo los terminados, que esperan al cliente.
  const calladas = hojas.filter((h) => !h.ultimo_reporte || h.ultimo_reporte < dia)
  const flotaCallada = flota.filter(
    (u) =>
      u.estado === 'EN_TALLER' &&
      u.ingreso_fecha <= dia &&
      !flotaDia.some((r) => r.flota_id === u.id),
  )

  const areas = new Set([...reportes.map((r) => r.area_id), ...flotaDia.map((r) => r.area_id)])
  const tocados = new Set([
    ...reportes.map((r) => r.orden_id),
    ...conFoto.map((a) => a.orden_id),
    ...flotaDia.map((r) => r.flota_id),
  ])
  const todos = [...reportes, ...conFoto, ...flotaDia]
  const totalReportes = todos.length
  const porAprobar = todos.filter((r) => r.revision === 'PENDIENTE').length
  const observados = todos.filter((r) => r.revision === 'OBSERVADO').length
  const sinReportar = calladas.length + flotaCallada.length

  // El filtro achica las listas, no los números de arriba: el jefe tiene que
  // seguir viendo cuánto hubo en el día aunque mire solo lo que le falta.
  const entra = (r: DatosRevision) =>
    ver === 'por-aprobar' ? r.revision === 'PENDIENTE' : ver === 'observados' ? r.revision === 'OBSERVADO' : true
  const hojasVisibles = reportes.filter(entra)
  const conFotoVisible = conFoto.filter(entra)
  const flotaVisible = flotaDia.filter(entra)
  const visibles = hojasVisibles.length + conFotoVisible.length + flotaVisible.length

  // Un bloque por área, en el orden en que el taller las nombra.
  const porArea = [...new Map(hojasVisibles.map((r) => [r.area_id, r])).values()].map((cabeza) => ({
    id: cabeza.area_id,
    nombre: cabeza.area,
    codigo: cabeza.area_codigo,
    lista: hojasVisibles.filter((r) => r.area_id === cabeza.area_id),
  }))

  const cuantos = (n: number) => `${n} ${n === 1 ? 'reporte' : 'reportes'}`

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avance en taller', ruta: '/avance' }, { titulo: 'El día' }]}
        titulo="El día en el taller"
        descripcion={
          aprueba
            ? 'Todo lo que se reportó ese día, para aprobarlo u observarlo. Y abajo, de qué no hubo noticias.'
            : 'Todo lo que se reportó ese día: las hojas de cada área, el avance con foto de cada unidad y los trabajos sin orden. Y abajo, de qué no hubo noticias.'
        }
        acciones={aprueba && <AprobarElDia fecha={dia} cuantos={porAprobar} />}
      />

      {/* Un día es un día: se elige con el calendario y se conserva en la URL,
          para poder mandarle el enlace a alguien tal como se está mirando. */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-3">
        {ver && <input type="hidden" name="ver" value={ver} />}
        <Entrada
          type="date"
          name="fecha"
          defaultValue={dia}
          max={hoy}
          aria-label="Día que se está mirando"
          className="w-44"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0"
        >
          Ver ese día
        </button>
        {dia !== hoy && (
          <Link href="/avance/diario" className="text-sm text-texto-suave hover:underline">
            Volver a hoy
          </Link>
        )}
      </form>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Indicador
          titulo="Reportes del día"
          valor={totalReportes}
          icono={ClipboardList}
          pie={`${areas.size} ${areas.size === 1 ? 'área' : 'áreas'} · ${tocados.size} ${tocados.size === 1 ? 'trabajo' : 'trabajos'}`}
        />
        <Indicador
          titulo="Por aprobar"
          valor={porAprobar}
          icono={ClipboardCheck}
          tono={porAprobar > 0 ? 'aviso' : 'exito'}
          pie="Esperan el visto del jefe"
          href={ver === 'por-aprobar' || porAprobar === 0 ? undefined : `/avance/diario?fecha=${dia}&ver=por-aprobar`}
        />
        <Indicador
          titulo="Observados"
          valor={observados}
          icono={MessageSquareWarning}
          tono={observados > 0 ? 'peligro' : 'neutro'}
          pie="Volvieron a quien los escribió"
          href={ver === 'observados' || observados === 0 ? undefined : `/avance/diario?fecha=${dia}&ver=observados`}
        />
        <Indicador
          titulo="Sin reportar"
          valor={sinReportar}
          icono={MessageSquareDashed}
          tono={sinReportar > 0 ? 'aviso' : 'exito'}
          pie="Hojas y trabajos abiertos sin noticias"
        />
      </div>

      {totalReportes > 0 && (
        <PastillaFiltro
          ruta="/avance/diario"
          clave="ver"
          opciones={FILTROS}
          params={params}
          activo={ver}
          etiqueta="Qué reportes mirar"
          className="mb-4"
        />
      )}

      {totalReportes === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">Nadie reportó avance el {fmtFecha(dia)}</p>
            <p className="mt-1 text-sm text-texto-suave">
              Cada área lo escribe en la pestaña «Actividades» de su orden, con «Registrar avance» en
              la tarjeta de la unidad, o con «Reportar» en el trabajo sin orden. Abajo está lo que
              sigue abierto y de lo que no hay noticias.
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : visibles === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {ver === 'por-aprobar' ? 'No queda nada por aprobar ese día' : 'Ningún reporte observado ese día'}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              {ver === 'por-aprobar'
                ? 'Todo lo que se reportó ya tiene el visto, o está observado esperando la corrección.'
                : 'Lo que se reportó está aprobado o esperando el visto.'}
            </p>
            <Link href={`/avance/diario?fecha=${dia}`} className="mt-3 inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0">
              Ver todo lo del día
            </Link>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="space-y-4">
          {/* Las hojas de cada área: lo que avanzó cada actividad ese día y en
              cuánto quedó. Cada área tiene su propio 100 %. */}
          {porArea.map((area) => (
            <Tarjeta key={area.id}>
              <TarjetaCabecera
                titulo={area.nombre}
                descripcion={
                  area.codigo === 'MTZ'
                    ? 'Lo que Maestranza habilitó ese día, por pieza solicitada.'
                    : 'Lo que el área avanzó ese día en sus órdenes.'
                }
                acciones={<Insignia tono="acento">{cuantos(area.lista.length)}</Insignia>}
              />
              <ul className="divide-y divide-borde">
                {area.lista.map((r) => {
                  const estado = definir(ESTADO_OT, r.orden_estado)
                  const acumulado = Number(r.acumulado_pct ?? 0)
                  const corrige = puedeCorregirReporte(
                    perfil,
                    { clase: 'hoja', revision: r.revision, autor: r.reportado_por, fecha: r.fecha, areaId: r.area_id },
                    hoy,
                  )
                  return (
                    <li key={r.id} className="space-y-2 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-texto">{r.actividad}</p>
                          {r.referencia && <p className="text-[11px] text-texto-suave">{r.referencia}</p>}
                        </div>
                        <p className="shrink-0 text-base font-semibold tabular text-exito">
                          +{numero(r.avance_pct, 0)} %
                        </p>
                      </div>

                      {r.nota && <p className="text-sm text-texto-suave">{r.nota}</p>}

                      <div className="flex items-center gap-3">
                        <Progreso valor={acumulado} alto="sm" className="flex-1" />
                        <span className="shrink-0 tabular text-xs text-texto-suave">
                          quedó en {numero(acumulado, 0)} %
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="flex flex-wrap items-center gap-2 text-xs">
                          <Link
                            href={`/ordenes/${r.orden_id}?vista=actividades`}
                            className="font-medium text-acento hover:underline"
                          >
                            {r.orden_numero}
                          </Link>
                          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                          <span className="text-texto-tenue">pesa {numero(r.peso_pct, 0)} % de su área</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <InsigniaRevision revision={r.revision} />
                          <Firma quien={r.reportado_por_nombre} cuando={r.creado_en} />
                        </span>
                      </div>

                      <PieDeRevision
                        clase="hoja"
                        r={r}
                        aprueba={aprueba}
                        corrige={
                          corrige
                            ? {
                                clase: 'hoja',
                                id: r.id,
                                fecha: r.fecha,
                                actividad: r.actividad,
                                avance_pct: Number(r.avance_pct),
                                nota: r.nota,
                                tope: 100 - (acumulado - Number(r.avance_pct)),
                              }
                            : null
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            </Tarjeta>
          ))}

          {/* El avance con foto que el taller registra en la tarjeta de cada
              unidad. No lleva área: es lo que se hizo en la unidad ese día. */}
          {conFotoVisible.length > 0 && (
            <Tarjeta>
              <TarjetaCabecera
                titulo="Avance con foto de las órdenes"
                descripcion="Lo que se registró ese día en la tarjeta de cada unidad, con sus fotos."
                acciones={<Insignia tono="acento">{cuantos(conFotoVisible.length)}</Insignia>}
              />
              <ul className="divide-y divide-borde">
                {conFotoVisible.map((a) => {
                  const corrige = puedeCorregirReporte(
                    perfil,
                    { clase: 'orden', revision: a.revision, autor: a.registrado_por, fecha: a.fecha },
                    hoy,
                  )
                  return (
                    <li key={a.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm">
                          <Link
                            href={`/avance/${a.orden_id}`}
                            className="font-medium text-acento hover:underline"
                          >
                            {a.orden_numero}
                          </Link>
                          {a.placa && <span className="text-texto-suave">{a.placa}</span>}
                          {a.etapa && <Insignia tono="neutro">{a.etapa}</Insignia>}
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <InsigniaRevision revision={a.revision} />
                          <Firma quien={a.registrado_por_nombre} cuando={a.creado_en} />
                        </span>
                      </div>

                      <p className="text-sm text-texto">{a.descripcion}</p>

                      {a.avance_porcentaje !== null && a.etapa && (
                        <p className="text-xs font-medium text-texto-suave">
                          {a.etapa} quedó al {numero(a.avance_porcentaje, 0)} %
                        </p>
                      )}

                      <Traba texto={a.impedimento} />
                      <Miniaturas
                        fotos={fotosOrden[a.id] ?? []}
                        enlaces={enlaces}
                        alt={`Avance de la orden ${a.orden_numero}`}
                      />
                      <PieDeRevision
                        clase="orden"
                        r={a}
                        aprueba={aprueba}
                        corrige={
                          corrige
                            ? {
                                clase: 'orden',
                                id: a.id,
                                fecha: a.fecha,
                                descripcion: a.descripcion,
                                impedimento: a.impedimento,
                              }
                            : null
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            </Tarjeta>
          )}

          {/* Los trabajos sin orden: acá no hay peso ni acumulado, el porcentaje
              es a ojo y se lee como «va en», no como «avanzó». */}
          {flotaVisible.length > 0 && (
            <Tarjeta>
              <TarjetaCabecera
                titulo="Trabajos sin orden"
                descripcion="Lo que se hizo ese día en las unidades sin orden y en lo que el taller está implementando."
                acciones={<Insignia tono="acento">{cuantos(flotaVisible.length)}</Insignia>}
              />
              <ul className="divide-y divide-borde">
                {flotaVisible.map((r) => {
                  const nombre = nombreDeFlota({ placa: r.placa, descripcion: r.unidad })
                  const corrige = puedeCorregirReporte(
                    perfil,
                    { clase: 'flota', revision: r.revision, autor: r.registrado_por, fecha: r.fecha, areaId: r.area_id },
                    hoy,
                  )
                  return (
                    <li key={r.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                          <Link
                            href={`/avance/trabajos/${r.flota_id}`}
                            className="font-medium text-acento hover:underline"
                          >
                            {nombre}
                          </Link>
                          <Insignia tono="neutro">{r.area}</Insignia>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <InsigniaRevision revision={r.revision} />
                          <Firma quien={r.registrado_por_nombre} cuando={r.creado_en} />
                        </span>
                      </div>
                      {r.cliente && <p className="-mt-1 text-[11px] text-texto-suave">{r.cliente}</p>}

                      <p className="text-sm text-texto">{r.descripcion}</p>

                      {r.avance_porcentaje !== null && (
                        <p className="text-xs font-medium text-texto-suave">
                          va en ~{numero(r.avance_porcentaje, 0)} %
                        </p>
                      )}

                      <Traba texto={r.impedimento} />
                      <Miniaturas fotos={fotosFlota[r.id] ?? []} enlaces={enlaces} alt={`Reporte de ${nombre}`} />
                      <PieDeRevision
                        clase="flota"
                        r={r}
                        aprueba={aprueba}
                        corrige={
                          corrige
                            ? {
                                clase: 'flota',
                                id: r.id,
                                fecha: r.fecha,
                                descripcion: r.descripcion,
                                avance_porcentaje: r.avance_porcentaje === null ? null : Number(r.avance_porcentaje),
                                impedimento: r.impedimento,
                              }
                            : null
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            </Tarjeta>
          )}
        </div>
      )}

      {sinReportar > 0 && (
        <Tarjeta className="mt-4">
          <TarjetaCabecera
            titulo="Sin reporte ese día"
            descripcion="Hojas abiertas en órdenes vivas, y trabajos sin orden en curso, de los que no hubo noticias. No siempre es que no se trabajó: a veces es que no se escribió."
          />
          <ul className="divide-y divide-borde">
            {calladas.map((h) => (
              <li
                key={`${h.orden_id}-${h.area_id}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/ordenes/${h.orden_id}?vista=actividades`}
                    className="text-sm font-medium text-acento hover:underline"
                  >
                    {h.orden_numero}
                  </Link>
                  <p className="text-xs text-texto-suave">{h.area}</p>
                </div>
                <div className="w-full space-y-1 sm:w-56">
                  <Progreso valor={Number(h.avance_pct)} alto="sm" mostrarValor />
                  <p className="text-[11px] text-texto-tenue sm:text-right">
                    {h.ultimo_reporte ? `último reporte: ${fmtFecha(h.ultimo_reporte)}` : 'nunca reportó'}
                  </p>
                </div>
              </li>
            ))}
            {flotaCallada.map((u) => {
              const dias = Number(u.dias_en_taller ?? 0)
              return (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/avance/trabajos/${u.id}`}
                      className="text-sm font-medium text-acento hover:underline"
                    >
                      {nombreDeFlota(u)}
                    </Link>
                    <p className="text-xs text-texto-suave">
                      {u.area_actual ?? 'Nadie lo tomó todavía'} · sin orden
                    </p>
                  </div>
                  <div className="text-xs sm:text-right">
                    <p className={dias >= 5 ? 'font-medium text-aviso' : 'text-texto-suave'}>
                      lleva {dias} {dias === 1 ? 'día' : 'días'}
                    </p>
                    <p className="text-[11px] text-texto-tenue">
                      {u.ultimo_avance_fecha ? `último reporte: ${fmtFecha(u.ultimo_avance_fecha)}` : 'nunca reportó'}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      )}
    </>
  )
}

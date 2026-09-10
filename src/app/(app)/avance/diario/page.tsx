import { AlertTriangle, CalendarDays, ClipboardList, Layers, MessageSquareDashed } from 'lucide-react'
import Link from 'next/link'

import { Miniaturas } from '@/components/avance/miniaturas'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { avancesDelDia, hojasAbiertas } from '@/lib/datos/actividades'
import { avancesDeOrdenesDelDia, enlacesDeFotos, fotosDeAvances } from '@/lib/datos/avances'
import { flotaDelDia, flotaEnTaller, fotosDeReportesFlota } from '@/lib/datos/flota'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeFlota } from '@/lib/dominio/unidades'
import { fecha as fmtFecha, hora, hoyLima, numero } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'El día en el taller' }

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

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
 * El parte de la jornada, que es la pantalla del jefe de producción.
 *
 * Acá llega todo lo del día junto: las hojas por área de las órdenes, el avance
 * con foto de cada unidad y los trabajos sin orden. Y lo que ninguna lista de
 * reportes enseña: **quién no reportó**, que es la mitad por la que pregunta el
 * jefe cuando cierra el día.
 *
 * Cada reporte es un renglón que se apila en el teléfono —nada que deslizar de
 * costado— y lleva sus fotos a la vista: el jefe mira desde el celular, y la
 * foto es la mitad del reporte.
 */
export default async function PaginaDiaEnElTaller({
  searchParams,
}: PageProps<'/avance/diario'>) {
  await exigirPermiso('produccion.ver')

  const params = await searchParams
  const pedida = typeof params.fecha === 'string' && ES_FECHA.test(params.fecha) ? params.fecha : null
  const hoy = hoyLima()
  const dia = pedida ?? hoy

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
  const totalReportes = reportes.length + conFoto.length + flotaDia.length
  const sinReportar = calladas.length + flotaCallada.length

  // Un bloque por área, en el orden en que el taller las nombra.
  const porArea = [...new Map(reportes.map((r) => [r.area_id, r])).values()].map((cabeza) => ({
    id: cabeza.area_id,
    nombre: cabeza.area,
    codigo: cabeza.area_codigo,
    lista: reportes.filter((r) => r.area_id === cabeza.area_id),
  }))

  const cuantos = (n: number) => `${n} ${n === 1 ? 'reporte' : 'reportes'}`

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avance en taller', ruta: '/avance' }, { titulo: 'El día' }]}
        titulo="El día en el taller"
        descripcion="Todo lo que se reportó ese día: las hojas de cada área, el avance con foto de cada unidad y los trabajos sin orden. Y abajo, de qué no hubo noticias."
      />

      {/* Un día es un día: se elige con el calendario y se conserva en la URL,
          para poder mandarle el enlace a alguien tal como se está mirando. */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-3">
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
          pie={fmtFecha(dia)}
        />
        <Indicador titulo="Áreas que reportaron" valor={areas.size} icono={Layers} />
        <Indicador
          titulo="Trabajos tocados"
          valor={tocados.size}
          icono={CalendarDays}
          pie="Órdenes y trabajos sin orden"
        />
        <Indicador
          titulo="Sin reportar"
          valor={sinReportar}
          icono={MessageSquareDashed}
          tono={sinReportar > 0 ? 'aviso' : 'exito'}
          pie="Hojas y trabajos abiertos sin noticias ese día"
        />
      </div>

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
                        <Firma quien={r.reportado_por_nombre} cuando={r.creado_en} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Tarjeta>
          ))}

          {/* El avance con foto que el taller registra en la tarjeta de cada
              unidad. No lleva área: es lo que se hizo en la unidad ese día. */}
          {conFoto.length > 0 && (
            <Tarjeta>
              <TarjetaCabecera
                titulo="Avance con foto de las órdenes"
                descripcion="Lo que se registró ese día en la tarjeta de cada unidad, con sus fotos."
                acciones={<Insignia tono="acento">{cuantos(conFoto.length)}</Insignia>}
              />
              <ul className="divide-y divide-borde">
                {conFoto.map((a) => (
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
                      <Firma quien={a.registrado_por_nombre} cuando={a.creado_en} />
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
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {/* Los trabajos sin orden: acá no hay peso ni acumulado, el porcentaje
              es a ojo y se lee como «va en», no como «avanzó». */}
          {flotaDia.length > 0 && (
            <Tarjeta>
              <TarjetaCabecera
                titulo="Trabajos sin orden"
                descripcion="Lo que se hizo ese día en las unidades sin orden y en lo que el taller está implementando."
                acciones={<Insignia tono="acento">{cuantos(flotaDia.length)}</Insignia>}
              />
              <ul className="divide-y divide-borde">
                {flotaDia.map((r) => (
                  <li key={r.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                        <Link
                          href={`/avance/trabajos/${r.flota_id}`}
                          className="font-medium text-acento hover:underline"
                        >
                          {nombreDeFlota({ placa: r.placa, descripcion: r.unidad })}
                        </Link>
                        <Insignia tono="neutro">{r.area}</Insignia>
                      </span>
                      <Firma quien={r.registrado_por_nombre} cuando={r.creado_en} />
                    </div>
                    {r.cliente && <p className="-mt-1 text-[11px] text-texto-suave">{r.cliente}</p>}

                    <p className="text-sm text-texto">{r.descripcion}</p>

                    {r.avance_porcentaje !== null && (
                      <p className="text-xs font-medium text-texto-suave">
                        va en ~{numero(r.avance_porcentaje, 0)} %
                      </p>
                    )}

                    <Traba texto={r.impedimento} />
                    <Miniaturas
                      fotos={fotosFlota[r.id] ?? []}
                      enlaces={enlaces}
                      alt={`Reporte de ${nombreDeFlota({ placa: r.placa, descripcion: r.unidad })}`}
                    />
                  </li>
                ))}
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

import { AlertTriangle, CalendarDays, Camera, ClipboardList, Layers, MessageSquareDashed } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { avancesDelDia, hojasAbiertas } from '@/lib/datos/actividades'
import { flotaDelDia, flotaEnTaller } from '@/lib/datos/flota'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeFlota } from '@/lib/dominio/unidades'
import { fecha as fmtFecha, hoyLima, numero } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'El día en el taller' }

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * El parte de la jornada, que es la pantalla del jefe de producción.
 *
 * Hasta ahora el avance diario solo se podía leer orden por orden: entrar a la
 * OT, abrir la pestaña, mirar el diario, salir. Acá llega todo junto —las
 * hojas por área de las órdenes y los reportes de las unidades sin orden— y,
 * lo que ninguna lista de reportes enseña, **quién no reportó**, que es la
 * mitad por la que pregunta el jefe cuando cierra el día.
 */
export default async function PaginaDiaEnElTaller({
  searchParams,
}: PageProps<'/avance/diario'>) {
  await exigirPermiso('produccion.ver')

  const params = await searchParams
  const pedida = typeof params.fecha === 'string' && ES_FECHA.test(params.fecha) ? params.fecha : null
  const hoy = hoyLima()
  const dia = pedida ?? hoy

  const [reportes, hojas, flotaDia, flota] = await Promise.all([
    avancesDelDia(dia),
    hojasAbiertas(),
    flotaDelDia(dia),
    flotaEnTaller(),
  ])

  // Un área que reportó otro día pero no este: es la pregunta del jefe, y no
  // sale de la lista de reportes sino de lo que falta en ella. Las unidades sin
  // orden entran igual, salvo las que ya están listas esperando al cliente.
  const calladas = hojas.filter((h) => !h.ultimo_reporte || h.ultimo_reporte < dia)
  const flotaCallada = flota.filter(
    (u) =>
      u.estado === 'EN_TALLER' &&
      u.ingreso_fecha <= dia &&
      !flotaDia.some((r) => r.flota_id === u.id),
  )

  const areas = new Set([...reportes.map((r) => r.area_id), ...flotaDia.map((r) => r.area_id)])
  const unidades = new Set([...reportes.map((r) => r.orden_id), ...flotaDia.map((r) => r.flota_id)])
  const totalReportes = reportes.length + flotaDia.length
  const sinReportar = calladas.length + flotaCallada.length

  // Un bloque por área, en el orden en que el taller las nombra.
  const porArea = [...new Map(reportes.map((r) => [r.area_id, r])).values()].map((cabeza) => ({
    id: cabeza.area_id,
    nombre: cabeza.area,
    codigo: cabeza.area_codigo,
    lista: reportes.filter((r) => r.area_id === cabeza.area_id),
  }))

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avance en taller', ruta: '/avance' }, { titulo: 'El día' }]}
        titulo="El día en el taller"
        descripcion="Lo que cada área reportó ese día: sobre qué orden o unidad, cuánto avanzó y en cuánto quedó. Cada área tiene su propio 100 %."
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
          pie={flotaDia.length > 0 ? `${fmtFecha(dia)} · ${flotaDia.length} sin orden` : fmtFecha(dia)}
        />
        <Indicador titulo="Áreas que reportaron" valor={areas.size} icono={Layers} />
        <Indicador titulo="Unidades tocadas" valor={unidades.size} icono={CalendarDays} />
        <Indicador
          titulo="Sin reportar"
          valor={sinReportar}
          icono={MessageSquareDashed}
          tono={sinReportar > 0 ? 'aviso' : 'exito'}
          pie="Hojas y unidades abiertas sin noticias ese día"
        />
      </div>

      {totalReportes === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              Nadie reportó avance el {fmtFecha(dia)}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              El avance del día lo escribe cada área en la pestaña «Actividades» de su orden de
              trabajo, o con «Reportar» en la unidad sin orden. Abajo está lo que sigue abierto y
              de lo que no hay noticias.
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="space-y-4">
          {porArea.map((area) => (
            <Tarjeta key={area.id}>
              <TarjetaCabecera
                titulo={area.nombre}
                descripcion={
                  area.codigo === 'MTZ'
                    ? 'Lo que Maestranza habilitó ese día, por pieza solicitada.'
                    : 'Lo que el área avanzó ese día en sus órdenes.'
                }
                acciones={
                  <Insignia tono="acento">
                    {area.lista.length} {area.lista.length === 1 ? 'reporte' : 'reportes'}
                  </Insignia>
                }
              />
              <TarjetaCuerpo className="p-0">
                <Tabla>
                  <TablaCabecera>
                    <TR>
                      <TH className="w-32">Orden</TH>
                      <TH>Actividad</TH>
                      <TH className="w-20 text-right">Del día</TH>
                      <TH className="w-44">Quedó en</TH>
                      <TH>Quién</TH>
                    </TR>
                  </TablaCabecera>
                  <tbody>
                    {area.lista.map((r) => {
                      const estado = definir(ESTADO_OT, r.orden_estado)
                      const acumulado = Number(r.acumulado_pct ?? 0)
                      return (
                        <TR key={r.id}>
                          <TD className="align-top">
                            <Link
                              href={`/ordenes/${r.orden_id}?vista=actividades`}
                              className="text-sm font-medium text-acento hover:underline"
                            >
                              {r.orden_numero}
                            </Link>
                            <p className="mt-0.5">
                              <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                            </p>
                          </TD>
                          <TD className="align-top">
                            <p className="text-sm font-medium text-texto">{r.actividad}</p>
                            {r.referencia && (
                              <p className="text-[11px] text-texto-suave">{r.referencia}</p>
                            )}
                            {r.nota && <p className="mt-1 text-xs text-texto-suave">{r.nota}</p>}
                          </TD>
                          <TD className="align-top text-right tabular text-sm font-semibold text-exito">
                            +{numero(r.avance_pct, 0)} %
                          </TD>
                          <TD className="align-top">
                            <div className="flex items-center gap-2">
                              <Progreso valor={acumulado} />
                              <span className="tabular text-xs text-texto-suave">
                                {numero(acumulado, 0)} %
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-texto-tenue">
                              pesa {numero(r.peso_pct, 0)} % de su área
                            </p>
                          </TD>
                          <TD className="align-top text-xs text-texto-suave">
                            {r.reportado_por_nombre ?? '—'}
                          </TD>
                        </TR>
                      )
                    })}
                  </tbody>
                </Tabla>
              </TarjetaCuerpo>
            </Tarjeta>
          ))}

          {/* Las unidades sin orden van en su propia tarjeta y con sus propias
              columnas: acá no hay peso ni acumulado, el porcentaje es a ojo y
              se lee como «va en», no como «avanzó». */}
          {flotaDia.length > 0 && (
            <Tarjeta>
              <TarjetaCabecera
                titulo="Unidades sin orden"
                descripcion="Lo que se les hizo ese día a las unidades que entraron sin orden de trabajo."
                acciones={
                  <Insignia tono="acento">
                    {flotaDia.length} {flotaDia.length === 1 ? 'reporte' : 'reportes'}
                  </Insignia>
                }
              />
              <TarjetaCuerpo className="p-0">
                <Tabla>
                  <TablaCabecera>
                    <TR>
                      <TH className="w-40">Unidad</TH>
                      <TH className="w-32">Área</TH>
                      <TH>Qué se hizo</TH>
                      <TH className="w-24 text-right">Va en</TH>
                      <TH>Quién</TH>
                    </TR>
                  </TablaCabecera>
                  <tbody>
                    {flotaDia.map((r) => (
                      <TR key={r.id}>
                        <TD className="align-top">
                          <Link
                            href={`/avance/flota/${r.flota_id}`}
                            className="text-sm font-medium text-acento hover:underline"
                          >
                            {nombreDeFlota({ placa: r.placa, descripcion: r.unidad })}
                          </Link>
                          <p className="text-[11px] text-texto-suave">{r.cliente ?? 'sin orden'}</p>
                        </TD>
                        <TD className="align-top text-sm text-texto">{r.area}</TD>
                        <TD className="align-top">
                          <p className="text-sm text-texto">{r.descripcion}</p>
                          {r.impedimento && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-peligro">
                              <AlertTriangle aria-hidden className="size-3" />
                              {r.impedimento}
                            </p>
                          )}
                          {r.fotos > 0 && (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-texto-tenue">
                              <Camera aria-hidden className="size-3" />
                              {r.fotos} {r.fotos === 1 ? 'foto' : 'fotos'}
                            </p>
                          )}
                        </TD>
                        <TD className="align-top text-right tabular text-sm text-texto-suave">
                          {r.avance_porcentaje === null ? '—' : `~${numero(r.avance_porcentaje, 0)} %`}
                        </TD>
                        <TD className="align-top text-xs text-texto-suave">
                          {r.registrado_por_nombre ?? '—'}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Tabla>
              </TarjetaCuerpo>
            </Tarjeta>
          )}
        </div>
      )}

      {sinReportar > 0 && (
        <Tarjeta className="mt-4">
          <TarjetaCabecera
            titulo="Sin reporte ese día"
            descripcion="Hojas abiertas en órdenes vivas, y unidades sin orden que siguen en trabajo, de las que no hubo noticias. No siempre es que no se trabajó: a veces es que no se escribió."
          />
          <TarjetaCuerpo className="p-0">
            <Tabla>
              <TablaCabecera>
                <TR>
                  <TH className="w-40">Orden o unidad</TH>
                  <TH>Área</TH>
                  <TH className="w-44">Lleva</TH>
                  <TH>Último reporte</TH>
                </TR>
              </TablaCabecera>
              <tbody>
                {calladas.map((h) => (
                  <TR key={`${h.orden_id}-${h.area_id}`}>
                    <TD>
                      <Link
                        href={`/ordenes/${h.orden_id}?vista=actividades`}
                        className="text-sm font-medium text-acento hover:underline"
                      >
                        {h.orden_numero}
                      </Link>
                    </TD>
                    <TD className="text-sm text-texto">{h.area}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Progreso valor={Number(h.avance_pct)} />
                        <span className="tabular text-xs text-texto-suave">
                          {numero(h.avance_pct, 0)} %
                        </span>
                      </div>
                    </TD>
                    <TD className="text-xs text-texto-suave">
                      {h.ultimo_reporte ? fmtFecha(h.ultimo_reporte) : 'nunca reportó'}
                    </TD>
                  </TR>
                ))}
                {flotaCallada.map((u) => {
                  const dias = Number(u.dias_en_taller ?? 0)
                  return (
                    <TR key={u.id}>
                      <TD>
                        <Link
                          href={`/avance/flota/${u.id}`}
                          className="text-sm font-medium text-acento hover:underline"
                        >
                          {nombreDeFlota(u)}
                        </Link>
                        <p className="text-[11px] text-texto-suave">sin orden</p>
                      </TD>
                      <TD className="text-sm text-texto">{u.area_actual ?? 'Nadie la tomó todavía'}</TD>
                      <TD className={`tabular text-xs ${dias >= 5 ? 'font-medium text-aviso' : 'text-texto-suave'}`}>
                        {dias} {dias === 1 ? 'día' : 'días'} en el taller
                      </TD>
                      <TD className="text-xs text-texto-suave">
                        {u.ultimo_avance_fecha ? fmtFecha(u.ultimo_avance_fecha) : 'nunca reportó'}
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Tabla>
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </>
  )
}

import { CalendarDays, ClipboardList, Layers, MessageSquareDashed } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { avancesDelDia, hojasAbiertas } from '@/lib/datos/actividades'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { fecha as fmtFecha, hoyLima, numero } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'El día en el taller' }

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * El parte de la jornada, que es la pantalla del jefe de producción.
 *
 * Hasta ahora el avance diario solo se podía leer orden por orden: entrar a la
 * OT, abrir la pestaña, mirar el diario, salir. Acá llega todo junto, un bloque
 * por área, y —lo que ninguna lista de reportes enseña— **quién no reportó**,
 * que es la mitad por la que pregunta el jefe cuando cierra el día.
 */
export default async function PaginaDiaEnElTaller({
  searchParams,
}: PageProps<'/avance/diario'>) {
  await exigirPermiso('produccion.ver')

  const params = await searchParams
  const pedida = typeof params.fecha === 'string' && ES_FECHA.test(params.fecha) ? params.fecha : null
  const hoy = hoyLima()
  const dia = pedida ?? hoy

  const [reportes, hojas] = await Promise.all([avancesDelDia(dia), hojasAbiertas()])

  // Un área que reportó otro día pero no este: es la pregunta del jefe, y no
  // sale de la lista de reportes sino de lo que falta en ella.
  const calladas = hojas.filter((h) => !h.ultimo_reporte || h.ultimo_reporte < dia)

  const areas = [...new Set(reportes.map((r) => r.area_id))]
  const ordenes = [...new Set(reportes.map((r) => r.orden_id))]

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
        descripcion="Lo que cada área reportó ese día: sobre qué orden, cuánto avanzó y en cuánto quedó. Cada área tiene su propio 100 %."
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
          valor={reportes.length}
          icono={ClipboardList}
          pie={fmtFecha(dia)}
        />
        <Indicador titulo="Áreas que reportaron" valor={areas.length} icono={Layers} />
        <Indicador titulo="Unidades tocadas" valor={ordenes.length} icono={CalendarDays} />
        <Indicador
          titulo="Hojas sin reportar"
          valor={calladas.length}
          icono={MessageSquareDashed}
          tono={calladas.length > 0 ? 'aviso' : 'exito'}
          pie="Abiertas y sin noticias ese día"
        />
      </div>

      {reportes.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              Nadie reportó avance el {fmtFecha(dia)}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              El avance del día lo escribe cada área en la pestaña «Actividades» de su orden de
              trabajo. Abajo están las hojas que siguen abiertas y de las que no hay noticias.
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
                    : 'Lo que el área avanzó ese día.'
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
        </div>
      )}

      {calladas.length > 0 && (
        <Tarjeta className="mt-4">
          <TarjetaCabecera
            titulo="Sin reporte ese día"
            descripcion="Hojas abiertas en órdenes vivas de las que no hubo noticias. No siempre es que no se trabajó: a veces es que no se escribió."
          />
          <TarjetaCuerpo className="p-0">
            <Tabla>
              <TablaCabecera>
                <TR>
                  <TH className="w-32">Orden</TH>
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
              </tbody>
            </Tabla>
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </>
  )
}

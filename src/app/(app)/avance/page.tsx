import { AlertTriangle, Camera, Clock, Plus } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { areasDelTaller } from '@/lib/datos/actividades'
import { listarTablero, resumirTablero } from '@/lib/datos/avances'
import { flotaEnTaller } from '@/lib/datos/flota'
import { ESTADO_FLOTA, ESTADO_OT, PRIORIDAD, definir } from '@/lib/dominio/estados'
import { nombreDeFlota, nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha as formatearFecha, numero } from '@/lib/format'
import { areasDeSuMano, exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Avance en taller' }

const FILTROS = [
  { valor: null, etiqueta: 'Todas' },
  { valor: '1', etiqueta: 'Solo las trabadas' },
]

export default async function PaginaAvance({ searchParams }: PageProps<'/avance'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const params = await searchParams
  const soloTrabadas = params.trabadas === '1'

  const [filas, flota, areas] = await Promise.all([
    listarTablero({ trabadas: soloTrabadas }),
    flotaEnTaller(),
    areasDelTaller(),
  ])
  const resumen = resumirTablero(filas)

  // Las unidades sin orden cuentan en los mismos números: si no, el jefe lee
  // «4 en taller» cuando hay 11.
  const flotaVisible = soloTrabadas ? flota.filter((u) => u.impedimento) : flota
  const enTaller = resumen.total + flotaVisible.length
  const trabadas = resumen.trabadas + flota.filter((u) => u.impedimento).length
  const sinNoticias =
    resumen.sinNoticias +
    flota.filter((u) => u.estado === 'EN_TALLER' && Number(u.dias_sin_avance ?? 0) >= 3).length

  const puedeRegistrarFlota =
    puede(perfil, 'produccion.actividades') && areasDeSuMano(perfil, areas).length > 0

  return (
    <>
      <EncabezadoPagina
        titulo="Avance en taller"
        descripcion="Una tarjeta por unidad: dónde está, cuánto lleva, hace cuánto no se toca y qué la traba."
        acciones={
          puedeRegistrarFlota && (
            <EnlaceBoton href="/avance/flota/nueva" variante="secundario">
              <Plus aria-hidden className="size-4" />
              Llegó una unidad sin orden
            </EnlaceBoton>
          )
        }
      />

      {/* Dos por fila en el teléfono; las cuatro de siempre en el monitor. */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Indicador
          titulo="Unidades en taller"
          valor={enTaller}
          pie={soloTrabadas ? 'Contando solo las trabadas' : `${flota.length} sin orden`}
        />
        <Indicador
          titulo="Trabadas"
          valor={trabadas}
          pie="Esperando material o decisión"
          tono={trabadas > 0 ? 'peligro' : 'neutro'}
          /* Este número sí tiene una lista detrás; los otros tres todavía no
             tienen filtro en la consulta, así que no llevan a ninguna parte. */
          href={soloTrabadas ? undefined : '/avance?trabadas=1'}
        />
        <Indicador
          titulo="Sin noticias"
          valor={sinNoticias}
          pie="Tres días o más sin avance registrado"
          tono={sinNoticias > 0 ? 'aviso' : 'neutro'}
        />
        <Indicador
          titulo="Fuera de plazo"
          valor={resumen.atrasadas}
          pie="Pasaron la fecha prometida"
          tono={resumen.atrasadas > 0 ? 'peligro' : 'neutro'}
        />
      </div>

      <PastillaFiltro
        ruta="/avance"
        clave="trabadas"
        opciones={FILTROS}
        params={params}
        activo={soloTrabadas ? '1' : null}
        etiqueta="Filtrar las unidades"
        className="mb-4"
      />

      {filas.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {soloTrabadas ? 'Ninguna orden está trabada' : 'No hay órdenes en el taller'}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              {soloTrabadas
                ? 'Todo lo que está en el taller con orden puede seguir avanzando.'
                : 'Cuando se apruebe una orden de trabajo, la unidad aparecerá acá.'}
            </p>
            {/* Vacío por el filtro y vacío de verdad no son lo mismo: cada uno
                lleva a su siguiente paso en vez de dejar a medio camino. */}
            <div className="mt-4">
              {soloTrabadas ? (
                <EnlaceBoton href="/avance" variante="secundario">
                  Ver todas las unidades
                </EnlaceBoton>
              ) : (
                <EnlaceBoton href="/ordenes" variante="secundario">
                  Ver las órdenes de trabajo
                </EnlaceBoton>
              )}
            </div>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filas.map((f) => {
            const estado = definir(ESTADO_OT, f.orden_estado)
            const prioridad = definir(PRIORIDAD, f.prioridad)
            // Una orden sin unidad y una unidad sin placa no son lo mismo, y la
            // tarjeta lo tiene que decir: sin `unidad_id` no hay nada que
            // nombrar; con él, el nombre lo decide `nombreDeUnidad` (placa,
            // código interno, chasis, o marca y modelo).
            const unidad = f.unidad_id ? f : null
            const noEsMatricula = !unidad || todaviaSinPlaca(unidad)
            const sinNoticias = f.dias_sin_avance === null ? null : Number(f.dias_sin_avance)
            const restantes =
              f.dias_habiles_restantes === null ? null : Number(f.dias_habiles_restantes)

            return (
              // `relative` + el `after` del enlace: en el teléfono se abre la
              // unidad tocando la tarjeta entera, no apuntando a la placa. No hay
              // otro enlace dentro, así que nada queda tapado.
              <Tarjeta key={f.orden_id} className="relative flex flex-col">
                <TarjetaCuerpo className="flex flex-1 flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {/* Cuando ese texto no es una matrícula va en letra
                          tenue: de lejos, y con el teléfono en la mano, se ve
                          que a esa unidad todavía le falta la placa. No lleva
                          además un «sin placa» al lado porque el propio nombre
                          ya lo dice cuando cae en la marca y el modelo. */}
                      <Link
                        href={`/avance/${f.orden_id}`}
                        className={`text-base font-semibold after:absolute after:inset-0 hover:underline ${
                          noEsMatricula ? 'text-texto-suave' : 'text-acento'
                        }`}
                      >
                        {nombreDeUnidad(unidad)}
                      </Link>
                      <p className="truncate text-xs text-texto-suave">
                        {f.orden_numero} · {f.cliente}
                      </p>
                    </div>
                    <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                  </div>

                  <p className="line-clamp-2 text-sm text-texto">{f.descripcion}</p>

                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-texto-suave">
                        {f.etapa_actual ?? 'Sin etapa en proceso'}
                      </span>
                      <span className="tabular font-medium text-texto">
                        {Math.round(Number(f.avance_porcentaje))}%
                      </span>
                    </div>
                    <Progreso valor={Number(f.avance_porcentaje)} alto="sm" />
                  </div>

                  {f.impedimento && (
                    <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      <span className="line-clamp-2">{f.impedimento}</span>
                    </p>
                  )}

                  <div className="mt-auto space-y-1.5 border-t border-borde pt-3 text-xs">
                    <p className="flex items-center gap-1.5 text-texto-suave">
                      <Clock aria-hidden className="size-3.5 shrink-0" />
                      {sinNoticias === null ? (
                        <span className="text-aviso">Todavía sin avance registrado</span>
                      ) : sinNoticias === 0 ? (
                        <span>Avance registrado hoy</span>
                      ) : (
                        <span className={sinNoticias >= 3 ? 'text-aviso' : undefined}>
                          {sinNoticias} {sinNoticias === 1 ? 'día' : 'días'} sin avance
                        </span>
                      )}
                    </p>

                    {f.ultimo_avance && (
                      <p className="line-clamp-2 text-texto-suave">
                        <span className="text-texto-tenue">
                          {formatearFecha(f.ultimo_avance_fecha)}:{' '}
                        </span>
                        {f.ultimo_avance}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-1 text-texto-tenue">
                      <span className="flex items-center gap-1">
                        <Camera aria-hidden className="size-3.5" />
                        {f.fotos} {f.fotos === 1 ? 'foto' : 'fotos'}
                      </span>
                      <span className="flex items-center gap-2">
                        <span>{prioridad.etiqueta}</span>
                        {restantes !== null && (
                          <span className={restantes < 0 ? 'font-medium text-peligro' : undefined}>
                            {restantes < 0
                              ? `${Math.abs(restantes)} días de atraso`
                              : `quedan ${restantes} días`}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </TarjetaCuerpo>
              </Tarjeta>
            )
          })}
        </div>
      )}

      {/* Las unidades que entraron sin orden de trabajo. Van en su propia
          sección y no mezcladas con las órdenes: son otra cosa —sin etapas,
          sin plazo, sin cliente en el sistema— y se leen distinto. */}
      <section id="sin-orden" className="mt-8" aria-labelledby="titulo-sin-orden">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="titulo-sin-orden" className="text-base font-semibold text-texto">
              Unidades sin orden
            </h2>
            <p className="text-sm text-texto-suave">
              Entraron al taller antes de que saliera su orden de trabajo. Se reportan igual, para que
              el jefe y la oficina sepan que están acá.
            </p>
          </div>
          <Link
            href="/avance/flota"
            className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0"
          >
            Ver todas, incluidas las que salieron
          </Link>
        </div>

        {flotaVisible.length === 0 ? (
          <Tarjeta>
            <TarjetaCuerpo>
              <p className="text-sm font-medium text-texto">
                {soloTrabadas ? 'Ninguna unidad sin orden está trabada' : 'Ninguna unidad sin orden en el taller'}
              </p>
              <p className="mt-1 text-sm text-texto-suave">
                {soloTrabadas
                  ? 'Las que están se pueden seguir trabajando.'
                  : puedeRegistrarFlota
                    ? 'Cuando llegue una, regístrala con «Llegó una unidad sin orden», arriba.'
                    : 'Las registra el supervisor de cada área.'}
              </p>
            </TarjetaCuerpo>
          </Tarjeta>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {flotaVisible.map((u) => {
              const estado = definir(ESTADO_FLOTA, u.estado)
              const dias = Number(u.dias_en_taller ?? 0)
              const sinReporte = Number(u.dias_sin_avance ?? 0)

              return (
                <Tarjeta key={u.id} className="relative flex flex-col">
                  <TarjetaCuerpo className="flex flex-1 flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/avance/flota/${u.id}`}
                          className={`text-base font-semibold after:absolute after:inset-0 hover:underline ${
                            u.placa ? 'text-acento' : 'text-texto-suave'
                          }`}
                        >
                          {nombreDeFlota(u)}
                        </Link>
                        <p className="truncate text-xs text-texto-suave">
                          {[u.placa ? u.descripcion : null, u.cliente].filter(Boolean).join(' · ') ||
                            'sin más datos'}
                        </p>
                      </div>
                      <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                    </div>

                    <p className="line-clamp-2 text-sm text-texto">{u.trabajo}</p>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-texto-suave">{u.area_actual ?? 'Sin reportes todavía'}</span>
                      {u.avance_porcentaje !== null && (
                        <span className="tabular text-texto-suave">va en ~{numero(u.avance_porcentaje, 0)} %</span>
                      )}
                    </div>

                    {u.impedimento && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
                        <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span className="line-clamp-2">{u.impedimento}</span>
                      </p>
                    )}

                    <div className="mt-auto space-y-1.5 border-t border-borde pt-3 text-xs">
                      <p className="flex items-center gap-1.5 text-texto-suave">
                        <Clock aria-hidden className="size-3.5 shrink-0" />
                        {u.estado === 'LISTA' ? (
                          <span className="text-exito">Lista desde {formatearFecha(u.lista_en)}</span>
                        ) : sinReporte === 0 ? (
                          <span>Reporte de hoy</span>
                        ) : (
                          <span className={sinReporte >= 3 ? 'text-aviso' : undefined}>
                            {sinReporte} {sinReporte === 1 ? 'día' : 'días'} sin reporte
                          </span>
                        )}
                      </p>

                      {u.ultimo_avance && (
                        <p className="line-clamp-2 text-texto-suave">
                          <span className="text-texto-tenue">{formatearFecha(u.ultimo_avance_fecha)}: </span>
                          {u.ultimo_avance}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-1 text-texto-tenue">
                        <span className="flex items-center gap-1">
                          <Camera aria-hidden className="size-3.5" />
                          {u.fotos} {u.fotos === 1 ? 'foto' : 'fotos'}
                        </span>
                        <span className={dias >= 5 ? 'font-medium text-aviso' : undefined}>
                          lleva {dias} {dias === 1 ? 'día' : 'días'} · sin orden
                        </span>
                      </div>
                    </div>
                  </TarjetaCuerpo>
                </Tarjeta>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

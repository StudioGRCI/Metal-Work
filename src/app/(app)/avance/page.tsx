import { AlertTriangle, Camera, Clock } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarTablero, resumirTablero } from '@/lib/datos/avances'
import { ESTADO_OT, PRIORIDAD, definir } from '@/lib/dominio/estados'
import { fecha as formatearFecha } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Avance en taller' }

const FILTROS = [
  { valor: null, etiqueta: 'Todas' },
  { valor: '1', etiqueta: 'Solo las trabadas' },
]

export default async function PaginaAvance({ searchParams }: PageProps<'/avance'>) {
  await exigirPermiso('produccion.ver')
  const params = await searchParams
  const soloTrabadas = params.trabadas === '1'

  const filas = await listarTablero({ trabadas: soloTrabadas })
  const resumen = resumirTablero(filas)

  return (
    <>
      <EncabezadoPagina
        titulo="Avance en taller"
        descripcion="Una tarjeta por unidad: dónde está, cuánto lleva, hace cuánto no se toca y qué la traba."
      />

      {/* Dos por fila en el teléfono; las cuatro de siempre en el monitor. */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Indicador
          titulo="Unidades en taller"
          valor={resumen.total}
          pie={soloTrabadas ? 'Contando solo las trabadas' : undefined}
        />
        <Indicador
          titulo="Trabadas"
          valor={resumen.trabadas}
          pie="Esperando material o decisión"
          tono={resumen.trabadas > 0 ? 'peligro' : 'neutro'}
          /* Este número sí tiene una lista detrás; los otros tres todavía no
             tienen filtro en la consulta, así que no llevan a ninguna parte. */
          href={soloTrabadas ? undefined : '/avance?trabadas=1'}
        />
        <Indicador
          titulo="Sin noticias"
          valor={resumen.sinNoticias}
          pie="Tres días o más sin avance registrado"
          tono={resumen.sinNoticias > 0 ? 'aviso' : 'neutro'}
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
              {soloTrabadas ? 'Ninguna unidad está trabada' : 'No hay unidades en el taller'}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              {soloTrabadas
                ? 'Todo lo que está en el taller puede seguir avanzando.'
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
                      <Link
                        href={`/avance/${f.orden_id}`}
                        className="text-base font-semibold text-acento after:absolute after:inset-0 hover:underline"
                      >
                        {f.placa ?? f.orden_numero}
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
    </>
  )
}

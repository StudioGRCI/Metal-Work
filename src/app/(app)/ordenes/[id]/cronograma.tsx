import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_PLAZO } from '@/lib/dominio/estados'
import { fecha, hoyLima, numero } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Vistas } from '@/types/database'

export type FilaCronograma = Vistas<'v_cronograma_ot'>


const DIA = 86_400_000

/** Un día contado desde 1970, sin hora: es lo único que un Gantt necesita. */
function dia(valor: string | null | undefined): number | null {
  if (!valor) return null
  const t = Date.parse(`${valor.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(t) ? Math.floor(t / DIA) : null
}

function etiquetaDia(d: number) {
  return new Date(d * DIA).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
}

/**
 * La orden como diagrama de Gantt.
 *
 * Una fila por etapa con dos barras: la programada —lo que salió del tiempo
 * por área de la cotización de trabajo— hueca, y la real llena, del color del
 * semáforo. La línea vertical es hoy. Es lo que Administración pidió ver en
 * lugar de la lista de etapas: de un vistazo, qué área va tarde y cuánto.
 *
 * Es un componente de servidor: las fechas son planas y «hoy» es el del
 * taller, así que el navegador no recalcula nada.
 */
export function Cronograma({
  filas,
  entregaComprometida,
}: {
  filas: FilaCronograma[]
  entregaComprometida: string | null
}) {
  if (filas.length === 0) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="py-10 text-center text-sm text-texto-suave">
            El cronograma se arma al aprobar la orden, con el tiempo por área de su cotización.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  const hoy = dia(hoyLima()) ?? 0
  const entrega = dia(entregaComprometida)

  const dias = filas
    .flatMap((f) => [
      dia(f.fecha_inicio_programada),
      dia(f.fecha_fin_programada),
      dia(f.fecha_inicio_real),
      dia(f.fecha_fin_real),
    ])
    .concat([entrega, hoy])
    .filter((d): d is number => d !== null)

  // Un día de aire a cada lado, y nunca menos de dos semanas para que las
  // barras de una orden corta no se vuelvan un bloque.
  const desde = Math.min(...dias) - 1
  let hasta = Math.max(...dias) + 1
  if (hasta - desde < 14) hasta = desde + 14
  const total = hasta - desde + 1
  const pct = (d: number) => `${((d - desde) / total) * 100}%`
  const ancho = (a: number, b: number) => `${((b - a + 1) / total) * 100}%`

  const semanas: number[] = []
  for (let d = desde; d <= hasta; d += 7) semanas.push(d)

  const vencidas = filas.filter((f) => f.plazo === 'VENCIDO').length
  const porVencer = filas.filter((f) => f.plazo === 'POR_VENCER').length
  const sinFechas = filas.filter((f) => !f.fecha_fin_programada).length

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Cronograma de la orden"
        descripcion={[
          `${filas.length} etapas`,
          vencidas > 0 ? `${vencidas} vencida${vencidas === 1 ? '' : 's'}` : null,
          porVencer > 0 ? `${porVencer} por vencer` : null,
          entregaComprometida ? `entrega comprometida el ${fecha(entregaComprometida)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <TarjetaCuerpo className="p-0">
        {sinFechas > 0 && (
          <p className="border-b border-borde bg-aviso-suave px-3 py-2 text-xs text-aviso">
            {sinFechas === filas.length
              ? 'Las etapas no tienen fechas programadas: la orden se aprobó sin tiempo por área en su cotización.'
              : `${sinFechas} etapa${sinFechas === 1 ? '' : 's'} sin fecha programada.`}
          </p>
        )}

        {/* El diagrama es ancho a propósito: en el teléfono se arrastra. */}
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid" style={{ gridTemplateColumns: '240px 1fr' }}>
              <div className="border-b border-borde px-3 py-2 text-[11px] font-semibold tracking-wide text-texto-suave uppercase">
                Etapa · área
              </div>
              <div className="relative h-8 border-b border-l border-borde">
                {semanas.map((s) => (
                  <span
                    key={s}
                    className="absolute top-2 -translate-x-1/2 text-[10px] whitespace-nowrap text-texto-suave"
                    style={{ left: pct(s) }}
                  >
                    {etiquetaDia(s)}
                  </span>
                ))}
              </div>
            </div>

            {filas.map((f) => {
              const semaforo = f.plazo ? ESTADO_PLAZO[f.plazo] : null
              const pi = dia(f.fecha_inicio_programada)
              const pf = dia(f.fecha_fin_programada)
              const ri = dia(f.fecha_inicio_real)
              // Una etapa empezada y no terminada sigue corriendo hasta hoy.
              const rf = dia(f.fecha_fin_real) ?? (ri !== null ? Math.max(ri, hoy) : null)
              const cerrada = f.plazo === 'CUMPLIDO' || f.plazo === 'CUMPLIDO_TARDE'

              return (
                <div
                  key={f.etapa_id}
                  className="grid border-b border-borde last:border-0"
                  style={{ gridTemplateColumns: '240px 1fr' }}
                >
                  <div className="flex min-w-0 flex-col justify-center px-3 py-2">
                    <p className="truncate text-sm font-medium text-texto">{f.etapa}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-texto-suave">
                      {f.area_codigo && (
                        <span className="rounded bg-superficie-2 px-1 font-semibold">{f.area_codigo}</span>
                      )}
                      {f.area_nombre}
                      {semaforo && (
                        <Insignia tono={semaforo.tono} className="ml-auto">
                          {semaforo.etiqueta}
                          {!cerrada && f.dias !== null && f.dias !== undefined && (
                            <span className="tabular ml-1 font-normal">
                              {f.dias < 0 ? `+${-f.dias} d` : `${f.dias} d`}
                            </span>
                          )}
                        </Insignia>
                      )}
                    </p>
                  </div>

                  <div className="relative h-12 border-l border-borde">
                    {semanas.map((s) => (
                      <span
                        key={s}
                        aria-hidden
                        className="absolute inset-y-0 border-l border-dashed border-borde"
                        style={{ left: pct(s) }}
                      />
                    ))}

                    {pi !== null && pf !== null && (
                      <div
                        title={`Programado: ${fecha(f.fecha_inicio_programada)} → ${fecha(f.fecha_fin_programada)}`}
                        className="absolute top-2 h-3 rounded-sm border border-texto-tenue/70 bg-superficie"
                        style={{ left: pct(pi), width: ancho(pi, pf) }}
                      />
                    )}

                    {ri !== null && rf !== null && (
                      <div
                        title={`Real: ${fecha(f.fecha_inicio_real)} → ${f.fecha_fin_real ? fecha(f.fecha_fin_real) : 'en curso'} · ${numero(f.avance_porcentaje, 0)}%`}
                        className={cn(
                          'absolute top-6 h-3 rounded-sm',
                          semaforo?.barra ?? 'bg-acento',
                          !f.fecha_fin_real && 'opacity-80',
                        )}
                        style={{ left: pct(ri), width: ancho(ri, rf) }}
                      >
                        <span className="sr-only">
                          {`Real: ${fecha(f.fecha_inicio_real)} → ${f.fecha_fin_real ? fecha(f.fecha_fin_real) : 'en curso'}`}
                        </span>
                      </div>
                    )}

                    {ri === null && Number(f.avance_porcentaje ?? 0) > 0 && pi !== null && pf !== null && (
                      /* Avance sin fecha real: se pinta sobre lo programado, en
                         proporción, para que no parezca que no pasó nada. */
                      <div
                        className={cn('absolute top-6 h-3 rounded-sm', semaforo?.barra ?? 'bg-acento', 'opacity-60')}
                        style={{
                          left: pct(pi),
                          width: `${((pf - pi + 1) / total) * Math.min(100, Number(f.avance_porcentaje))}%`,
                        }}
                      />
                    )}

                    <span
                      aria-hidden
                      className="absolute inset-y-0 border-l-2 border-peligro"
                      style={{ left: pct(hoy) }}
                    />
                    {entrega !== null && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 border-l-2 border-dotted border-exito"
                        style={{ left: pct(entrega) }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-borde px-3 py-2 text-[11px] text-texto-suave">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-6 rounded-sm border border-texto-tenue/70 bg-superficie" />
            Programado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-6 rounded-sm bg-acento" />
            Real
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 border-l-2 border-peligro" />
            Hoy, {fecha(hoyLima())}
          </span>
          {entregaComprometida && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 border-l-2 border-dotted border-exito" />
              Entrega comprometida
            </span>
          )}
          <span className="ml-auto">
            Vencido {'>'} 0 d · Por vencer ≤ 7 d — la fórmula de su control de plazos
          </span>
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

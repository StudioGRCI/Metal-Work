import Link from 'next/link'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import type { Equipo, HistoriaDeEquipo } from '@/lib/datos/equipos'
import { horas, horasParadoSugeridas, losQueMasFallan, tiempoParado } from '@/lib/dominio/averias'
import { fecha } from '@/lib/format'

/** Cuántos de los que más fallan se muestran. */
const LOS_QUE_MAS_FALLAN = 5

/**
 * La lectura de Gerencia (Plan 16.4, DKS: «equipos parados hoy, los que más
 * fallan»), arriba del padrón: qué equipos no se pueden usar hoy, desde cuándo
 * y por qué; y los que más fallaron en los últimos 90 días. Cada uno lleva a
 * su historia.
 */
export function LecturaDeEquipos({
  parados,
  totalParados,
  historia,
  nombres,
}: {
  /** Los equipos parados hoy (la primera página del padrón filtrado). */
  parados: Equipo[]
  totalParados: number
  historia: Map<string, HistoriaDeEquipo>
  nombres: Map<string, { codigo: string; descripcion: string }>
}) {
  const fallan = losQueMasFallan(
    [...historia.entries()].map(([id, h]) => ({ id, ...h })),
    LOS_QUE_MAS_FALLAN,
  )
  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-2" data-lectura-equipos>
      <Tarjeta className="overflow-hidden" data-parados-hoy>
        <TarjetaCabecera
          titulo={`Parados hoy${totalParados > 0 ? ` · ${totalParados}` : ''}`}
          descripcion={totalParados > 0 ? 'No se pueden usar: desde cuándo y por qué.' : undefined}
        />
        {parados.length === 0 ? (
          <div className="px-4 pb-4">
            <SinDatos compacto titulo="Ningún equipo parado" descripcion="Todos los equipos en uso se pueden usar hoy." />
          </div>
        ) : (
          <ul className="divide-y divide-borde border-t border-borde">
            {parados.map((e) => {
              const h = historia.get(e.id)
              const lleva = h?.paradoDesde ? horasParadoSugeridas(h.paradoDesde) : null
              return (
                <li key={e.id} className="px-4 py-3 text-sm" data-parado={e.codigo}>
                  <Link href={`/equipos/${e.id}`} className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0">
                    <span className="tabular">{e.codigo}</span>
                    <span className="px-1 text-texto-suave">·</span>
                    {e.descripcion}
                  </Link>
                  {e.estado_nota && <p className="mt-0.5 line-clamp-2 text-texto">{e.estado_nota}</p>}
                  <p className="mt-0.5 text-xs text-texto-suave">
                    {[
                      `Desde el ${fecha(e.estado_desde)}`,
                      lleva != null ? `lleva ${tiempoParado(lleva)}` : null,
                      h?.paradoPor ? `por el reporte ${h.paradoPor}` : 'parado a mano en el padrón',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              )
            })}
            {totalParados > parados.length && (
              <li className="px-4 py-3 text-sm">
                <Link href="/equipos?estado=parados" className="text-acento hover:underline">
                  Ver los {totalParados} parados
                </Link>
              </li>
            )}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta className="overflow-hidden" data-los-que-mas-fallan>
        <TarjetaCabecera
          titulo="Los que más fallan"
          descripcion="En los últimos 90 días: los que tuvieron más averías y, entre iguales, los que estuvieron más horas parados."
        />
        {fallan.length === 0 ? (
          <div className="px-4 pb-4">
            <SinDatos compacto titulo="Ninguna avería en 90 días" descripcion="Cuando un equipo falle, aparece aquí con sus averías y sus horas parado." />
          </div>
        ) : (
          <ol className="divide-y divide-borde border-t border-borde">
            {fallan.map((f) => {
              const n = nombres.get(f.id)
              return (
                <li key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm" data-falla={n?.codigo}>
                  <Link href={`/equipos/${f.id}`} className="inline-flex min-h-11 min-w-0 flex-1 items-center font-medium text-acento hover:underline sm:min-h-0">
                    <span className="tabular">{n?.codigo ?? 'Equipo'}</span>
                    {n && (
                      <>
                        <span className="px-1 text-texto-suave">·</span>
                        <span className="truncate">{n.descripcion}</span>
                      </>
                    )}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-texto-suave">
                    <span className="tabular font-medium text-texto">
                      {f.averias90} {f.averias90 === 1 ? 'avería' : 'averías'}
                    </span>
                    <span>·</span>
                    <span className="tabular">{horas(f.horasParado90)} parado</span>
                    {f.repetidas90 > 0 && (
                      <Insignia tono="aviso">
                        {f.repetidas90} {f.repetidas90 === 1 ? 'repetida' : 'repetidas'}
                      </Insignia>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </Tarjeta>
    </div>
  )
}

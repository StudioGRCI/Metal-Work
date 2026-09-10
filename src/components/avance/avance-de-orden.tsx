import { AlertTriangle } from 'lucide-react'

import { RegistrarAvance } from '@/app/(app)/avance/registrar-avance'
import { CorregirReporte } from '@/components/avance/corregir-reporte'
import { RevisarReporte } from '@/components/avance/revisar-reporte'
import { FirmaRevision, InsigniaRevision, NotaRevision } from '@/components/avance/revision'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { enlacesDeFotos, etapasDeLaOrden, fotosDeAvances, listarAvances } from '@/lib/datos/avances'
import { fecha as formatearFecha, hoyLima } from '@/lib/format'
import { puede, puedeCorregirReporte, type PerfilSesion } from '@/lib/sesion'

/**
 * La línea de avance de una unidad: qué se hizo cada día y la foto de cómo
 * quedó. Se usa igual en la pantalla del taller y en la pestaña de la orden.
 * Cada avance dice en qué va con el jefe, que lo aprueba u observa desde acá.
 */
export async function AvanceDeOrden({
  ordenId,
  perfil,
  conCabecera = false,
}: {
  ordenId: string
  perfil: PerfilSesion
  conCabecera?: boolean
}) {
  const [avances, etapas] = await Promise.all([listarAvances(ordenId), etapasDeLaOrden(ordenId)])

  const fotos = await fotosDeAvances(avances.map((a) => a.id))
  const enlaces = await enlacesDeFotos(
    Object.values(fotos)
      .flat()
      .map((f) => f.ruta_storage),
  )

  const aprueba = puede(perfil, 'produccion.aprobar_reportes')
  const hoy = hoyLima()

  const lista =
    avances.length === 0 ? (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="text-sm font-medium text-texto">Todavía no hay avance registrado</p>
          <p className="mt-1 text-sm text-texto-suave">
            Cada día que se trabaja esta unidad, una línea acá y una foto. Es lo que después se le
            muestra al cliente sin tener que bajar al taller.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    ) : (
      <ol className="space-y-4">
        {avances.map((a) => {
          const suyas = fotos[a.id] ?? []
          const corrige = puedeCorregirReporte(
            perfil,
            { clase: 'orden', revision: a.revision, autor: a.registrado_por, fecha: a.fecha },
            hoy,
          )
          const revisa = aprueba && a.revision !== 'APROBADO'

          return (
            <li key={a.id}>
              <Tarjeta>
                <TarjetaCuerpo className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-texto">
                      <span>
                        {formatearFecha(a.fecha)}
                        {a.etapa && <span className="text-texto-suave"> · {a.etapa}</span>}
                      </span>
                      <InsigniaRevision revision={a.revision} />
                    </p>
                    <p className="text-xs text-texto-tenue">
                      {a.registrado_por_nombre ?? 'Sin registrar'}
                      {a.avance_porcentaje !== null && (
                        <span className="ml-2 font-medium text-texto-suave">
                          etapa al {Math.round(Number(a.avance_porcentaje))}%
                        </span>
                      )}
                    </p>
                  </div>

                  <p className="text-sm text-texto">{a.descripcion}</p>

                  {a.impedimento && (
                    <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      <span>{a.impedimento}</span>
                    </p>
                  )}

                  {suyas.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {suyas.map((f) => {
                        const url = enlaces[f.ruta_storage]
                        if (!url) return null

                        return (
                          <a
                            key={f.id}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block size-28 overflow-hidden rounded-[var(--radius-base)] border border-borde hover:opacity-90"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={f.pie ?? `Avance del ${formatearFecha(a.fecha)}`}
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          </a>
                        )
                      })}
                    </div>
                  )}

                  <NotaRevision r={a} />
                  <FirmaRevision r={a} />

                  {(revisa || corrige) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {revisa && <RevisarReporte clase="orden" id={a.id} revision={a.revision} />}
                      {corrige && (
                        <CorregirReporte
                          reporte={{
                            clase: 'orden',
                            id: a.id,
                            fecha: a.fecha,
                            descripcion: a.descripcion,
                            impedimento: a.impedimento,
                          }}
                          observacion={a.revision === 'OBSERVADO' ? a.observacion : null}
                          destacado={a.revision === 'OBSERVADO'}
                        />
                      )}
                    </div>
                  )}
                </TarjetaCuerpo>
              </Tarjeta>
            </li>
          )
        })}
      </ol>
    )

  if (!conCabecera) return lista

  return (
    <div className="space-y-4">
      <Tarjeta>
        <TarjetaCabecera
          titulo="Avance de la unidad"
          descripcion="Lo que se hizo cada día, con foto. Es el registro que se le enseña al cliente."
          acciones={
            puede(perfil, 'produccion.registrar') && (
              <RegistrarAvance
                ordenId={ordenId}
                etapas={etapas}
                trabaActual={avances[0]?.impedimento ?? null}
                compacto
              />
            )
          }
        />
      </Tarjeta>
      {lista}
    </div>
  )
}

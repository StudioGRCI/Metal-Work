import { AlertTriangle } from 'lucide-react'

import { RegistrarAvance } from '@/app/(app)/avance/registrar-avance'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { enlacesDeFotos, etapasDeLaOrden, fotosDeAvances, listarAvances } from '@/lib/datos/avances'
import { fecha as formatearFecha } from '@/lib/format'

/**
 * La línea de avance de una unidad: qué se hizo cada día y la foto de cómo
 * quedó. Se usa igual en la pantalla del taller y en la pestaña de la orden.
 */
export async function AvanceDeOrden({
  ordenId,
  puedeRegistrar,
  conCabecera = false,
}: {
  ordenId: string
  puedeRegistrar: boolean
  conCabecera?: boolean
}) {
  const [avances, etapas] = await Promise.all([listarAvances(ordenId), etapasDeLaOrden(ordenId)])

  const fotos = await fotosDeAvances(avances.map((a) => a.id))
  const enlaces = await enlacesDeFotos(
    Object.values(fotos)
      .flat()
      .map((f) => f.ruta_storage),
  )

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

          return (
            <li key={a.id}>
              <Tarjeta>
                <TarjetaCuerpo className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-texto">
                      {formatearFecha(a.fecha)}
                      {a.etapa && <span className="text-texto-suave"> · {a.etapa}</span>}
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
            puedeRegistrar && <RegistrarAvance ordenId={ordenId} etapas={etapas} compacto />
          }
        />
      </Tarjeta>
      {lista}
    </div>
  )
}

import { AlertTriangle } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { enlacesDeFotos } from '@/lib/datos/avances'
import { fotosDeReportesFlota, reportesDeFlota } from '@/lib/datos/flota'
import { fecha as formatearFecha, numero } from '@/lib/format'

/**
 * La línea de reportes de una unidad sin orden: qué se le hizo cada día, de
 * qué área, y la foto de cómo quedó. Gemela de `AvanceDeOrden`, con el área en
 * cada renglón porque la unidad pasa por varias.
 */
export async function AvanceDeFlota({ flotaId }: { flotaId: string }) {
  const reportes = await reportesDeFlota(flotaId)
  const fotos = await fotosDeReportesFlota(reportes.map((r) => r.id))
  const enlaces = await enlacesDeFotos(
    Object.values(fotos)
      .flat()
      .map((f) => f.ruta_storage),
  )

  if (reportes.length === 0) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="text-sm font-medium text-texto">Todavía no hay reportes</p>
          <p className="mt-1 text-sm text-texto-suave">
            Cada día que se trabaje esta unidad, una línea acá con su foto: cómo llegó, qué se le
            hizo y cómo quedó. Se escribe con «Reportar», arriba.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  return (
    <ol className="space-y-4">
      {reportes.map((r) => {
        const suyas = fotos[r.id] ?? []

        return (
          <li key={r.id}>
            <Tarjeta>
              <TarjetaCuerpo className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-texto">
                    {formatearFecha(r.fecha)}
                    <Insignia tono="neutro" className="ml-2">
                      {r.area}
                    </Insignia>
                  </p>
                  <p className="text-xs text-texto-tenue">
                    {r.registrado_por_nombre ?? 'Sin registrar'}
                    {r.avance_porcentaje !== null && (
                      <span className="ml-2 font-medium text-texto-suave">
                        va en ~{numero(r.avance_porcentaje, 0)} %
                      </span>
                    )}
                  </p>
                </div>

                <p className="text-sm text-texto">{r.descripcion}</p>

                {r.impedimento && (
                  <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>{r.impedimento}</span>
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
                            alt={f.pie ?? `Reporte del ${formatearFecha(r.fecha)}`}
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
}

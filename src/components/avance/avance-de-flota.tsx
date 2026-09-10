import { AlertTriangle } from 'lucide-react'

import { Miniaturas } from '@/components/avance/miniaturas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { enlacesDeFotos } from '@/lib/datos/avances'
import { fotosDeReportesFlota, reportesDeFlota } from '@/lib/datos/flota'
import { fecha as formatearFecha, hora, numero } from '@/lib/format'

/**
 * La línea de reportes de un trabajo sin orden: qué se hizo cada día, de qué
 * área, a qué hora y la foto de cómo quedó. Gemela de `AvanceDeOrden`, con el
 * área en cada renglón porque el trabajo pasa por varias.
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
            Cada día que se trabaje, una línea acá con su foto: cómo empezó, qué se hizo y cómo
            quedó. Se escribe con «Reportar», arriba.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  return (
    <ol className="space-y-3">
      {reportes.map((r) => (
        <li key={r.id}>
          <Tarjeta>
            <TarjetaCuerpo className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="flex items-center gap-2 text-sm font-medium text-texto">
                  {formatearFecha(r.fecha)}
                  <Insignia tono="neutro">{r.area}</Insignia>
                </p>
                <p className="text-xs text-texto-tenue">
                  {r.registrado_por_nombre ?? 'Sin registrar'} · {hora(r.creado_en)}
                </p>
              </div>

              <p className="text-sm text-texto">{r.descripcion}</p>

              {r.avance_porcentaje !== null && (
                <p className="text-xs font-medium text-texto-suave">va en ~{numero(r.avance_porcentaje, 0)} %</p>
              )}

              {r.impedimento && (
                <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span>{r.impedimento}</span>
                </p>
              )}

              <Miniaturas
                fotos={fotos[r.id] ?? []}
                enlaces={enlaces}
                alt={`Reporte del ${formatearFecha(r.fecha)}`}
              />
            </TarjetaCuerpo>
          </Tarjeta>
        </li>
      ))}
    </ol>
  )
}

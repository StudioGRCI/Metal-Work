import { AlertTriangle, Camera, Clock } from 'lucide-react'
import Link from 'next/link'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { TrabajoSinOrden } from '@/lib/datos/flota'
import { ESTADO_FLOTA, definir } from '@/lib/dominio/estados'
import { nombreDeFlota } from '@/lib/dominio/unidades'
import { fecha as formatearFecha, numero } from '@/lib/format'

/**
 * Un trabajo sin orden en una tarjeta: qué es, en qué va, qué lo traba y hace
 * cuánto no se sabe nada. La misma en el tablero del taller y en la lista, para
 * que se lea igual en los dos lados y en el teléfono no haya tabla que deslizar.
 * Toda la tarjeta abre el trabajo.
 */
export function TarjetaTrabajo({ trabajo: t }: { trabajo: TrabajoSinOrden }) {
  const estado = definir(ESTADO_FLOTA, t.estado)
  const dias = Number(t.dias_en_taller ?? 0)
  const sinReporte = Number(t.dias_sin_avance ?? 0)
  const detalle = [t.placa ? t.descripcion : null, t.cliente].filter(Boolean).join(' · ')

  return (
    <Tarjeta className="relative flex flex-col">
      <TarjetaCuerpo className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/avance/trabajos/${t.id}`}
              className="text-base font-semibold text-acento after:absolute after:inset-0 hover:underline"
            >
              {nombreDeFlota(t)}
            </Link>
            {detalle && <p className="truncate text-xs text-texto-suave">{detalle}</p>}
          </div>
          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
        </div>

        <p className="line-clamp-2 text-sm text-texto">{t.trabajo}</p>

        <div className="flex items-center justify-between text-xs">
          <span className="text-texto-suave">{t.area_actual ?? 'Sin reportes todavía'}</span>
          {t.avance_porcentaje !== null && (
            <span className="tabular text-texto-suave">va en ~{numero(t.avance_porcentaje, 0)} %</span>
          )}
        </div>

        {t.impedimento && (
          <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="line-clamp-2">{t.impedimento}</span>
          </p>
        )}

        <div className="mt-auto space-y-1.5 border-t border-borde pt-3 text-xs">
          <p className="flex items-center gap-1.5 text-texto-suave">
            <Clock aria-hidden className="size-3.5 shrink-0" />
            {t.estado === 'SALIO' ? (
              <span>Cerrado el {formatearFecha(t.salio_en)}</span>
            ) : t.estado === 'LISTA' ? (
              <span className="text-exito">Terminado el {formatearFecha(t.lista_en)}</span>
            ) : sinReporte === 0 ? (
              <span>Reporte de hoy</span>
            ) : (
              <span className={sinReporte >= 3 ? 'text-aviso' : undefined}>
                {sinReporte} {sinReporte === 1 ? 'día' : 'días'} sin reporte
              </span>
            )}
          </p>

          {t.ultimo_avance && (
            <p className="line-clamp-2 text-texto-suave">
              <span className="text-texto-tenue">{formatearFecha(t.ultimo_avance_fecha)}: </span>
              {t.ultimo_avance}
            </p>
          )}

          <div className="flex items-center justify-between pt-1 text-texto-tenue">
            <span className="flex items-center gap-1">
              <Camera aria-hidden className="size-3.5" />
              {t.fotos} {t.fotos === 1 ? 'foto' : 'fotos'}
            </span>
            {t.estado !== 'SALIO' && (
              <span className={dias >= 5 ? 'font-medium text-aviso' : undefined}>
                lleva {dias} {dias === 1 ? 'día' : 'días'} · sin orden
              </span>
            )}
          </div>
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

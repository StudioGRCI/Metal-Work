import { moneda, porcentaje } from '@/lib/format'
import type { ComposicionCosto } from '@/lib/dominio/expediente'
import { cn } from '@/lib/utils'

/**
 * El costo de una moneda en una sola barra repartida: material, mano de obra y
 * gastos, siempre en ese orden y con el mismo color en todas las órdenes, para
 * que dos expedientes se comparen sin leer la leyenda dos veces.
 *
 * Los segmentos se separan con un hueco del color de la tarjeta, no con un
 * borde. Las cifras van en la leyenda —con texto, nunca del color de la serie—
 * y en la tabla del detalle.
 */
export function ComposicionDelCosto({ composicion }: { composicion: ComposicionCosto }) {
  const visibles = composicion.partes.filter((p) => p.monto > 0)
  const resumen = visibles.map((p) => `${p.etiqueta} ${porcentaje(p.pct)}`).join(', ')

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-texto-suave">Costo acumulado en {composicion.moneda === 'USD' ? 'dólares' : 'soles'}</span>
        <strong className="text-2xl font-semibold text-texto">{moneda(composicion.total, composicion.moneda)}</strong>
      </div>

      <div role="img" aria-label={`Reparto del costo: ${resumen}`} className="mt-3 flex h-3 w-full gap-0.5">
        {visibles.map((p, i) => (
          <span
            key={p.clave}
            title={`${p.etiqueta}: ${moneda(p.monto, composicion.moneda)} (${porcentaje(p.pct, 1)})`}
            className={cn(
              'h-full min-w-1 basis-0',
              p.serie,
              i === 0 && 'rounded-l-[4px]',
              i === visibles.length - 1 && 'rounded-r-[4px]',
            )}
            style={{ flexGrow: p.monto }}
          />
        ))}
      </div>

      <ul className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-3">
        {composicion.partes.map((p) => (
          <li key={p.clave} className="flex items-start gap-2 text-sm">
            <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-[3px]', p.serie)} />
            <span className="min-w-0">
              <span className="block text-texto-suave">{p.etiqueta}</span>
              <span className="tabular block font-medium text-texto">
                {moneda(p.monto, composicion.moneda)}
                <span className="font-normal text-texto-tenue"> · {porcentaje(p.pct)}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

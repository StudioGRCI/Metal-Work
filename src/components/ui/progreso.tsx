import { moneda, porcentaje, type CodigoMoneda } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Barra de avance de una orden, una etapa o un código. Cambia de color según el
 * tramo. Con `costo`, el porcentaje se lee también en plata («40 % · S/ 3,200.00»):
 * es lo que vale ese avance del presupuesto, o lo gastado, según quien la pinte
 * (DKS, 27/10/2026: toda la matemática en porcentaje y costo).
 */
export function Progreso({
  valor,
  className,
  mostrarValor = false,
  alto = 'md',
  etiqueta = 'Avance',
  costo,
  moneda: codigo = 'PEN',
}: {
  valor: number | string | null | undefined
  className?: string
  mostrarValor?: boolean
  alto?: 'sm' | 'md'
  etiqueta?: string
  /** Lo que vale ese porcentaje en plata; se muestra junto al número. */
  costo?: number | string | null
  moneda?: CodigoMoneda
}) {
  const pct = Math.min(100, Math.max(0, Number(valor ?? 0)))
  const color = pct >= 100 ? 'bg-exito' : pct >= 50 ? 'bg-acento' : 'bg-info'
  const conCosto = costo !== null && costo !== undefined

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={etiqueta}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={conCosto ? `${porcentaje(Math.round(pct))} · ${moneda(costo, codigo)}` : undefined}
        className={cn(
          'w-full overflow-hidden rounded-full bg-neutro-suave',
          alto === 'sm' ? 'h-1.5' : 'h-2',
        )}
      >
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      {(mostrarValor || conCosto) && (
        <span className={cn('tabular shrink-0 text-right text-xs whitespace-nowrap', conCosto ? 'text-texto' : 'w-10 text-texto-suave')}>
          {porcentaje(Math.round(pct))}
          {conCosto && <span className="text-texto-suave"> · {moneda(costo, codigo)}</span>}
        </span>
      )}
    </div>
  )
}

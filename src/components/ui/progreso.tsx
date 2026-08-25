import { cn } from '@/lib/utils'

/** Barra de avance de una orden o etapa. Cambia de color según el tramo. */
export function Progreso({
  valor,
  className,
  mostrarValor = false,
  alto = 'md',
}: {
  valor: number | string | null | undefined
  className?: string
  mostrarValor?: boolean
  alto?: 'sm' | 'md'
}) {
  const pct = Math.min(100, Math.max(0, Number(valor ?? 0)))
  const color = pct >= 100 ? 'bg-exito' : pct >= 50 ? 'bg-acento' : 'bg-info'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          'w-full overflow-hidden rounded-full bg-neutro-suave',
          alto === 'sm' ? 'h-1.5' : 'h-2',
        )}
      >
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      {mostrarValor && (
        <span className="tabular w-9 shrink-0 text-right text-xs text-texto-suave">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  )
}

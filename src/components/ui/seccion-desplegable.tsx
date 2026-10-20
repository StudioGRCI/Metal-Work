import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una sección de la pantalla que se abre al tocarla: una tarjeta cuyo título es
 * el pliegue («Pagados (N)», el historial, la configuración que se toca poco).
 * Para un pliegue chico dentro de una tarjeta o de un formulario, `Pliegue`, más
 * abajo: esta es una tarjeta y, dentro de otra, se ve como caja dentro de caja.
 *
 * `abierta` decide solo cómo sale al cargar: mientras no cambie, React no toca
 * el atributo y la sección se queda como la dejó la persona aunque la página se
 * refresque. Si se calcula con datos que cambian al guardar, quien la llama lo
 * fija con un `useState`, o se le cierra en la cara a quien está escribiendo.
 */
export function SeccionDesplegable({ id, titulo, descripcion, children, abierta = false, className }: {
  /** Para llegar con un ancla (`#equipo-diseno`); el `scroll-mt-*` va en `className`. */
  id?: string
  titulo: string; descripcion?: string; children: ReactNode; abierta?: boolean; className?: string
}) {
  return <details id={id} open={abierta || undefined} className={cn('group rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]', className)}>
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-[var(--radius-base)] p-4 text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
      <span className="min-w-0"><span className="block text-sm font-semibold">{titulo}</span>
        {descripcion && <span className="mt-1 block text-xs text-texto-suave">{descripcion}</span>}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-borde p-4">{children}</div>
  </details>
}

/**
 * El pliegue chico, dentro de una tarjeta o de un formulario: «Agregar persona a
 * mano», «Ver conceptos del Excel». Mismo chevron a la derecha que la sección y
 * 44 px de alto para el dedo; cada uno tenía su triángulo y su tamaño (en RR. HH.
 * convivían cuatro, uno de 20 px). `enCaja` lo enmarca cuando abre un formulario.
 */
export function Pliegue({ titulo, children, enCaja = false, className }: {
  titulo: ReactNode; children: ReactNode; enCaja?: boolean; className?: string
}) {
  return <details className={cn('group/pliegue', enCaja && 'rounded-[var(--radius-base)] border border-borde', className)}>
    <summary className={cn('flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-base)] text-sm font-medium text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden', enCaja && 'px-3')}>
      <span className="min-w-0">{titulo}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open/pliegue:rotate-180" />
    </summary>
    <div className={cn(enCaja ? 'border-t border-borde p-3' : 'pt-2')}>{children}</div>
  </details>
}

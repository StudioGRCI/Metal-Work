import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Una sección de la pantalla que se abre al tocarla: una tarjeta cuyo título es
 * el pliegue («Pagados (N)», el historial, la configuración que se toca poco).
 * Para un pliegue chico dentro de una fila o de un formulario, un `<details>`
 * suelto: esta es una tarjeta y, dentro de otra, se ve como caja dentro de caja.
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

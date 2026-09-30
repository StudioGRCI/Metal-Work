import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SeccionDesplegable({ titulo, descripcion, children, abierta = false, className }: {
  titulo: string; descripcion?: string; children: ReactNode; abierta?: boolean; className?: string
}) {
  return <details open={abierta || undefined} className={cn('group rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]', className)}>
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-[var(--radius-base)] p-4 text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
      <span className="min-w-0"><span className="block text-sm font-semibold">{titulo}</span>
        {descripcion && <span className="mt-1 block text-xs text-texto-suave">{descripcion}</span>}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-borde p-4">{children}</div>
  </details>
}

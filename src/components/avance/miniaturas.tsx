import { cn } from '@/lib/utils'

type Foto = { id: string; ruta_storage: string; pie?: string | null }

/**
 * Las fotos de un reporte, en una fila que se desliza de costado si no caben.
 *
 * Cada una abre la foto entera en otra pestaña. Los enlaces son firmados y
 * vencen a los diez minutos: una foto cuyo enlace no llegó simplemente no se
 * pinta, y el texto del reporte se lee igual.
 */
export function Miniaturas({
  fotos,
  enlaces,
  alt,
  className,
}: {
  fotos: Foto[]
  enlaces: Record<string, string>
  /** Lo que dice la foto a quien no la ve: «Reporte del 09/09/2026». */
  alt: string
  className?: string
}) {
  const visibles = fotos.filter((f) => enlaces[f.ruta_storage])
  if (visibles.length === 0) return null

  return (
    <div className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 pb-1', className)}>
      {visibles.map((f) => {
        const url = enlaces[f.ruta_storage]
        return (
          <a
            key={f.id}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block size-20 shrink-0 overflow-hidden rounded-[var(--radius-base)] border border-borde bg-superficie-2 hover:opacity-90 sm:size-24"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={f.pie ?? alt} loading="lazy" className="size-full object-cover" />
          </a>
        )
      })}
    </div>
  )
}

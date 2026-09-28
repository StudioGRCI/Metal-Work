import Link from 'next/link'
import { cn } from '@/lib/utils'

const SECCIONES = [
  { clave: 'resumen', titulo: 'Resumen' },
  { clave: 'ficha', titulo: 'Ficha de taller' },
  { clave: 'etapas', titulo: 'Etapas' },
  { clave: 'planos', titulo: 'Planos' },
  { clave: 'materiales', titulo: 'Materiales' },
  { clave: 'actividades', titulo: 'Avance de Taller' },
  { clave: 'avance', titulo: 'Fotos del taller' },
  { clave: 'bitacora', titulo: 'Trazabilidad' },
] as const

export function Pestanas({ ordenId, activa, contadores = {}, visibles }: {
  ordenId: string
  activa: string
  contadores?: Record<string, number>
  visibles: string[]
}) {
  const secciones = SECCIONES.filter((s) => visibles.includes(s.clave))
  const actual = secciones.find((s) => s.clave === activa)?.titulo ?? 'Secciones'
  function enlaces() {
    return secciones.map((s) => {
      const n = contadores[s.clave] ?? 0
      const esActiva = s.clave === activa
      return <Link
        key={s.clave}
        href={s.clave === 'planos' ? `/ordenes/${ordenId}/planos` : `/ordenes/${ordenId}?vista=${s.clave}`}
        aria-current={esActiva ? 'page' : undefined}
        className={cn('flex min-h-11 items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          esActiva ? 'bg-acento-suave font-semibold text-acento' : 'text-texto-suave hover:bg-superficie-2 hover:text-texto')}
      >
        <span>{s.titulo}</span>
        {n > 0 && <span aria-label={`${n} pendientes`} className="rounded-full bg-aviso-suave px-1.5 text-xs font-medium text-aviso">{n}</span>}
      </Link>
    })
  }
  return <>
    <details className="mb-5 rounded-[var(--radius-base)] border border-borde bg-superficie lg:hidden">
      <summary className="min-h-11 cursor-pointer px-4 py-3 font-medium text-texto">Sección de la OT: {actual}</summary>
      <nav aria-label="Secciones de la orden" className="border-t border-borde p-2">{enlaces()}</nav>
    </details>
    <nav aria-label="Secciones de la orden" className="sticky top-20 hidden h-fit rounded-[var(--radius-base)] border border-borde bg-superficie p-2 lg:block">
      <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase text-texto-suave">Orden de trabajo</p>
      {enlaces()}
    </nav>
  </>
}

import Link from 'next/link'
import { cn } from '@/lib/utils'

const SECCIONES = [
  { clave: 'resumen', titulo: 'Resumen', grupo: 'Orden' },
  { clave: 'etapas', titulo: 'Etapas', grupo: 'Preparación' },
  { clave: 'planos', titulo: 'Planos', grupo: 'Preparación' },
  { clave: 'materiales', titulo: 'Materiales', grupo: 'Preparación' },
  { clave: 'actividades', titulo: 'Taller y fotos', grupo: 'Ejecución' },
  { clave: 'costos', titulo: 'Costos', grupo: 'Cierre' },
  { clave: 'entrega', titulo: 'Entrega', grupo: 'Cierre' },
  { clave: 'bitacora', titulo: 'Historial', grupo: 'Consulta' },
] as const

type Seccion = (typeof SECCIONES)[number]

function ruta(ordenId: string, clave: Seccion['clave']) {
  return clave === 'planos' ? `/ordenes/${ordenId}/planos` : `/ordenes/${ordenId}?vista=${clave}`
}

export function Pestanas({ ordenId, activa, contadores = {}, visibles }: {
  ordenId: string
  activa: string
  contadores?: Record<string, number>
  visibles: string[]
}) {
  const secciones = SECCIONES.filter((s) => visibles.includes(s.clave))
  const actual = secciones.find((s) => s.clave === activa)?.titulo ?? 'Secciones'
  const grupos = [...new Set(secciones.map((s) => s.grupo))]

  const enlaces = grupos.map((grupo) => (
    <div key={grupo} className="space-y-1">
      <p className="px-3 pt-3 text-[11px] font-semibold tracking-wide text-texto-suave uppercase first:pt-0">{grupo}</p>
      {secciones.filter((s) => s.grupo === grupo).map((s) => {
        const activaAhora = s.clave === activa
        const pendientes = contadores[s.clave] ?? 0
        return <Link key={s.clave} href={ruta(ordenId, s.clave)} aria-current={activaAhora ? 'page' : undefined}
          className={cn('flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-base)] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-acento',
            activaAhora ? 'bg-acento-suave font-semibold text-acento' : 'text-texto hover:bg-superficie-2')}
        >
          <span>{s.titulo}</span>
          {pendientes > 0 && <span aria-label={`${pendientes} pendientes`} className="rounded-full bg-aviso-suave px-2 py-0.5 text-xs font-medium text-aviso">{pendientes}</span>}
        </Link>
      })}
    </div>
  ))

  return <>
    <details key={activa} className="mb-4 rounded-[var(--radius-base)] border border-borde bg-superficie p-2 lg:hidden">
      <summary className="cursor-pointer px-2 py-2 text-sm font-semibold text-texto">Sección: {actual}</summary>
      <nav aria-label="Secciones de la orden" className="mt-2 max-h-[65vh] space-y-2 overflow-y-auto border-t border-borde pt-2">
        {enlaces}
      </nav>
    </details>
    <nav aria-label="Secciones de la orden" className="sticky top-4 hidden h-fit space-y-3 rounded-[var(--radius-base)] border border-borde bg-superficie p-3 lg:block">
      {enlaces}
    </nav>
  </>
}

'use client'

import { Menu } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useContextoOrden } from '@/components/estructura/contexto-orden'

const SECCIONES = [
  { clave: 'resumen', titulo: 'Resumen' },
  { clave: 'etapas', titulo: 'Etapas' },
  { clave: 'planos', titulo: 'Planos y revisiones' },
  { clave: 'materiales', titulo: 'Materiales' },
  { clave: 'actividades', titulo: 'Taller y fotos' },
  { clave: 'costos', titulo: 'Costos' },
  { clave: 'entrega', titulo: 'Entrega' },
  { clave: 'bitacora', titulo: 'Historial' },
] as const

export function Pestanas({ ordenId, numero, activa, contadores, visibles }: {
  ordenId: string
  numero: string
  activa: string
  contadores?: Record<string, number>
  visibles: string[]
}) {
  const { publicar, abrir } = useContextoOrden()
  const orden = useMemo(() => ({
    id: ordenId, numero, activa,
    secciones: SECCIONES.filter(s => visibles.includes(s.clave)).map(s => ({
      ...s,
      href: s.clave === 'planos' ? `/ordenes/${ordenId}/planos` : `/ordenes/${ordenId}?vista=${s.clave}`,
      pendientes: contadores?.[s.clave] ?? 0,
    })),
  }), [ordenId, numero, activa, contadores, visibles])
  useEffect(() => {
    publicar(orden)
    return () => publicar(null)
  }, [orden, publicar])

  return <button type="button" onClick={() => abrir(true)}
    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-borde bg-superficie px-4 py-3 text-sm lg:hidden"
    aria-label={`Abrir secciones de la OT ${numero}`}>
    <span>OT {numero} <span className="text-texto-tenue">/</span> <strong className="text-acento">{orden.secciones.find(s => s.clave === activa)?.titulo ?? 'Secciones'}</strong></span>
    <Menu aria-hidden className="size-5 shrink-0 text-acento" />
  </button>
}

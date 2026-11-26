import { SeccionesDelDocumento } from '@/components/estructura/secciones-del-documento'

const SECCIONES = [
  { clave: 'resumen', titulo: 'Resumen' },
  { clave: 'expediente', titulo: 'Expediente' },
  { clave: 'ficha', titulo: 'Ficha de taller' },
  { clave: 'etapas', titulo: 'Etapas' },
  { clave: 'planos', titulo: 'Planos y revisiones' },
  { clave: 'materiales', titulo: 'Materiales' },
  { clave: 'actividades', titulo: 'Taller y fotos' },
  { clave: 'costos', titulo: 'Costos' },
  { clave: 'entrega', titulo: 'Entrega' },
  { clave: 'bitacora', titulo: 'Historial' },
] as const

function rutaDe(ordenId: string, clave: string) {
  if (clave === 'planos') return `/ordenes/${ordenId}/planos`
  if (clave === 'expediente') return `/ordenes/${ordenId}/expediente`
  return `/ordenes/${ordenId}?vista=${clave}`
}

/**
 * Las secciones de una OT, en la fila común de los documentos
 * (`SeccionesDelDocumento`), en el monitor y en el teléfono. Hasta el
 * 2026-11-25 en el monitor colgaban de la barra lateral, bajo «Órdenes de
 * trabajo», y alargaban el menú seis entradas.
 */
export function Pestanas({ ordenId, numero, activa, contadores, visibles, className }: {
  ordenId: string
  numero: string
  activa: string
  contadores?: Record<string, number>
  visibles: string[]
  className?: string
}) {
  const secciones = SECCIONES.filter((s) => visibles.includes(s.clave)).map((s) => ({
    ...s,
    href: rutaDe(ordenId, s.clave),
    pendientes: contadores?.[s.clave] ?? 0,
  }))
  return <SeccionesDelDocumento pegada etiqueta={`Secciones de la OT ${numero}`} secciones={secciones} activa={activa} className={className} />
}

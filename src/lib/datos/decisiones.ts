import 'server-only'

import { enlaceCodigo } from '@/lib/dominio/codigos-internos'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que Gerencia ya decidió (plan 12, entrega 12.2), en lectura. Sale de
 * `decisiones_tomadas`, que reúne las columnas que ya guardan quién y cuándo
 * —y la bitácora solo donde no hay columna— y devuelve lo que decidió el
 * puesto de quien mira. Sin montos: el monto lo dice la pantalla de cada
 * documento, con su permiso.
 */
export const TIPOS_DE_DECISION = [
  'COTIZACION',
  'COMPRA',
  'SERVICIO',
  'REPORTE_DIARIO',
  'TRABAJO_SIN_ORDEN',
  'CIERRE_CODIGO',
  'ORDEN_TRABAJO',
] as const
export type TipoDecision = (typeof TIPOS_DE_DECISION)[number]

export const NOMBRE_DEL_TIPO: Record<TipoDecision, { uno: string; varios: string }> = {
  COTIZACION: { uno: 'Cotización', varios: 'Cotizaciones' },
  COMPRA: { uno: 'Orden de compra', varios: 'Compras' },
  SERVICIO: { uno: 'Orden de servicio', varios: 'Servicios' },
  REPORTE_DIARIO: { uno: 'Reporte diario', varios: 'Reportes diarios' },
  TRABAJO_SIN_ORDEN: { uno: 'Trabajo sin orden', varios: 'Trabajos sin orden' },
  CIERRE_CODIGO: { uno: 'Costeo del código', varios: 'Cierre de códigos' },
  ORDEN_TRABAJO: { uno: 'Orden de trabajo', varios: 'Órdenes de trabajo' },
}

export type Decision = 'APROBADO' | 'DEVUELTO' | 'ANULADO' | 'VISTO' | 'CERRADO' | 'REABIERTO'

/** En sustantivo, para que valga igual para la OT, la cotización y el reporte («Anulación», no «Anulado»). */
export const DECISION: Record<Decision, { etiqueta: string; varias: string; tono: 'exito' | 'aviso' | 'peligro' | 'neutro' }> = {
  APROBADO: { etiqueta: 'Aprobación', varias: 'Aprobaciones', tono: 'exito' },
  VISTO: { etiqueta: 'Visto bueno', varias: 'Vistos buenos', tono: 'exito' },
  CERRADO: { etiqueta: 'Cierre del costeo', varias: 'Cierres del costeo', tono: 'exito' },
  DEVUELTO: { etiqueta: 'Devolución', varias: 'Devoluciones', tono: 'aviso' },
  REABIERTO: { etiqueta: 'Reapertura', varias: 'Reaperturas', tono: 'aviso' },
  ANULADO: { etiqueta: 'Anulación', varias: 'Anulaciones', tono: 'peligro' },
}
export const DECISIONES = Object.keys(DECISION) as Decision[]

export type FilaDecision = {
  /** Única por fila: un documento puede tener varias decisiones en el mes. */
  clave: string
  tipo: TipoDecision
  nombre: string
  detalle: string | null
  /** El código interno del documento, si lleva uno. */
  codigo: string | null
  decision: Decision
  en: string
  puesto: string | null
  motivo: string | null
  /** A la pantalla donde vive el documento. */
  ruta: string
}

function rutaDe(tipo: TipoDecision, documento: string, nombre: string, codigo: string | null, enlace: string | null): string {
  switch (tipo) {
    case 'COTIZACION':
      // La lista de cotizaciones esconde las anuladas si no se las pide: el salto lleva su filtro.
      return `/cotizaciones/pdf?${new URLSearchParams({ q: nombre, ...(enlace === 'ANULADA' ? { estado: 'ANULADA' } : {}) })}#${documento}`
    case 'COMPRA':
      return `/compras/ordenes#oc-${documento}`
    case 'SERVICIO':
      return `/compras/servicios#os-${documento}`
    case 'REPORTE_DIARIO':
      return `/reportes-diarios/${documento}`
    case 'TRABAJO_SIN_ORDEN':
      return enlace ? `/avance/trabajos/${enlace}` : '/avance/trabajos'
    case 'CIERRE_CODIGO':
      return enlaceCodigo(codigo ?? nombre, 'costeo')
    case 'ORDEN_TRABAJO':
      return `/ordenes/${documento}`
  }
}

/** El primer y el último día de un mes `YYYY-MM`. */
export function diasDelMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

/**
 * Las decisiones del puesto de quien mira en un mes, lo más reciente primero. Lanza si la base no
 * responde, o si devuelve un tipo o una decisión que la pantalla no sabe mostrar: nunca sale con
 * filas de menos sin decirlo.
 */
export async function decisionesDelMes(mes: string): Promise<FilaDecision[]> {
  const { desde, hasta } = diasDelMes(mes)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('decisiones_tomadas', { p_desde: desde, p_hasta: hasta })
  if (error) throw new Error(`No se pudieron leer las decisiones: ${error.message}`)
  return (data ?? []).map((f, i) => {
    const tipo = f.tipo as TipoDecision
    const decision = f.decision as Decision
    if (!f.documento || !f.decidido_en || !(tipo in NOMBRE_DEL_TIPO) || !(decision in DECISION)) {
      throw new Error(`La base devolvió una decisión que esta pantalla no sabe mostrar (${f.tipo ?? 'sin tipo'}, ${f.decision ?? 'sin decisión'}).`)
    }
    const nombre = f.nombre ?? '—'
    return {
      clave: `${f.documento}-${decision}-${f.decidido_en}-${i}`,
      tipo,
      nombre,
      detalle: f.detalle,
      codigo: f.codigo,
      decision,
      en: f.decidido_en,
      puesto: f.puesto,
      motivo: f.motivo,
      ruta: rutaDe(tipo, f.documento, nombre, f.codigo, f.enlace),
    }
  })
}

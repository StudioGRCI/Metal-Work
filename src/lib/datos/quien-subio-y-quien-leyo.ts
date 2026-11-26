import 'server-only'

import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { createClient } from '@/lib/supabase/server'

/** Lo que pasó con el aviso de una versión en un área: a cuántas cuentas les llegó y cuántas lo leyeron. */
export type LecturaDelArea = {
  area: string
  areaNombre: string
  destinatarios: number
  leidos: number
  primeraLectura: string | null
  ultimaLectura: string | null
}

/** Una versión (la revisión de un plano o un envío de DXF): quién la subió, cuándo, y su aviso por área. */
export type QuienSubioYQuienLeyo = {
  /** El puesto de quien la subió, nunca su nombre. */
  subidoPor: string | null
  subidoEn: string
  areas: LecturaDelArea[]
}

export type LecturasDelCodigo = {
  /** Por id de la revisión del plano. */
  planos: Map<string, QuienSubioYQuienLeyo>
  /** Por envío de DXF. */
  dxf: Map<string, QuienSubioYQuienLeyo>
}

/**
 * Quién subió cada revisión de plano y cada envío de DXF de un código, y si
 * Maestranza y Producción ya leyeron su aviso (migración 20261126930000). El
 * visto sale del aviso leído: no se guarda ninguna descarga. Solo Diseño.
 */
export async function quienSubioYQuienLeyo(codigo: string): Promise<LecturasDelCodigo> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('quien_subio_y_quien_leyo', { p_codigo: normalizarCodigo(codigo) })
  if (error) throw new Error(`No se pudo leer quién subió cada versión ni quién leyó su aviso: ${error.message}`)
  const lecturas: LecturasDelCodigo = { planos: new Map(), dxf: new Map() }
  for (const f of data ?? []) {
    if (!f.clave || !f.subido_en || !f.area) continue
    const destino = f.tipo === 'DXF' ? lecturas.dxf : lecturas.planos
    const version = destino.get(f.clave) ?? { subidoPor: f.subido_por, subidoEn: f.subido_en, areas: [] }
    version.areas.push({
      area: f.area,
      areaNombre: f.area_nombre ?? f.area,
      destinatarios: Number(f.destinatarios ?? 0),
      leidos: Number(f.leidos ?? 0),
      primeraLectura: f.primera_lectura,
      ultimaLectura: f.ultima_lectura,
    })
    destino.set(f.clave, version)
  }
  // Maestranza antes que Producción, siempre en el mismo orden.
  for (const v of [...lecturas.planos.values(), ...lecturas.dxf.values()]) v.areas.sort((a, b) => a.areaNombre.localeCompare(b.areaNombre, 'es'))
  return lecturas
}

import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type Observacion = {
  id: string
  area_id: string
  area: string
  descripcion: string
  registrado_por: string
  registrado_por_nombre: string | null
  creado_en: string
  resolucion: string | null
  resuelta_por_nombre: string | null
  resuelta_en: string | null
  abierta: boolean
}

/**
 * Las observaciones de una orden (migración 106): las abiertas primero, y dentro
 * de cada grupo la más reciente arriba. Se leen de la vista, que ya trae los
 * nombres: la tabla tiene dos llaves hacia `usuarios`.
 */
export async function observacionesDeOrden(ordenId: string): Promise<Observacion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_ot_observaciones')
    .select(
      'id, area_id, area, descripcion, registrado_por, registrado_por_nombre, creado_en, resolucion, resuelta_por_nombre, resuelta_en, abierta',
    )
    .eq('orden_id', ordenId)
    .order('creado_en', { ascending: false })
    .limit(100)

  if (error) throw new Error(`No se pudieron leer las observaciones de la orden: ${error.message}`)

  return ((data ?? []) as Observacion[]).sort((a, b) => Number(b.abierta) - Number(a.abierta))
}

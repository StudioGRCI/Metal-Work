import 'server-only'

import { createClient } from '@/lib/supabase/server'

export async function versionesDePlanos(ordenId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_plano_versiones')
    .select('id, plano_id, area_id, revision, nombre_archivo, estado, vigente, observacion, creado_por, revisado_por, revisado_en, recibido_por, recibido_en, creado_en, plano:ot_planos!inner(id, orden_id, numero_plano, nombre), area:areas!inner(nombre)')
    .eq('plano.orden_id', ordenId)
    .order('creado_en', { ascending: false }).limit(200)
  if (error) throw new Error('No se pudieron cargar las versiones de planos. Vuelve a intentar.')
  return data ?? []
}

export type VersionPlano = Awaited<ReturnType<typeof versionesDePlanos>>[number]

export async function catalogosDePlanos(ordenId: string) {
  const supabase = await createClient()
  const [planos, areas] = await Promise.all([
    supabase.from('ot_planos').select('id, numero_plano, nombre').eq('orden_id', ordenId).order('orden_secuencia'),
    supabase.from('areas').select('id, nombre').in('codigo', ['MTZ', 'PRD', 'ACB', 'CAL', 'ALM', 'REQ']).order('nombre'),
  ])
  if (planos.error || areas.error) throw new Error('No se pudieron cargar los planos o las áreas. Vuelve a intentar.')
  return { planos: planos.data ?? [], areas: areas.data ?? [] }
}

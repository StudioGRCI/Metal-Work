import 'server-only'

import { createClient } from '@/lib/supabase/server'

export async function versionesDePlanos(ordenId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_plano_versiones')
    .select('id, plano_id, area_id, revision, nombre_archivo, estado, vigente, observacion, nota_envio, revision_diseno, revision_diseno_por, revision_diseno_en, observacion_diseno, creado_por, revisado_por, revisado_en, recibido_por, recibido_en, creado_en, plano:ot_planos!inner(id, orden_id, numero_plano, nombre), area:areas!inner(nombre)')
    .eq('plano.orden_id', ordenId)
    .order('creado_en', { ascending: false }).limit(200)
  if (error) throw new Error('No se pudieron cargar las versiones de planos. Vuelve a intentar.')
  return data ?? []
}

export type VersionPlano = Awaited<ReturnType<typeof versionesDePlanos>>[number]

export async function equipoDisenoNominal(ordenId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_equipo_diseno')
    .select('id, nombre, funcion')
    .eq('orden_id', ordenId)
    .order('creado_en')
  if (error) throw new Error('No se pudo cargar el equipo de Diseño.')
  return data ?? []
}

export async function planosConAutor(ordenId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_planos')
    .select('id, numero_plano, nombre, responsable_diseno_id, integrante_diseno_id')
    .eq('orden_id', ordenId)
    .order('orden_secuencia')
  if (error) throw new Error('No se pudieron cargar los autores de los planos.')
  return data ?? []
}

export async function catalogosDePlanos(ordenId: string) {
  const supabase = await createClient()
  const [planos, areas, orden, equipo, asignables, equipoNominal] = await Promise.all([
    planosConAutor(ordenId),
    supabase.from('areas').select('id, nombre').in('codigo', ['MTZ', 'PRD', 'ACB']).eq('activo', true).order('nombre'),
    supabase.from('ordenes_trabajo').select('diseno_lider_id, diseno_lider_entrega_nombre').eq('id', ordenId).maybeSingle(),
    supabase.from('v_equipo_diseno_ot').select('plano_id, lider_nombre, responsable_nombre').eq('orden_id', ordenId),
    supabase.rpc('usuarios_diseno_asignables'),
    equipoDisenoNominal(ordenId),
  ])
  const error = areas.error ?? orden.error ?? equipo.error ?? asignables.error
  if (error) throw new Error('No se pudieron cargar los planos, las áreas o el equipo de Diseño. Vuelve a intentar.')
  return {
    planos,
    areas: areas.data ?? [],
    liderId: orden.data?.diseno_lider_id ?? null,
    liderEntregaNombre: orden.data?.diseno_lider_entrega_nombre ?? null,
    equipo: equipo.data ?? [],
    usuarios: asignables.data ?? [],
    equipoNominal,
  }
}

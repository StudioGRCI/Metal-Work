import 'server-only'

import { createClient } from '@/lib/supabase/server'

export async function controlesYSolicitudesDeOrden(ordenId: string) {
  const supabase = await createClient()
  const [controles, solicitudes, materiales] = await Promise.all([
    supabase.from('ot_checklists')
      .select('id, tipo, identidad_verificada, documentos_verificados, materiales_verificados, condicion_verificada, observacion, completado_en, creado_en, responsable:usuarios!ot_checklists_registrado_por_fkey(nombres, apellidos)')
      .eq('orden_id', ordenId).order('tipo'),
    supabase.from('ot_solicitudes_tesoreria')
      .select('id, tipo, concepto, monto, moneda, estado, respuesta, creado_en, atendido_en, solicitante:usuarios!ot_solicitudes_tesoreria_solicitado_por_fkey(nombres, apellidos), atendedor:usuarios!ot_solicitudes_tesoreria_atendido_por_fkey(nombres, apellidos)')
      .eq('orden_id', ordenId).order('creado_en', { ascending: false }),
    supabase.from('v_ot_materiales')
      .select('id, numero_plano, material, material_codigo, unidad, cantidad, area_destino')
      .eq('orden_id', ordenId).order('numero_plano', { nullsFirst: false }).limit(500),
  ])
  if (controles.error) throw new Error(`No se pudieron leer las listas de control: ${controles.error.message}`)
  if (solicitudes.error) throw new Error(`No se pudieron leer las solicitudes: ${solicitudes.error.message}`)
  if (materiales.error) throw new Error(`No se pudo leer el reporte de materiales: ${materiales.error.message}`)
  return { controles: controles.data ?? [], solicitudes: solicitudes.data ?? [], materiales: materiales.data ?? [] }
}

export async function solicitudesPendientesTesoreria() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_solicitudes_tesoreria')
    .select('id, orden_id, tipo, concepto, monto, moneda, creado_en, orden:ordenes_trabajo!ot_solicitudes_tesoreria_orden_id_fkey(numero), solicitante:usuarios!ot_solicitudes_tesoreria_solicitado_por_fkey(nombres, apellidos)')
    .eq('estado', 'PENDIENTE').order('creado_en').limit(100)
  if (error) throw new Error(`No se pudieron leer las solicitudes pendientes: ${error.message}`)
  return data ?? []
}

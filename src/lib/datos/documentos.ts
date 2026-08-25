import 'server-only'

import { createClient } from '@/lib/supabase/server'

export async function listarDocumentos(filtros: { ordenId?: string; tipo?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('documentos')
    .select('id, titulo, descripcion, numero_externo, fecha_documento, estado, estado_aprobacion, version_actual, etiquetas, entidad_tabla, entidad_id, creado_en, tipo:tipos_documento!inner(codigo, nombre, categoria, bucket), orden:ordenes_trabajo(id, numero), creador:usuarios(nombres, apellidos)')
    .eq('estado', 'VIGENTE')

  if (filtros.ordenId) consulta = consulta.eq('orden_id', filtros.ordenId)
  if (filtros.tipo) consulta = consulta.eq('tipo_documento_id', filtros.tipo)

  const { data, error } = await consulta.order('creado_en', { ascending: false }).limit(200)
  if (error) throw new Error(`No se pudieron listar los documentos: ${error.message}`)

  return data ?? []
}

export async function versionesDeDocumento(documentoId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('documento_versiones')
    .select('id, version, bucket, ruta_storage, nombre_archivo, extension, tamano_bytes, mime_type, comentario, subido_en, autor:usuarios(nombres, apellidos)')
    .eq('documento_id', documentoId)
    .order('version', { ascending: false })

  if (error) throw new Error(`No se pudieron cargar las versiones: ${error.message}`)
  return data ?? []
}

export async function tiposDocumento() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('tipos_documento')
    .select('id, codigo, nombre, categoria, bucket, extensiones_permitidas, tamano_maximo_mb, requiere_aprobacion, obligatorio_para_cierre')
    .eq('activo', true)
    .order('orden_visualizacion')

  return data ?? []
}

export async function documentosFaltantes(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('documentos_obligatorios_faltantes', {
    p_orden_id: ordenId,
  })

  if (error) return []
  return data ?? []
}

export type EventoTimeline = {
  clave: string
  ocurrido_en: string
  categoria: string
  titulo: string
  detalle: string | null
  usuario: string | null
}

/**
 * Línea de tiempo unificada de una orden: eventos de bitácora, documentos,
 * movimientos de almacén, inspecciones y cambios auditados en una sola lista.
 */
export async function timelineDeOrden(
  ordenId: string,
  limite = 200,
): Promise<EventoTimeline[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_ot_timeline')
    .select('*')
    .eq('orden_id', ordenId)
    .order('ocurrido_en', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudo cargar la trazabilidad: ${error.message}`)

  const filas = data ?? []

  // La vista solo trae usuario_id; los nombres se resuelven en una sola consulta.
  const ids = [...new Set(filas.map((f) => f.usuario_id).filter(Boolean))] as string[]
  const nombres = new Map<string, string>()

  if (ids.length > 0) {
    const { data: usuarios } = await supabase
      .from('usuarios')
      .select('id, nombres, apellidos')
      .in('id', ids)

    for (const u of usuarios ?? []) nombres.set(u.id, `${u.nombres} ${u.apellidos}`)
  }

  return filas
    .filter((f) => f.ocurrido_en)
    .map((f, i) => ({
      // La vista es una unión sin clave propia; el índice basta para React.
      clave: `${f.referencia_tabla ?? 'evento'}-${f.referencia_id ?? i}-${i}`,
      ocurrido_en: f.ocurrido_en as string,
      categoria: f.categoria ?? 'EVENTO',
      titulo: f.titulo ?? '',
      detalle: f.detalle,
      usuario: f.usuario_id ? (nombres.get(f.usuario_id) ?? null) : null,
    }))
}

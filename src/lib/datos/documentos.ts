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

/**
 * Cuántos documentos vigentes hay de cada tipo.
 *
 * El repositorio ofrecía una pastilla de filtro por cada tipo del catálogo:
 * dieciocho pastillas en cuatro líneas, para tres documentos guardados. Quince
 * de esas pastillas llevaban a una pantalla vacía, y las cuatro líneas empujaban
 * la lista fuera de la vista en el teléfono. Un filtro que no filtra nada no es
 * una opción, es un estorbo.
 */
export async function documentosPorTipo(): Promise<Record<string, number>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('documentos')
    .select('tipo_documento_id')
    .eq('estado', 'VIGENTE')

  if (error) throw new Error(`No se pudieron contar los documentos: ${error.message}`)

  const cuenta: Record<string, number> = {}
  for (const d of data ?? []) cuenta[d.tipo_documento_id] = (cuenta[d.tipo_documento_id] ?? 0) + 1
  return cuenta
}

/** El archivo que se descarga de un documento: siempre el de la versión más alta. */
export type UltimaVersion = {
  bucket: string
  ruta_storage: string
  nombre_archivo: string
}

/**
 * La última versión de varios documentos, en una sola consulta.
 *
 * Las dos pantallas que listan documentos necesitan, de cada uno, con qué
 * archivo armar el botón de descargar. Lo pedían documento por documento dentro
 * de un `Promise.all`, y como la lista trae hasta doscientos, eso eran
 * doscientas idas y vueltas a la base para pintar una pantalla. No se rompía
 * nada: solo tardaba, y cuanto más papel guardara la empresa, más.
 *
 * Se trae todo junto y se elige el máximo acá. `documento_id` viene ordenado
 * por versión descendente, así que la primera de cada documento es la suya.
 */
export async function ultimasVersiones(
  documentoIds: string[],
): Promise<Record<string, UltimaVersion>> {
  if (documentoIds.length === 0) return {}

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('documento_versiones')
    .select('documento_id, version, bucket, ruta_storage, nombre_archivo')
    .in('documento_id', documentoIds)
    .order('version', { ascending: false })

  if (error) throw new Error(`No se pudieron cargar los archivos: ${error.message}`)

  const porDocumento: Record<string, UltimaVersion> = {}
  for (const v of data ?? []) {
    // La primera que aparece de cada documento es la más alta: no se pisa.
    porDocumento[v.documento_id] ??= {
      bucket: v.bucket,
      ruta_storage: v.ruta_storage,
      nombre_archivo: v.nombre_archivo,
    }
  }

  return porDocumento
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

export type DocumentoFaltante = {
  tipo_documento_id: string
  codigo: string
  nombre: string
}

/**
 * Documentación obligatoria que le falta a una orden para poder entregarse.
 * Un tipo que exige firmas solo deja de figurar cuando las tiene todas.
 *
 * El tipo se declara a mano porque el generador aún no sabe leer funciones que
 * devuelven tabla: las tipa como `string[]`. Hasta que sepa, esta anotación es
 * la que vale.
 */
export async function documentosFaltantes(ordenId: string): Promise<DocumentoFaltante[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('documentos_obligatorios_faltantes', {
    p_orden_id: ordenId,
  })

  if (error) return []
  return (data ?? []) as unknown as DocumentoFaltante[]
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

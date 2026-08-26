import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type FirmaPendiente = {
  aprobacion_id: string
  documento_id: string
  orden_firma: number
  solicitado_en: string
  titulo: string
  descripcion: string | null
  numero_externo: string | null
  fecha_documento: string | null
  version_actual: number
  orden_id: string | null
  orden_numero: string | null
  cliente: string | null
  placa: string | null
  tipo_codigo: string
  tipo_nombre: string
  tipo_categoria: string
  solicitado_por_nombre: string | null
  le_toca: boolean
  firmas_total: number
}

export type Firma = {
  aprobacion_id: string
  documento_id: string
  orden_firma: number
  estado: string
  comentario: string | null
  fecha: string | null
  version_aprobada: number | null
  aprobador_id: string
  aprobador: string
  aprobador_cargo: string | null
  le_toca: boolean
}

/** Lo que espera mi firma. La vista ya filtra por el usuario de la sesión. */
export async function misFirmasPendientes() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('mis_firmas_pendientes')
    .select('*')
    .order('le_toca', { ascending: false })
    .order('solicitado_en')
    .limit(200)

  if (error) throw new Error(`No se pudo leer la bandeja de firmas: ${error.message}`)
  return (data ?? []) as unknown as FirmaPendiente[]
}

/** La cadena de firmas de varios documentos, agrupada por documento. */
export async function firmasDeDocumentos(documentoIds: string[]) {
  if (documentoIds.length === 0) return {} as Record<string, Firma[]>

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documento_firmas')
    .select('*')
    .in('documento_id', documentoIds)
    .order('orden_firma')

  if (error) throw new Error(`No se pudieron leer las firmas: ${error.message}`)

  const porDocumento: Record<string, Firma[]> = {}
  for (const firma of (data ?? []) as unknown as Firma[]) {
    ;(porDocumento[firma.documento_id] ??= []).push(firma)
  }
  return porDocumento
}

/**
 * A quién se le puede pedir una firma. No se filtra por permiso: en el taller
 * firma quien tiene la responsabilidad, y esa lista la arma la jefatura.
 */
export async function posiblesFirmantes() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombres, apellidos, cargo')
    .eq('activo', true)
    .order('apellidos')
    .limit(300)

  if (error) throw new Error(`No se pudo leer el personal: ${error.message}`)

  return (data ?? []).map((u) => ({
    id: u.id,
    nombre: `${u.nombres} ${u.apellidos}`,
    cargo: u.cargo,
  }))
}

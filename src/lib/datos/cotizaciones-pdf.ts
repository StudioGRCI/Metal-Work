import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Vistas } from '@/types/database'

/**
 * La cotización que la casa arma en Excel y manda en PDF (migración 101). El
 * sistema guarda lo poco que necesita y la traza: quién la subió, quién la
 * aprobó y qué orden salió de ella.
 */
export type CotizacionPdf = Vistas<'v_cotizaciones_pdf'> & { url: string | null }

export async function listarCotizacionesPdf(limite = 200): Promise<CotizacionPdf[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_cotizaciones_pdf')
    .select(
      'id, numero, estado, observacion, cliente_id, cliente, tipo_carroceria_id, carroceria, nombre_archivo, ruta_storage, tamano_bytes, creado_en, registrado_por, registrado_por_nombre, revisado_en, revisado_por_nombre, orden_id, orden_numero, orden_estado',
    )
    .order('creado_en', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudieron leer las cotizaciones: ${error.message}`)
  const filas = (data ?? []) as CotizacionPdf[]
  if (filas.length === 0) return []

  // Sin enlaces la lista igual sirve: se ve qué hay aunque no se pueda abrir.
  const { data: firmados } = await supabase.storage
    .from('cotizaciones-pdf')
    .createSignedUrls(
      filas.map((f) => f.ruta_storage).filter((r): r is string => Boolean(r)),
      600,
    )
  const enlaces = new Map((firmados ?? []).map((f) => [f.path, f.signedUrl]))

  return filas.map((f) => ({ ...f, url: (f.ruta_storage && enlaces.get(f.ruta_storage)) ?? null }))
}

/** Lo que hay que elegir al subir una: de quién es y qué se fabrica. */
export async function catalogosDeCotizacion() {
  const supabase = await createClient()
  const [clientes, carrocerias] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('activo', true).order('razon_social').limit(500),
    supabase.from('tipos_carroceria').select('id, nombre').eq('activo', true).order('orden_secuencia').limit(200),
  ])
  return { clientes: clientes.data ?? [], carrocerias: carrocerias.data ?? [] }
}

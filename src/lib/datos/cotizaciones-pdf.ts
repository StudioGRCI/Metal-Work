import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Vistas } from '@/types/database'

/**
 * La cotización que la casa arma en Word y manda en PDF (migraciones 101 a
 * 103). El sistema guarda lo poco que necesita y la traza: quién la subió,
 * quién la aprobó, qué orden salió de ella y, si Gerencia la rechazó, cada
 * versión con la observación que le hizo.
 */
export type VersionCotizacion = Vistas<'v_cotizaciones_pdf_versiones'> & { url: string | null }
export type CotizacionPdf = Vistas<'v_cotizaciones_pdf'> & {
  url: string | null
  versiones: VersionCotizacion[]
  /** Semirremolque o carrocería montada, si el catálogo lo sabe: lo propone al emitir la OT (migración 104). */
  tipo_unidad: string | null
}

const PDF = 'application/pdf'

type ConArchivo = { ruta_storage: string | null; mime_type: string | null; nombre_archivo: string | null }

/**
 * Los enlaces firmados de una tanda de archivos. El PDF se abre en el
 * navegador; el Word se descarga con su nombre, porque el navegador no lo
 * muestra y abrirlo en otra pestaña deja una página en blanco.
 */
async function enlacesDe(filas: ConArchivo[]): Promise<Map<string, string>> {
  const supabase = await createClient()
  const enlaces = new Map<string, string>()

  const pdfs = filas.filter((f) => f.ruta_storage && (f.mime_type ?? PDF) === PDF).map((f) => f.ruta_storage as string)
  if (pdfs.length > 0) {
    const { data } = await supabase.storage.from('cotizaciones-pdf').createSignedUrls(pdfs, 600)
    for (const f of data ?? []) if (f.path && f.signedUrl) enlaces.set(f.path, f.signedUrl)
  }

  const words = filas.filter((f) => f.ruta_storage && (f.mime_type ?? PDF) !== PDF)
  await Promise.all(
    words.map(async (f) => {
      const { data } = await supabase.storage
        .from('cotizaciones-pdf')
        .createSignedUrl(f.ruta_storage as string, 600, { download: f.nombre_archivo ?? true })
      if (data?.signedUrl) enlaces.set(f.ruta_storage as string, data.signedUrl)
    }),
  )
  return enlaces
}

export async function listarCotizacionesPdf(limite = 200): Promise<CotizacionPdf[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_cotizaciones_pdf')
    .select(
      'id, numero, estado, observacion, cliente_id, cliente, tipo_carroceria_id, carroceria, nombre_archivo, ruta_storage, tamano_bytes, creado_en, registrado_por, registrado_por_nombre, revisado_en, revisado_por_nombre, orden_id, orden_numero, orden_estado, tuvo_orden, version, mime_type, archivo_subido_en',
    )
    .order('creado_en', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudieron leer las cotizaciones: ${error.message}`)
  const filas = (data ?? []) as Vistas<'v_cotizaciones_pdf'>[]
  if (filas.length === 0) return []

  // Solo las que tuvieron más de una versión tienen historial que leer.
  const conHistorial = filas.filter((f) => (f.version ?? 1) > 1 && f.id).map((f) => f.id as string)
  let versiones: Vistas<'v_cotizaciones_pdf_versiones'>[] = []
  if (conHistorial.length > 0) {
    const r = await supabase
      .from('v_cotizaciones_pdf_versiones')
      .select('id, cotizacion_id, version, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_en, observacion, rechazado_en, rechazado_por_nombre')
      .in('cotizacion_id', conHistorial)
      .order('version', { ascending: false })
    if (r.error) throw new Error(`No se pudo leer el historial de las cotizaciones: ${r.error.message}`)
    versiones = (r.data ?? []) as Vistas<'v_cotizaciones_pdf_versiones'>[]
  }

  // El tipo de cada carrocería, para proponerlo al emitir la orden.
  const carrocerias = [...new Set(filas.map((f) => f.tipo_carroceria_id).filter((id): id is string => Boolean(id)))]
  const { data: tipos } = carrocerias.length
    ? await supabase.from('tipos_carroceria').select('id, tipo_unidad').in('id', carrocerias)
    : { data: [] }
  const tipoDe = new Map((tipos ?? []).map((t) => [t.id, t.tipo_unidad as string | null]))

  // Sin enlaces la lista igual sirve: se ve qué hay aunque no se pueda abrir.
  const enlaces = await enlacesDe([...filas, ...versiones])

  return filas.map((f) => ({
    ...f,
    tipo_unidad: (f.tipo_carroceria_id && tipoDe.get(f.tipo_carroceria_id)) ?? null,
    url: (f.ruta_storage && enlaces.get(f.ruta_storage)) ?? null,
    versiones: versiones
      .filter((v) => v.cotizacion_id === f.id)
      .map((v) => ({ ...v, url: (v.ruta_storage && enlaces.get(v.ruta_storage)) ?? null })),
  }))
}

/**
 * Lo que hay que elegir al subir una: de quién es y qué se fabrica. El
 * documento del cliente va porque es con él que se reconoce al de la
 * cotización (migración 102): el nombre se escribe de mil maneras, el RUC no.
 */
export async function catalogosDeCotizacion() {
  const supabase = await createClient()
  const [clientes, carrocerias] = await Promise.all([
    supabase
      .from('clientes')
      .select('id, razon_social, tipo_documento, numero_documento')
      .eq('activo', true)
      .order('razon_social')
      .limit(2000),
    supabase.from('tipos_carroceria').select('id, nombre').eq('activo', true).order('orden_secuencia').limit(200),
  ])
  return { clientes: clientes.data ?? [], carrocerias: carrocerias.data ?? [] }
}

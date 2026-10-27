import { NextResponse } from 'next/server'
import { z } from 'zod'

import { bajarComo } from '@/lib/descarga'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Descargar la cotización con su nombre. Guardado desde el visor del
 * navegador, el PDF salía con el nombre interno del archivo, una serie de
 * letras y números (observación de Gerencia, 27/10/2026). Aquí se pide el
 * enlace firmado en el momento del toque, con el nombre con que se subió, y el
 * navegador lo guarda así. Con `?version=` baja una versión anterior. Quién la
 * baja lo deciden la política de la cotización y la de su archivo: los mismos
 * que la ven en la lista. Si no se puede, vuelve a la lista con un aviso:
 * responder el error tal cual hacía que el navegador bajara un archivo de error
 * con un nombre de letras y números, y el motivo no se veía.
 */
export async function GET(request: Request, context: RouteContext<'/cotizaciones/pdf/archivo/[id]'>) {
  await exigirPermiso(['cotizaciones.ver_pdf_comercial', 'cotizaciones.ver_aprobadas', 'tesoreria.ver_documentos'])
  const { id } = await context.params
  const version = new URL(request.url).searchParams.get('version')
  const fallo = () => NextResponse.redirect(new URL('/cotizaciones/pdf?descarga=fallo', request.url), 303)
  const valido = z.guid().safeParse(id).success && (version === null || z.guid().safeParse(version).success)
  if (!valido) return fallo()

  const supabase = await createClient()
  const { data: cotizacion, error } = await supabase.from('cotizaciones_pdf').select('numero, ruta_storage, nombre_archivo').eq('id', id).maybeSingle()
  if (error || !cotizacion) return fallo()

  let archivo: { ruta_storage: string; nombre_archivo: string | null } = cotizacion
  if (version) {
    const { data: anterior, error: errorVersion } = await supabase
      .from('cotizaciones_pdf_versiones')
      .select('ruta_storage, nombre_archivo')
      .eq('id', version)
      .eq('cotizacion_id', id)
      .maybeSingle()
    if (errorVersion || !anterior) return fallo()
    archivo = anterior
  }

  // El nombre con que se subió; si no lo tiene, el número de la cotización.
  const extension = archivo.ruta_storage.split('.').pop() ?? 'pdf'
  const nombre = archivo.nombre_archivo?.trim() || `Cotización ${cotizacion.numero}.${extension}`
  const { data: enlace } = await supabase.storage.from('cotizaciones-pdf').createSignedUrl(archivo.ruta_storage, 300)
  if (!enlace?.signedUrl) return fallo()
  return NextResponse.redirect(bajarComo(enlace.signedUrl, nombre), 303)
}

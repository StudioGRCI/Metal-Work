import { NextResponse } from 'next/server'
import { z } from 'zod'

import { BUCKET_DXF } from '@/lib/dominio/diseno-codigos'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Descargar un DXF de un código, con su nombre. El enlace firmado se pide en el
 * momento del toque y no al pintar la lista: Maestranza baja un juego de
 * muchos .dxf uno por uno, o deja la pantalla abierta toda la mañana, y un
 * enlace de hace diez minutos ya no bajaba. Quién lo baja lo deciden la
 * política de `codigo_dxf` y la del archivo (`puede_ver_dxf`): Diseño y los
 * supervisores de Maestranza y de Producción; uno quitado ya no baja.
 */
const texto = (mensaje: string, status: number) =>
  new NextResponse(mensaje, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export async function GET(_request: Request, context: RouteContext<'/planos/dxf/[id]'>) {
  await exigirPermiso(['diseno.codigos', 'codigos_internos.area'])
  const { id } = await context.params
  if (!z.guid().safeParse(id).success) return texto('Este DXF no está disponible.', 404)
  const supabase = await createClient()
  const { data: fila, error } = await supabase
    .from('codigo_dxf')
    .select('ruta, nombre_archivo')
    .eq('id', id)
    .is('quitado_en', null)
    .maybeSingle()
  if (error) return texto('No se pudo leer el DXF. Vuelve a intentar en un momento.', 500)
  // Texto llano y no JSON: es lo que ve quien tocó «Descargar» en una lista vieja.
  if (!fila) return texto('Este DXF ya no está: Diseño lo quitó, o no es de tu área. Vuelve a Planos y etapas y recarga la página.', 404)

  const { data: enlace } = await supabase.storage.from(BUCKET_DXF).createSignedUrl(fila.ruta, 300, { download: fila.nombre_archivo })
  if (!enlace?.signedUrl) return texto(`No se pudo preparar la descarga de ${fila.nombre_archivo}. Vuelve a intentar en un momento.`, 502)
  return NextResponse.redirect(enlace.signedUrl, 303)
}

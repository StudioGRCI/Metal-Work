import { NextResponse } from 'next/server'
import { z } from 'zod'

import { BUCKET_TRAMITES, PERMISOS_TRAMITES } from '@/lib/dominio/tramites'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Abrir un archivo del expediente de un trámite. El enlace firmado se pide en
 * el momento del toque y no al pintar la ficha: quien lleva los trámites deja
 * la pantalla abierta toda la mañana, y un enlace de hace una hora ya no
 * abriría. Quién lo ve lo deciden la política de `tramite_archivos` y la de su
 * archivo en Storage (migración 20261126998800): quien ve el trámite; los
 * retirados, solo quien ve todos. Si no se puede, vuelve a la lista con un
 * aviso: «Ver» abre otra pestaña, y responder el error tal cual dejaba ahí un
 * texto suelto sin decir qué pasó ni cómo seguir (como la cotización).
 */
export async function GET(request: Request, context: RouteContext<'/tramites/archivo/[id]'>) {
  // Los mismos permisos que la lista a la que vuelve si falla.
  await exigirPermiso([...PERMISOS_TRAMITES])
  const { id } = await context.params
  const fallo = () => NextResponse.redirect(new URL('/tramites?archivo=fallo', request.url), 303)
  if (!z.guid().safeParse(id).success) return fallo()
  const supabase = await createClient()
  const { data: archivo, error } = await supabase.from('tramite_archivos').select('archivo_ruta').eq('id', id).maybeSingle()
  if (error || !archivo) return fallo()

  const { data: enlace } = await supabase.storage.from(BUCKET_TRAMITES).createSignedUrl(archivo.archivo_ruta, 300)
  if (!enlace?.signedUrl) return fallo()
  return NextResponse.redirect(enlace.signedUrl, 303)
}

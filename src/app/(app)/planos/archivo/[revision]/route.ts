import { NextResponse } from 'next/server'
import { z } from 'zod'

import { BUCKET_PLANOS_CODIGO } from '@/lib/dominio/diseno-codigos'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Abrir el PDF de una revisión de un plano. El enlace firmado se pide en el
 * momento del toque y no al pintar la lista: el supervisor deja la pantalla
 * abierta toda la mañana, y un enlace de hace una hora ya no abriría. Quién lo
 * ve lo deciden la política de la revisión y la de su PDF: Diseño, Gerencia y
 * el supervisor del área a la que va el plano.
 */
export async function GET(_request: Request, context: RouteContext<'/planos/archivo/[revision]'>) {
  await exigirPermiso(['diseno.codigos', 'codigos_internos.ver', 'codigos_internos.area'])
  const { revision } = await context.params
  if (!z.guid().safeParse(revision).success) return NextResponse.json({ error: 'El plano no está disponible.' }, { status: 404 })
  const supabase = await createClient()
  const { data: fila, error } = await supabase
    .from('codigo_plano_revisiones')
    .select('ruta, revision, nombre_archivo')
    .eq('id', revision)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo leer el plano.' }, { status: 500 })
  if (!fila) return NextResponse.json({ error: 'El plano no está disponible.' }, { status: 404 })

  const { data: enlace } = await supabase.storage.from(BUCKET_PLANOS_CODIGO).createSignedUrl(fila.ruta, 300)
  if (!enlace?.signedUrl) return NextResponse.json({ error: `No se pudo abrir el PDF de la revisión R${fila.revision}.` }, { status: 502 })
  return NextResponse.redirect(enlace.signedUrl, 303)
}

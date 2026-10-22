import { NextResponse } from 'next/server'
import { z } from 'zod'

import { BUCKET_GUIAS_REMISION } from '@/lib/dominio/logistica'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Abrir la guía de remisión. El enlace firmado se pide en el momento del toque
 * y no al pintar la lista: el conductor deja la pantalla abierta toda la
 * mañana, y un enlace de hace una hora ya no abriría. Quién la ve lo deciden la
 * política de la guía y la de su PDF (migración 20261020171000): Logística, el
 * conductor, Contabilidad y quien sigue la compra en Adquisiciones. Vive fuera
 * de la Gestión de compras porque la abren también quienes no entran a ella.
 */
export async function GET(_request: Request, context: RouteContext<'/compras/guia/[id]'>) {
  await exigirPermiso(['compras.programar_recojo', 'compras.recojo', 'compras.guia_remision', 'adquisiciones.ver'])
  const { id } = await context.params
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: 'La guía de remisión no está disponible.' }, { status: 404 })
  const supabase = await createClient()
  const { data: guia, error } = await supabase.from('guias_remision_compra').select('ruta, numero').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo leer la guía de remisión.' }, { status: 500 })
  if (!guia) return NextResponse.json({ error: 'La guía de remisión no está disponible.' }, { status: 404 })

  const { data: enlace } = await supabase.storage.from(BUCKET_GUIAS_REMISION).createSignedUrl(guia.ruta, 300)
  if (!enlace?.signedUrl) return NextResponse.json({ error: `No se pudo abrir el PDF de la guía ${guia.numero}.` }, { status: 502 })
  return NextResponse.redirect(enlace.signedUrl, 303)
}

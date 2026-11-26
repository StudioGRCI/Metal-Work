import { NextResponse } from 'next/server'
import { z } from 'zod'

import { BUCKET_CIERRE_CAJA } from '@/lib/dominio/caja'
import { fecha } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Abrir la captura del estado de cuenta con que se cerró un día (migración
 * 20261126550000). El enlace firmado se pide al tocar y no al pintar la
 * historia. Quién la ve lo deciden la política de `cierres_caja` y la del bucket
 * `cierre-caja`: quien lleva la caja (`tesoreria.caja`) y Gerencia, que la
 * consulta (`tesoreria.ver_caja`). Costos no.
 */
export async function GET(_request: Request, context: RouteContext<'/tesoreria/caja-diaria/cierres/captura/[id]'>) {
  await exigirPermiso(['tesoreria.caja', 'tesoreria.ver_caja'])
  const { id } = await context.params
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: 'El cierre no está disponible.' }, { status: 404 })
  const supabase = await createClient()
  const { data: cierre, error } = await supabase.from('cierres_caja').select('fecha, captura_ruta').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo leer el cierre.' }, { status: 500 })
  if (!cierre) return NextResponse.json({ error: 'El cierre no está disponible.' }, { status: 404 })
  if (!cierre.captura_ruta) {
    return NextResponse.json({ error: `El cierre del ${fecha(cierre.fecha)} no tiene captura.` }, { status: 404 })
  }

  const { data: enlace } = await supabase.storage.from(BUCKET_CIERRE_CAJA).createSignedUrl(cierre.captura_ruta, 300)
  if (!enlace?.signedUrl) return NextResponse.json({ error: `No se pudo abrir la captura del cierre del ${fecha(cierre.fecha)}.` }, { status: 502 })
  return NextResponse.redirect(enlace.signedUrl, 303)
}

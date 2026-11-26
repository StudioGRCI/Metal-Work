import { NextResponse } from 'next/server'
import { z } from 'zod'

import { BUCKET_APERTURA_CAJA } from '@/lib/dominio/caja'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Abrir la captura del saldo con que se abrió una cuenta de la caja (migración
 * 20261020174500). El enlace firmado se pide al tocar y no al pintar la lista:
 * la caja se deja abierta toda la mañana, y uno de hace una hora ya no abriría.
 * Quién la ve lo deciden `captura_de_caja` y la política del bucket: quien lleva
 * la caja (`tesoreria.caja`) y, desde la historia de cierres, quien consulta los
 * documentos de Tesorería (`tesoreria.ver_documentos`, Gerencia; migración
 * 20261126100000).
 */
export async function GET(_request: Request, context: RouteContext<'/tesoreria/caja-diaria/captura/[id]'>) {
  await exigirPermiso(['tesoreria.caja', 'tesoreria.ver_documentos'])
  const { id } = await context.params
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: 'La cuenta no está disponible.' }, { status: 404 })
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('captura_de_caja', { p_caja: id })
  const cuenta = data?.[0]
  if (error) return NextResponse.json({ error: 'No se pudo leer la cuenta.' }, { status: 500 })
  if (!cuenta?.nombre) return NextResponse.json({ error: 'La cuenta no está disponible.' }, { status: 404 })
  if (!cuenta.apertura_ruta) return NextResponse.json({ error: `${cuenta.nombre} todavía no tiene la captura de su saldo inicial.` }, { status: 404 })

  const { data: enlace } = await supabase.storage.from(BUCKET_APERTURA_CAJA).createSignedUrl(cuenta.apertura_ruta, 300)
  if (!enlace?.signedUrl) return NextResponse.json({ error: `No se pudo abrir la captura del saldo de ${cuenta.nombre}.` }, { status: 502 })
  return NextResponse.redirect(enlace.signedUrl, 303)
}

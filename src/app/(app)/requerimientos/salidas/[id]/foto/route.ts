import { NextResponse } from 'next/server'
import { z } from 'zod'

import { exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La foto de una salida del kardex hecha contra un RQ, para quien lo pidió
 * (plan 2, entrega 2.2): quien ve el RQ no ve el kardex, así que la ruta la da
 * `foto_de_salida_de_requerimiento` y Storage la deja leer por la política
 * `leer_foto_de_salida_de_requerimiento`, las dos con la sesión del usuario.
 */
export async function GET(_request: Request, context: RouteContext<'/requerimientos/salidas/[id]/foto'>) {
  await exigirSesion()
  const { id } = await context.params
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: 'La salida no existe.' }, { status: 404 })
  const db = await createClient()
  const { data: ruta, error } = await db.rpc('foto_de_salida_de_requerimiento', { p_movimiento: id })
  if (error) return NextResponse.json({ error: 'No se pudo consultar la salida.' }, { status: 500 })
  if (!ruta) return NextResponse.json({ error: 'La salida no tiene foto disponible para tu usuario.' }, { status: 404 })
  const archivo = await db.storage.from('evidencias-almacen').download(ruta)
  if (archivo.error || !archivo.data) return NextResponse.json({ error: 'No se pudo abrir la foto.' }, { status: 500 })
  return new NextResponse(await archivo.data.arrayBuffer(), {
    headers: {
      // Si Storage no guardó el tipo, se deduce de la extensión: si no, el navegador la descarga en vez de mostrarla.
      'Content-Type': tipoDeLaFoto(archivo.data.type, ruta),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

const POR_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }

function tipoDeLaFoto(tipo: string, ruta: string) {
  if (tipo && tipo !== 'application/octet-stream') return tipo
  return POR_EXTENSION[ruta.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

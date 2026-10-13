import { NextResponse } from 'next/server'
import { exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/** El escaneo del formato firmado con el que se cerró una salida de materia prima o de EPP. */
export async function GET(_request: Request, context: RouteContext<'/almacen/movimientos/[id]/formato-firmado'>) {
  await exigirSesion()
  const { id } = await context.params
  const db = await createClient()
  const { data, error } = await db.from('movimientos_materiales').select('formato_ruta').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo consultar la salida.' }, { status: 500 })
  if (!data?.formato_ruta) return NextResponse.json({ error: 'La salida no tiene formato firmado disponible para tu usuario.' }, { status: 404 })
  const archivo = await db.storage.from('evidencias-almacen').download(data.formato_ruta)
  if (archivo.error || !archivo.data) return NextResponse.json({ error: 'No se pudo abrir el formato.' }, { status: 500 })
  return new NextResponse(await archivo.data.arrayBuffer(), {
    headers: { 'Content-Type': archivo.data.type, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

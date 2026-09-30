import { NextResponse } from 'next/server'
import { exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request:Request,context:RouteContext<'/almacen/movimientos/[id]/evidencia'>) {
  await exigirSesion()
  const {id}=await context.params
  const db=await createClient()
  const {data,error}=await db.from('movimientos_materiales').select('foto_ruta').eq('id',id).maybeSingle()
  if(error) return NextResponse.json({error:'No se pudo consultar la entrega.'},{status:500})
  if(!data?.foto_ruta) return NextResponse.json({error:'La entrega no tiene evidencia disponible para tu usuario.'},{status:404})
  const archivo=await db.storage.from('evidencias-almacen').download(data.foto_ruta)
  if(archivo.error||!archivo.data) return NextResponse.json({error:'No se pudo abrir la foto.'},{status:500})
  return new NextResponse(await archivo.data.arrayBuffer(),{headers:{'Content-Type':archivo.data.type,'Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
}

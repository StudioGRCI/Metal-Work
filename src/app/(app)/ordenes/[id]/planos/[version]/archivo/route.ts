import { z } from 'zod'
import { obtenerSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  const perfil = await obtenerSesion()
  if (!perfil?.activo) return new Response('Inicia sesión para consultar el plano.', { status: 401 })
  const { id, version } = await params
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(version).success) return new Response('Plano no encontrado.', { status: 404 })
  const supabase = await createClient()
  const { data: plano, error } = await supabase.from('ot_plano_versiones')
    .select('ruta_storage, nombre_archivo, plano:ot_planos!inner(orden_id)').eq('id', version).eq('plano.orden_id', id).maybeSingle()
  if (error || !plano) return new Response('Plano no disponible para tu cuenta.', { status: 404 })
  const { data, error: archivoError } = await supabase.storage.from('planos-privados').download(plano.ruta_storage)
  if (archivoError || !data) return new Response('No se pudo abrir el archivo. Vuelve a intentar.', { status: 502 })
  // Verificar permisos en cada petición; no entregar enlaces anónimos duraderos.
  return new Response(data, { headers: {
    'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(plano.nombre_archivo)}`,
  } })
}

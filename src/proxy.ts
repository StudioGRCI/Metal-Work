import type { NextRequest } from 'next/server'

import { actualizarSesion } from '@/lib/supabase/sesion-proxy'

/**
 * Se ejecuta antes de cada navegación: refresca el token de Supabase y bloquea
 * el acceso a las rutas privadas. En Next 16 esta convención se llama "proxy".
 */
export default async function proxy(request: NextRequest) {
  return actualizarSesion(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

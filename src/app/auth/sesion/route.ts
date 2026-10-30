import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

/** Con menos de esto por delante, la sesión se refresca aquí. El proxy lo hace a los 90 s. */
const MARGEN_S = 10 * 60

/**
 * Refresca la sesión en un pedido que no es una acción de servidor. Lo pide la
 * pantalla antes de enviar (`sesionAlDia`, en `src/lib/envio.ts`): si la
 * refrescara el proxy durante la acción, Next contaría las cookies nuevas como
 * cambiadas por ella y la respondería revalidada, y en una pestaña de otro
 * despliegue eso recarga el documento entero aunque la acción no revalide
 * (X8 de la crítica de la trigesimoprimera pasada). Aquí las cookies nuevas no
 * repintan nada.
 *
 * Solo toca la sesión de quien llama, con su propio token de refresco, y no
 * devuelve nada. De `getSession` se mira solo cuándo vence: quién es lo sigue
 * diciendo `getUser` en el proxy y en cada acción.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.expires_at && session.expires_at - Date.now() / 1000 < MARGEN_S) await supabase.auth.refreshSession()
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

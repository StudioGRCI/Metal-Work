import { NextResponse, type NextRequest } from 'next/server'

import { compilacionDelServidor } from '@/lib/compilacion'
import { createClient } from '@/lib/supabase/server'

/** Con menos de esto por delante, la sesión se refresca aquí. El proxy lo hace a los 90 s. */
const MARGEN_S = 10 * 60

const SIN_GUARDAR = { 'Cache-Control': 'no-store' }

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
 *
 * Con `?comprobar`, antes de poner la pantalla al día con una ventana abierta
 * (`sePuedePonerAlDia`), dice además si esa pantalla llegaría: 401 sin sesión
 * —el refresco iría a /ingresar y se llevaba la ventana y lo escrito (F1 de la
 * crítica, quincuagésima cuarta pasada)— y, con sesión, de qué despliegue es el
 * servidor (`x-compilacion`), que en otro el refresco recarga el documento
 * entero (R34 de realización). `/auth` es pública, así que sin esto contestaba
 * 204 igual. Quién es lo dice `getUser`, lo mismo que mira el proxy.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.expires_at && session.expires_at - Date.now() / 1000 < MARGEN_S) await supabase.auth.refreshSession()
  if (!request.nextUrl.searchParams.has('comprobar')) return new NextResponse(null, { status: 204, headers: SIN_GUARDAR })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401, headers: SIN_GUARDAR })
  return new NextResponse(null, { status: 204, headers: { ...SIN_GUARDAR, 'x-compilacion': compilacionDelServidor() ?? '' } })
}

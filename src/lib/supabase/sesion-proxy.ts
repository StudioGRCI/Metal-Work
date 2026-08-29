import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Rutas accesibles sin haber iniciado sesión.
 *
 * `/api/tipo-cambio` la llama el cron de Vercel, que no tiene sesión ni puede
 * tenerla: sin esta línea el proxy la mandaba a /ingresar con un 307 y el cron
 * quedaba «corriendo» todos los días sin hacer nada. No queda abierta: esa ruta
 * exige su propia credencial (CRON_SECRET) y contesta 401 sin ella. Se lista
 * una por una a propósito —no `/api`— para que una ruta futura no herede el
 * permiso de estar sin sesión por descuido.
 */
const RUTAS_PUBLICAS = ['/ingresar', '/auth', '/api/health', '/api/tipo-cambio']

/**
 * Refresca el token de Supabase en cada navegación y redirige a /ingresar
 * cuando no hay sesión. Sin esto el token expira y el usuario ve errores
 * de permisos en lugar de una pantalla de inicio de sesión.
 */
export async function actualizarSesion(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ruta = request.nextUrl.pathname
  const esPublica = RUTAS_PUBLICAS.some((p) => ruta.startsWith(p))

  if (!user && !esPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/ingresar'
    url.searchParams.set('redirigir', ruta)
    return NextResponse.redirect(url)
  }

  // Con sesión iniciada no tiene sentido quedarse en la pantalla de ingreso...
  // salvo que sea la propia aplicación la que mandó a esta persona acá, porque
  // su cuenta de Supabase existe pero no tiene perfil o está dada de baja. Ahí
  // devolverla sería encerrarla en un bucle: solo puede salir cerrando sesión.
  if (user && ruta === '/ingresar' && !request.nextUrl.searchParams.has('motivo')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

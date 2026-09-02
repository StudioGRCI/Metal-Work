'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { createClient } from '@/lib/supabase/client'

/**
 * A dónde mandar al usuario después de entrar.
 *
 * `redirigir` viene de la dirección, así que lo elige quien arma el enlace. Sin
 * mirarlo, un `?redirigir=https://otro-sitio` mandaría a la gente fuera del
 * sistema justo después de escribir su contraseña, con la confianza de venir de
 * la pantalla de la empresa. Solo se aceptan rutas de la casa: empiezan con una
 * barra y no con dos —`//otro-sitio` es una dirección externa disfrazada.
 */
function destinoSeguro(ruta: string): string {
  // Se resuelve contra un origen que no existe y se exige que el resultado siga
  // en él. Mirar solo que empiece por una barra y no por dos no bastaba:
  // `/\otro-sitio` pasaba el filtro y el navegador lo lee como `//otro-sitio`,
  // es decir, sale de la casa.
  try {
    const casa = 'https://metal-work.invalid'
    const destino = new URL(ruta, casa)
    if (destino.origin !== casa) return '/'
    return `${destino.pathname}${destino.search}${destino.hash}`
  } catch {
    return '/'
  }
}

export function FormularioIngreso({ redirigir }: { redirigir: string }) {
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [verClave, setVerClave] = useState(false)

  async function ingresar(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setCargando(true)

    const supabase = createClient()
    const { error: fallo } = await supabase.auth.signInWithPassword({
      email: correo.trim(),
      password: clave,
    })

    if (fallo) {
      // El mensaje de Supabase llega en inglés; se traduce lo que el usuario puede corregir.
      setError(
        fallo.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : fallo.message === 'Email not confirmed'
            ? 'La cuenta aún no ha sido confirmada.'
            : 'No se pudo iniciar sesión. Inténtalo nuevamente.',
      )
      setCargando(false)
      return
    }

    // Navegación completa a propósito, no `router.replace()`.
    //
    // Antes había un `router.replace()` seguido de `router.refresh()`, y el
    // refresh cancelaba la navegación que el replace acababa de empezar: en la
    // red se veían dos peticiones al destino abortadas y el usuario se quedaba
    // en esta pantalla con el botón girando para siempre. No fallaba siempre
    // —depende de cuál de las dos gane la carrera— y por eso se veía como
    // «a veces no entra». La sesión sí quedaba iniciada: reintentar funcionaba,
    // lo que hacía pensar que era la clave mal escrita.
    //
    // Una navegación del navegador entero no compite con nada: descarta la
    // caché de rutas de Next y hace que el proxy vuelva a leer la cookie recién
    // escrita, que es lo que el refresh intentaba conseguir. Cuesta una carga
    // completa, una sola vez al entrar.
    window.location.assign(destinoSeguro(redirigir))
  }

  return (
    <form onSubmit={ingresar} className="space-y-4">
      <Campo etiqueta="Correo electrónico" htmlFor="correo" requerido>
        <Entrada
          id="correo"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          placeholder="usuario@empresa.com.pe"
        />
      </Campo>

      <Campo etiqueta="Contraseña" htmlFor="clave" requerido>
        {/* El ojo evita el ida y vuelta de escribir a ciegas una contraseña larga. */}
        <div className="relative">
          <Entrada
            id="clave"
            type={verClave ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setVerClave((v) => !v)}
            aria-label={verClave ? 'Ocultar la contraseña' : 'Ver la contraseña'}
            aria-pressed={verClave}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-texto-tenue hover:text-texto"
          >
            {verClave ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Campo>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro"
        >
          {error}
        </p>
      )}

      <Boton type="submit" cargando={cargando} className="w-full justify-center">
        Ingresar
      </Boton>
    </form>
  )
}

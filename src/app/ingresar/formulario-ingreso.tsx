'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { createClient } from '@/lib/supabase/client'

export function FormularioIngreso({ redirigir }: { redirigir: string }) {
  const router = useRouter()
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

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

    // refresh() obliga al middleware a releer la cookie recién escrita.
    router.replace(redirigir)
    router.refresh()
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
        <Entrada
          id="clave"
          type="password"
          autoComplete="current-password"
          required
          value={clave}
          onChange={(e) => setClave(e.target.value)}
        />
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

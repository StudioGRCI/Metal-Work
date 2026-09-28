'use client'

import { useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { createClient } from '@/lib/supabase/client'

export function FormularioRestablecer() {
  const [recuperando, setRecuperando] = useState(false)
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [sesion, setSesion] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const tipo = new URLSearchParams(window.location.hash.slice(1)).get('type')
    const desdeEnlace = tipo === 'recovery' || new URLSearchParams(window.location.search).has('code')
    if (desdeEnlace) {
      void supabase.auth.getSession().then(({ data, error: fallo }) => {
        setRecuperando(true)
        if (fallo) setError('El enlace no se pudo abrir. Solicita uno nuevo.')
        else setSesion(Boolean(data.session))
      })
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') setSesion(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function solicitar(evento: React.FormEvent) {
    evento.preventDefault()
    setEnviando(true)
    setError(null)
    const { error: fallo } = await createClient().auth.resetPasswordForEmail(correo.trim(), {
      redirectTo: `${window.location.origin}/restablecer-clave`,
    })
    setEnviando(false)
    if (fallo) setError('No se pudo enviar el enlace. Inténtalo nuevamente o avisa a Administración.')
    else setMensaje('Si la cuenta existe, llegará un enlace para definir tu contraseña.')
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    setEnviando(true)
    setError(null)
    const { error: fallo } = await createClient().auth.updateUser({ password: clave })
    setEnviando(false)
    if (fallo) setError('No se pudo guardar la contraseña. Solicita un enlace nuevo.')
    else {
      setClave('')
      setMensaje('Contraseña guardada. Ya puedes ingresar.')
      setRecuperando(false)
    }
  }

  return <>
    {recuperando && sesion ? <form onSubmit={guardar} className="mt-5 space-y-4">
      <Campo etiqueta="Contraseña nueva" htmlFor="clave-nueva" requerido>
        <Entrada id="clave-nueva" type="password" autoComplete="new-password" minLength={12} maxLength={128}
          required value={clave} onChange={(e) => setClave(e.target.value)} />
      </Campo>
      <Boton type="submit" cargando={enviando} className="w-full justify-center">Guardar contraseña</Boton>
    </form> : <form onSubmit={solicitar} className="mt-5 space-y-4">
      <Campo etiqueta="Correo electrónico" htmlFor="correo-recuperar" requerido>
        <Entrada id="correo-recuperar" type="email" autoComplete="email" required value={correo}
          onChange={(e) => setCorreo(e.target.value)} />
      </Campo>
      <Boton type="submit" cargando={enviando} className="w-full justify-center">Enviar enlace</Boton>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-peligro">{error}</p>}
    {mensaje && <p role="status" className="mt-3 text-sm text-exito">{mensaje}</p>}
  </>
}

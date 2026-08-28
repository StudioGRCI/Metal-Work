'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'

import { anularMovimiento, confirmarMovimiento } from '../../acciones'

export function AccionesMovimiento({
  movimiento,
  permisos,
  esAdmin,
  tieneLineas,
}: {
  movimiento: { id: string; estado: string }
  permisos: string[]
  esAdmin: boolean
  tieneLineas: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [anulando, setAnulando] = useState(false)

  const puede = (permiso: string) => esAdmin || permisos.includes(permiso)
  if (movimiento.estado !== 'BORRADOR') return null

  async function confirmar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await confirmarMovimiento(null, datos)
    setEnviando(false)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setError(resultado.error)
  }

  async function anular(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await anularMovimiento(null, datos)
    setEnviando(false)
    setAnulando(false)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setError(resultado.error)
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {puede('almacen.movimientos') && (
          <Boton variante="peligro" tamano="sm" onClick={() => setAnulando(true)}>
            Anular
          </Boton>
        )}

        {puede('almacen.confirmar') && (
          <form action={confirmar}>
            <input type="hidden" name="movimiento_id" value={movimiento.id} />
            <Boton type="submit" tamano="sm" cargando={enviando} disabled={!tieneLineas}>
              Confirmar movimiento
            </Boton>
          </form>
        )}
      </div>

      {!tieneLineas && puede('almacen.confirmar') && (
        <p className="text-xs text-texto-suave">Agrega al menos un material para confirmar.</p>
      )}

      {error && (
        <p role="alert" className="max-w-md rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error}
        </p>
      )}

      {/* El motivo es obligatorio y se guarda: no es una ventana de la que se
          salga con un roce, así que no cierra al tocar el fondo. */}
      <Ventana
        abierta={anulando}
        alCerrar={() => setAnulando(false)}
        titulo="Anular movimiento"
        descripcion="El documento queda sin efecto y su motivo se conserva en el historial."
        ancho="sm"
      >
        <form action={anular} className="space-y-3">
          <input type="hidden" name="movimiento_id" value={movimiento.id} />

          <Campo etiqueta="Motivo" htmlFor="motivo" requerido>
            {/* Sin autoFocus: el foco al abrir lo lleva la Ventana. */}
            <AreaTexto id="motivo" name="motivo" required />
          </Campo>

          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAnulando(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}

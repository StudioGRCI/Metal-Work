'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'

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

      {anulando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Cancelar"
            onClick={() => setAnulando(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative w-full max-w-md rounded-[var(--radius-base)] border border-borde bg-superficie p-4 text-left shadow-xl">
            <h2 className="text-sm font-semibold text-texto">Anular movimiento</h2>
            <p className="mt-1 text-xs text-texto-suave">
              El documento queda sin efecto y su motivo se conserva en el historial.
            </p>

            <form action={anular} className="mt-4 space-y-3">
              <input type="hidden" name="movimiento_id" value={movimiento.id} />

              <Campo etiqueta="Motivo" htmlFor="motivo" requerido>
                <AreaTexto id="motivo" name="motivo" required autoFocus />
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
          </div>
        </div>
      )}
    </div>
  )
}

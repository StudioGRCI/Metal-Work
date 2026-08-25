'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'

import { aprobarRequerimiento, rechazarRequerimiento } from '../../acciones'

export function AccionesRequerimiento({
  requerimiento,
  permisos,
  esAdmin,
  tieneLineas,
}: {
  requerimiento: { id: string; estado: string }
  permisos: string[]
  esAdmin: boolean
  tieneLineas: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [rechazando, setRechazando] = useState(false)

  const puede = (permiso: string) => esAdmin || permisos.includes(permiso)

  if (requerimiento.estado !== 'SOLICITADO' || !puede('requerimientos.aprobar')) return null

  async function aprobar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await aprobarRequerimiento(null, datos)
    setEnviando(false)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setError(resultado.error)
  }

  async function rechazar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await rechazarRequerimiento(null, datos)
    setEnviando(false)
    setRechazando(false)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setError(resultado.error)
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Boton variante="peligro" tamano="sm" onClick={() => setRechazando(true)}>
          Rechazar
        </Boton>

        <form action={aprobar}>
          <input type="hidden" name="requerimiento_id" value={requerimiento.id} />
          <Boton type="submit" tamano="sm" cargando={enviando} disabled={!tieneLineas}>
            Aprobar y reservar stock
          </Boton>
        </form>
      </div>

      {!tieneLineas && (
        <p className="text-xs text-texto-suave">Agrega al menos un material para aprobar.</p>
      )}

      {error && (
        <p role="alert" className="max-w-md rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error}
        </p>
      )}

      {rechazando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Cancelar"
            onClick={() => setRechazando(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative w-full max-w-md rounded-[var(--radius-base)] border border-borde bg-superficie p-4 text-left shadow-xl">
            <h2 className="text-sm font-semibold text-texto">Rechazar requerimiento</h2>

            <form action={rechazar} className="mt-4 space-y-3">
              <input type="hidden" name="requerimiento_id" value={requerimiento.id} />

              <Campo etiqueta="Motivo" htmlFor="motivo" requerido>
                <AreaTexto
                  id="motivo"
                  name="motivo"
                  required
                  autoFocus
                  placeholder="Ej.: el material solicitado no corresponde al alcance de la orden"
                />
              </Campo>

              <div className="flex justify-end gap-2">
                <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setRechazando(false)}>
                  Cancelar
                </Boton>
                <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando}>
                  Rechazar
                </Boton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

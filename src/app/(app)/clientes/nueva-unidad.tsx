'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'

import { guardarUnidad } from './acciones'

const TIPOS_VEHICULO = [
  ['VOLQUETE', 'Volquete'],
  ['TRACTO', 'Tracto'],
  ['SEMIRREMOLQUE', 'Semirremolque'],
  ['CAMION', 'Camión'],
  ['REMOLQUE', 'Remolque'],
  ['FURGON', 'Furgón'],
  ['OTRO', 'Otro'],
] as const

export function NuevaUnidad({
  clienteId,
  tiposCarroceria,
  onCreada,
  compacta = false,
}: {
  clienteId: string
  tiposCarroceria: { id: string; nombre: string }[]
  /** Para los formularios que quieren quedarse con la unidad recién creada. */
  onCreada?: (unidad: { id: string; placa: string }) => void
  compacta?: boolean
}) {
  const router = useRouter()
  const [pendiente, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Se envía con un manejador propio en lugar de useActionState para poder
  // cerrar el diálogo solo cuando el guardado sale bien, sin efectos.
  async function enviar(datos: FormData) {
    setError(null)
    const resultado = await guardarUnidad(null, datos)

    if (resultado.ok) {
      setAbierto(false)
      if (resultado.datos) onCreada?.(resultado.datos)
      // Sin quien la escuche, es un alta suelta: se refresca la lista de atrás.
      if (!onCreada) iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  function abrir() {
    setError(null)
    setAbierto(true)
  }

  return (
    <>
      <Boton type="button" variante={compacta ? 'contorno' : 'secundario'} tamano="sm" onClick={abrir}>
        <Plus aria-hidden className="size-3.5" />
        {compacta ? 'Nueva' : 'Agregar unidad'}
      </Boton>

      {abierto &&
        // En un portal a propósito: el diálogo lleva su propio <form> y, si se
        // renderizara dentro del formulario que lo abrió, quedarían anidados
        // —HTML no lo permite y React envía el de afuera—.
        createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nueva unidad"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
        >
          <button
            type="button"
            aria-label="Cancelar"
            onClick={() => setAbierto(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative my-8 w-full max-w-2xl rounded-[var(--radius-base)] border border-borde bg-superficie p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-texto">Nueva unidad</h2>
            <p className="mt-1 text-xs text-texto-suave">
              El vehículo del cliente sobre el que se ejecutará el trabajo.
            </p>

            <form action={enviar} className="mt-4 grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="cliente_id" value={clienteId} />

              <Campo etiqueta="Placa" htmlFor="nu-placa" requerido>
                <Entrada
                  id="nu-placa"
                  name="placa"
                  required
                  autoFocus
                  placeholder="V2G-841"
                  className="tabular uppercase"
                />
              </Campo>

              <Campo etiqueta="Tipo de vehículo" htmlFor="nu-tipo_vehiculo" requerido>
                <Seleccion id="nu-tipo_vehiculo" name="tipo_vehiculo" defaultValue="VOLQUETE">
                  {TIPOS_VEHICULO.map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
                </Seleccion>
              </Campo>

              <Campo etiqueta="Tipo de carrocería" htmlFor="nu-tipo_carroceria_id">
                <Seleccion id="nu-tipo_carroceria_id" name="tipo_carroceria_id">
                  <option value="">Sin especificar</option>
                  {tiposCarroceria.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </Seleccion>
              </Campo>

              <Campo etiqueta="Marca" htmlFor="nu-marca">
                <Entrada id="nu-marca" name="marca" placeholder="VOLVO" />
              </Campo>

              <Campo etiqueta="Modelo" htmlFor="nu-modelo">
                <Entrada id="nu-modelo" name="modelo" placeholder="FMX 440" />
              </Campo>

              <Campo etiqueta="Año" htmlFor="nu-anio">
                <Entrada
                  id="nu-anio"
                  name="anio"
                  type="number"
                  min={1950}
                  max={2100}
                  className="tabular"
                />
              </Campo>

              <Campo etiqueta="N.º de chasis" htmlFor="nu-numero_chasis" className="sm:col-span-2">
                <Entrada id="nu-numero_chasis" name="numero_chasis" className="font-mono text-xs" />
              </Campo>

              <Campo etiqueta="Color" htmlFor="nu-color">
                <Entrada id="nu-color" name="color" />
              </Campo>

              <Campo etiqueta="Capacidad (m³)" htmlFor="nu-capacidad_m3">
                <Entrada
                  id="nu-capacidad_m3"
                  name="capacidad_m3"
                  type="number"
                  step="0.1"
                  min={0}
                  className="tabular text-right"
                />
              </Campo>

              <Campo etiqueta="Capacidad (t)" htmlFor="nu-capacidad_toneladas">
                <Entrada
                  id="nu-capacidad_toneladas"
                  name="capacidad_toneladas"
                  type="number"
                  step="0.1"
                  min={0}
                  className="tabular text-right"
                />
              </Campo>

              <Campo etiqueta="Observaciones" htmlFor="nu-observaciones">
                <AreaTexto id="nu-observaciones" name="observaciones" rows={1} />
              </Campo>

              {error && (
                <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro sm:col-span-3">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 sm:col-span-3">
                <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierto(false)}>
                  Cancelar
                </Boton>
                <Boton type="submit" tamano="sm" cargando={pendiente}>
                  Registrar unidad
                </Boton>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

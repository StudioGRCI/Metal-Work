'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
}: {
  clienteId: string
  tiposCarroceria: { id: string; nombre: string }[]
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
      iniciarTransicion(() => router.refresh())
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
      <Boton variante="secundario" tamano="sm" onClick={abrir}>
        <Plus aria-hidden className="size-3.5" />
        Agregar unidad
      </Boton>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
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

              <Campo etiqueta="Placa" htmlFor="placa" requerido>
                <Entrada
                  id="placa"
                  name="placa"
                  required
                  autoFocus
                  placeholder="V2G-841"
                  className="tabular uppercase"
                />
              </Campo>

              <Campo etiqueta="Tipo de vehículo" htmlFor="tipo_vehiculo" requerido>
                <Seleccion id="tipo_vehiculo" name="tipo_vehiculo" defaultValue="VOLQUETE">
                  {TIPOS_VEHICULO.map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
                </Seleccion>
              </Campo>

              <Campo etiqueta="Tipo de carrocería" htmlFor="tipo_carroceria_id">
                <Seleccion id="tipo_carroceria_id" name="tipo_carroceria_id">
                  <option value="">Sin especificar</option>
                  {tiposCarroceria.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </Seleccion>
              </Campo>

              <Campo etiqueta="Marca" htmlFor="marca">
                <Entrada id="marca" name="marca" placeholder="VOLVO" />
              </Campo>

              <Campo etiqueta="Modelo" htmlFor="modelo">
                <Entrada id="modelo" name="modelo" placeholder="FMX 440" />
              </Campo>

              <Campo etiqueta="Año" htmlFor="anio">
                <Entrada
                  id="anio"
                  name="anio"
                  type="number"
                  min={1950}
                  max={2100}
                  className="tabular"
                />
              </Campo>

              <Campo etiqueta="N.º de chasis" htmlFor="numero_chasis" className="sm:col-span-2">
                <Entrada id="numero_chasis" name="numero_chasis" className="font-mono text-xs" />
              </Campo>

              <Campo etiqueta="Color" htmlFor="color">
                <Entrada id="color" name="color" />
              </Campo>

              <Campo etiqueta="Capacidad (m³)" htmlFor="capacidad_m3">
                <Entrada
                  id="capacidad_m3"
                  name="capacidad_m3"
                  type="number"
                  step="0.1"
                  min={0}
                  className="tabular text-right"
                />
              </Campo>

              <Campo etiqueta="Capacidad (t)" htmlFor="capacidad_toneladas">
                <Entrada
                  id="capacidad_toneladas"
                  name="capacidad_toneladas"
                  type="number"
                  step="0.1"
                  min={0}
                  className="tabular text-right"
                />
              </Campo>

              <Campo etiqueta="Observaciones" htmlFor="observaciones">
                <AreaTexto id="observaciones" name="observaciones" rows={1} />
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
        </div>
      )}
    </>
  )
}

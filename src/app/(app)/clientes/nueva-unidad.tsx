'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'

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
  const [carroceriaId, setCarroceriaId] = useState('')
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

      {/* La `Ventana` del sistema pone el portal —el formulario de adentro no
          puede quedar anidado en el que abrió el cuadro—, el título, Escape, el
          foco y, sobre todo, NO cierra al tocar el fondo: ese roce con el pulgar
          era el que borraba la placa, el chasis y las capacidades ya escritas. */}
      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Nueva unidad"
        descripcion="El vehículo del cliente sobre el que se ejecutará el trabajo."
        ancho="lg"
      >
        <form action={enviar} className="grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="cliente_id" value={clienteId} />

          <Campo etiqueta="Placa" htmlFor="nu-placa" requerido>
            {/* La placa se escribe en mayúsculas y nunca la sabe el
                navegador: sin esto el teclado del teléfono la empieza en
                minúscula y el corrector la "arregla". Teclado normal, que la
                placa peruana lleva letras. */}
            <Entrada
              id="nu-placa"
              name="placa"
              required
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
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
            <SeleccionBuscable
              id="nu-tipo_carroceria_id"
              name="tipo_carroceria_id"
              valor={carroceriaId}
              onChange={setCarroceriaId}
              marcador="Sin especificar"
              marcadorBusqueda="Tolva, cisterna, furgón…"
              opciones={tiposCarroceria.map((t) => ({ valor: t.id, etiqueta: t.nombre }))}
            />
          </Campo>

          <Campo etiqueta="Marca" htmlFor="nu-marca">
            <Entrada id="nu-marca" name="marca" autoComplete="off" placeholder="VOLVO" />
          </Campo>

          <Campo etiqueta="Modelo" htmlFor="nu-modelo">
            <Entrada id="nu-modelo" name="modelo" autoComplete="off" placeholder="FMX 440" />
          </Campo>

          <Campo etiqueta="Año" htmlFor="nu-anio">
            <Entrada
              id="nu-anio"
              name="anio"
              type="number"
              inputMode="numeric"
              min={1950}
              max={2100}
              className="tabular"
            />
          </Campo>

          <Campo etiqueta="N.º de chasis" htmlFor="nu-numero_chasis" className="sm:col-span-2">
            <Entrada
              id="nu-numero_chasis"
              name="numero_chasis"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono text-xs"
            />
          </Campo>

          <Campo etiqueta="Color" htmlFor="nu-color">
            <Entrada id="nu-color" name="color" autoComplete="off" />
          </Campo>

          <Campo etiqueta="Capacidad (m³)" htmlFor="nu-capacidad_m3">
            <Entrada
              id="nu-capacidad_m3"
              name="capacidad_m3"
              type="number"
              inputMode="decimal"
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
              inputMode="decimal"
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
      </Ventana>
    </>
  )
}

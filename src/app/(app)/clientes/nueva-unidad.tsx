'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
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
  onCreada,
  compacta = false,
}: {
  clienteId: string
  /** Para los formularios que quieren quedarse con la unidad recién creada. */
  // La placa puede faltar: quien reciba la unidad recién creada la nombra con
  // nombreDeUnidad(), no dando por hecho que hay matrícula.
  onCreada?: (unidad: {
    id: string
    placa: string | null
    codigo_interno?: string | null
    numero_chasis?: string | null
    marca?: string | null
    modelo?: string | null
  }) => void
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
      <Boton
        type="button"
        variante={compacta ? 'contorno' : 'secundario'}
        tamano="sm"
        aria-label="Nueva unidad"
        onClick={abrir}
      >
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
        <form action={enviar} className="grid items-start gap-4 sm:grid-cols-3">
          <input type="hidden" name="cliente_id" value={clienteId} />

          {/* Esta ficha describe el chasis que trae el cliente y nada más. La
              carrocería NO va acá: es lo que Metal Work va a fabricar y se
              decide en la cotización, que es donde el vendedor la elige y donde
              puede cambiar. Ponerla en la unidad obligaba a decidirla antes de
              cotizar y dejaba dos sitios diciendo qué se construye.

              El orden es el de la rejilla, y no el que fueron pidiendo los
              cambios: primero los cuatro obligatorios —tipo, marca, modelo y
              año—, que llenan la primera fila y el arranque de la segunda;
              después lo que puede faltar. Antes quedaban repartidos con la placa
              en medio, y la segunda fila terminaba en un hueco.

              La placa va con los opcionales porque muchas veces todavía no
              existe: el chasis llega sin matricular, y encabezar el formulario
              con un campo que a menudo se deja vacío hacía empezar en falso. */}
          <Campo etiqueta="Tipo de vehículo" htmlFor="nu-tipo_vehiculo" requerido>
            <Seleccion
              id="nu-tipo_vehiculo"
              name="tipo_vehiculo"
              defaultValue="VOLQUETE"
              autoFocus
              required
            >
              {TIPOS_VEHICULO.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {/* Los tres son obligatorios: una unidad sin marca, modelo ni año no
              puede estar en el catálogo. Sin ellos la ficha de la cotización
              sale con rayas y el taller no sabe sobre qué chasis fabrica. */}
          <Campo etiqueta="Marca" htmlFor="nu-marca" requerido>
            <Entrada id="nu-marca" name="marca" autoComplete="off" placeholder="VOLVO" required />
          </Campo>

          <Campo etiqueta="Modelo" htmlFor="nu-modelo" requerido>
            <Entrada
              id="nu-modelo"
              name="modelo"
              autoComplete="off"
              placeholder="FMX 440"
              required
            />
          </Campo>

          <Campo etiqueta="Año" htmlFor="nu-anio" requerido>
            <Entrada
              id="nu-anio"
              name="anio"
              type="number"
              inputMode="numeric"
              min={1950}
              max={2100}
              placeholder="2024"
              className="tabular"
              required
            />
          </Campo>

          <Campo
            etiqueta="Placa"
            htmlFor="nu-placa"
            ayuda="Déjala vacía si el chasis todavía no está matriculado: la unidad se nombra sola con el chasis o el código interno hasta que tenga placa."
          >
            {/* La placa se escribe en mayúsculas y nunca la sabe el
                navegador: sin esto el teclado del teléfono la empieza en
                minúscula y el corrector la "arregla". Teclado normal, que la
                placa peruana lleva letras. */}
            <Entrada
              id="nu-placa"
              name="placa"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="V2G-841"
              className="tabular uppercase"
            />
          </Campo>

          <Campo etiqueta="Color" htmlFor="nu-color">
            <Entrada id="nu-color" name="color" autoComplete="off" placeholder="Blanco" />
          </Campo>

          {/* Los dos largos, uno por fila y de lado a lado. El chasis es el dato
              más largo del formulario —diecisiete caracteres que se copian de la
              tarjeta— y estaba en dos columnas con el color al costado, que es
              una palabra. */}
          <Campo etiqueta="N.º de chasis" htmlFor="nu-numero_chasis" className="sm:col-span-3">
            <Entrada
              id="nu-numero_chasis"
              name="numero_chasis"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="9BM958344MB123456"
              className="font-mono text-xs uppercase"
            />
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="nu-observaciones" className="sm:col-span-3">
            <AreaTexto id="nu-observaciones" name="observaciones" rows={2} />
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

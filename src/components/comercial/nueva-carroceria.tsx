'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'

import { crearCarroceria } from '@/app/(app)/configuracion/acciones'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'


/**
 * Alta de un tipo de carrocería desde el propio formulario.
 *
 * Para el pedido especial que el catálogo no tiene: se le pone nombre, queda
 * elegido y se sigue cotizando. Las horas y los precios de referencia los
 * ajusta administración después, desde Configuración.
 */
export function NuevaCarroceria({
  onCreada,
}: {
  onCreada?: (carroceria: { id: string; nombre: string }) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [tipoUnidad, setTipoUnidad] = useState('')
  // Tras el éxito la ventana queda abierta con «Cerrar» y sin el botón de
  // registrar: no hay segundo envío posible. Si nadie espera la carrocería
  // nueva, se repinta la pantalla para que aparezca en la lista.
  const { alEnviar, enviando, resultado, limpiar } = useEnvio(
    crearCarroceria,
    (r) => {
      if (r.datos) onCreada?.(r.datos)
    },
    { refrescar: !onCreada },
  )

  function abrir() {
    limpiar()
    setAbierto(true)
  }

  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        aria-label="Nuevo tipo de carrocería"
        onClick={abrir}
      >
        <Plus aria-hidden className="size-3.5" />
        Nuevo
      </Boton>

      {/* El portal, el fondo, la caja, el título y el botón de cerrar los pone
          la Ventana; acá queda solo el formulario. */}
      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Nuevo tipo de carrocería"
        descripcion="Para el pedido especial que el catálogo no tiene todavía."
      >
        <form onSubmit={alEnviar} className="space-y-3">
          {/* El tipo va PRIMERO y antes del nombre porque es lo que decide todo
              lo demás: la capacidad que se puede elegir, y el SR/CM del código
              de producto. Su propia hoja lo dice con una regla de una línea:
              la que lleva ejes es semirremolque, la que no, montaje. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Tipo"
              htmlFor="ncar-tipo_unidad"
              ayuda="Si lleva ejes propios es semirremolque; si va montada sobre el chasis del cliente, carrocería montada."
            >
              <Seleccion
                id="ncar-tipo_unidad"
                name="tipo_unidad"
                value={tipoUnidad}
                onChange={(e) => setTipoUnidad(e.target.value)}
              >
                <option value="">Sin definir</option>
                <option value="SEMIRREMOLQUE">Semirremolque</option>
                <option value="CARROCERIA_MONTADA">Carrocería montada</option>
              </Seleccion>
            </Campo>

            <Campo
              etiqueta="Capacidad"
              htmlFor="ncar-capacidad"
              ayuda="La habitual de esta carrocería. Baja sola a la cotización y ahí se corrige."
            >
              <Entrada id="ncar-capacidad" name="capacidad" autoComplete="off" placeholder="15 m³" />
            </Campo>
          </div>

          <Campo etiqueta="Nombre" htmlFor="ncar-nombre" requerido>
            <Entrada
              id="ncar-nombre"
              name="nombre"
              required
              placeholder="Tolva con tiro y suspensión mecánica"
            />
          </Campo>
          <Campo etiqueta="Descripción" htmlFor="ncar-descripcion" ayuda="Opcional">
            <AreaTexto
              id="ncar-descripcion"
              name="descripcion"
              rows={2}
              placeholder="Qué la hace distinta de las del catálogo."
            />
          </Campo>

          {resultado && !resultado.ok && (
            <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {resultado.error}
            </p>
          )}
          {resultado?.ok && resultado.mensaje && (
            <p role="status" className="rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-xs text-exito">
              {resultado.mensaje}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {/* Tras el éxito el botón dice «Cerrar»: la ventana no se cierra
                sola porque cerrarla desde un efecto está prohibido acá. */}
            <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierto(false)}>
              {resultado?.ok ? 'Cerrar' : 'Cancelar'}
            </Boton>
            {!resultado?.ok && (
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar al catálogo
              </Boton>
            )}
          </div>
        </form>
      </Ventana>
    </>
  )
}

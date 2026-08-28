'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { crearCarroceria } from '@/app/(app)/configuracion/acciones'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'

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
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<
    { ok: true; mensaje?: string } | { ok: false; error: string } | null
  >(null)

  async function enviar(datos: FormData) {
    setEnviando(true)
    const salida = await crearCarroceria(null, datos)
    setEnviando(false)
    setResultado(salida)

    if (salida.ok && salida.datos) {
      onCreada?.(salida.datos)
      if (!onCreada) iniciarTransicion(() => router.refresh())
    }
  }

  function abrir() {
    setResultado(null)
    setAbierto(true)
  }

  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={abrir}>
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
        <form action={enviar} className="space-y-3">
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

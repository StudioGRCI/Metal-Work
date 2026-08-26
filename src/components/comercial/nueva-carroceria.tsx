'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'

import { crearCarroceria } from '@/app/(app)/configuracion/acciones'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'

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

      {abierto &&
        // En un portal a propósito: el diálogo lleva su propio <form> y, si se
        // renderizara dentro del formulario que lo abrió, quedarían anidados
        // —HTML no lo permite y React envía el de afuera—.
        createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Nuevo tipo de carrocería"
            className="w-full max-w-lg rounded-[calc(var(--radius-base)*1.5)] border border-borde bg-superficie p-5 shadow-2xl shadow-black/30"
          >
            <h2 className="text-base font-semibold text-texto">Nuevo tipo de carrocería</h2>
            <p className="mt-0.5 text-xs text-texto-suave">
              Para el pedido especial que el catálogo no tiene todavía.
            </p>

            <form action={enviar} className="mt-4 space-y-3">
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
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

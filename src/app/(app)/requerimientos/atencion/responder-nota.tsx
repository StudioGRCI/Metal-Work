'use client'

import { Reply } from 'lucide-react'
import { useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'

import { atenderConformidad } from './acciones'

/**
 * Almacén cierra la nota de una salida escribiendo qué hizo (plan 2, entrega
 * 2.2): queda quién y cuándo, y a quien la anotó le llega el aviso. Lo
 * respondido no se cambia después.
 */
export function ResponderNota({ id, titulo, resumen }: { id: string; titulo: string; resumen: string }) {
  const [abierta, setAbierta] = useState(false)
  const aviso = useRef<HTMLParagraphElement>(null)
  const { alEnviar, enviando, error } = useEnvio(atenderConformidad, () => setAbierta(false))
  useCursorAlRechazo(enviando, error, () => aviso.current)
  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)} data-responder-nota={id}>
        <Reply aria-hidden className="size-4" />
        Responder
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={titulo}
        descripcion={`${resumen} Lo que respondas cierra la nota, le llega a quien la anotó y no se cambia después.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Qué hiciste" htmlFor={`nota-respuesta-${id}`} requerido>
              <AreaTexto
                id={`nota-respuesta-${id}`}
                name="respuesta"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: repuse el disco que faltó con otra salida; o lo recogió el supervisor, firmó la salida."
              />
            </Campo>
          </fieldset>
          <p ref={aviso} tabIndex={-1} role="alert" className="text-sm text-peligro outline-none empty:hidden">
            {error}
          </p>
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Cerrar la nota
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

'use client'

import { Reply } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { atenderConformidad } from './acciones'

/** Lo que dijo la última nota cerrada: lo pinta `AvisoDeLasNotas`, que no se va con la fila. */
const CLAVE_DEL_AVISO = 'atencion-nota-cerrada'

/**
 * Almacén cierra la nota de una salida escribiendo qué hizo (plan 2, entrega
 * 2.2): queda quién y cuándo, y a quien la anotó le llega el aviso. Lo
 * respondido no se cambia después.
 */
export function ResponderNota({ id, requerimiento, resumen }: { id: string; requerimiento: string; resumen: string }) {
  const [abierta, setAbierta] = useState(false)
  const [, setAviso] = useEstadoCompartido<{ texto: string; vez: number } | null>(CLAVE_DEL_AVISO, null)
  const { alEnviar, enviando, error } = useEnvio(atenderConformidad, (r) => {
    setAbierta(false)
    setAviso({ texto: `${requerimiento}: ${r.mensaje ?? 'nota cerrada.'}`, vez: Date.now() })
  })
  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)} data-responder-nota={id}>
        <Reply aria-hidden className="size-4" />
        Responder
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Responder la nota del ${requerimiento}`}
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
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Cerrar la nota" />
        </form>
      </Ventana>
    </>
  )
}

/**
 * El aviso de la nota que se acaba de cerrar, arriba de Atención y siempre
 * puesto: la fila se va al cerrarla, y con la última, la tarjeta entera. El
 * cursor viene aquí, porque el botón que abrió la ventana ya no está.
 */
export function AvisoDeLasNotas() {
  const [aviso] = useEstadoCompartido<{ texto: string; vez: number } | null>(CLAVE_DEL_AVISO, null)
  const caja = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => caja.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [aviso])
  return (
    <p ref={caja} role="status" tabIndex={-1} className="mb-3 text-sm text-exito outline-none empty:hidden" data-nota-cerrada={aviso ? '' : undefined}>
      {aviso && <span key={aviso.vez}>{aviso.texto}</span>}
    </p>
  )
}

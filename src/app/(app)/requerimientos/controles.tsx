'use client'

import { Ban } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { anularRequerimiento } from './acciones'

/** Anular un requerimiento que Logística todavía no empieza: con motivo, sin borrarlo. */
export function AnularRequerimiento({ id, numero }: { id: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularRequerimiento, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setAbierta(true)}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular el requerimiento ${numero}`}
        descripcion="No se borra: queda con su número, el motivo y la fecha. Logística deja de verlo por atender."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`rq-motivo-${id}`} requerido>
            <AreaTexto
              id={`rq-motivo-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              placeholder="Por ejemplo: se pidió dos veces; el área ya lo consiguió en almacén."
            />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

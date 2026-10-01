'use client'

import type { FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'

import { cerrarCosto, confirmarIgv } from './acciones'

/**
 * Dos botones, una sola pregunta: si el monto de la cotización trae IGV. El
 * botón tocado viaja como `incluye_igv`; `new FormData(form)` no incluye al
 * botón que envió, así que se agrega a mano.
 */
export function ConfirmarIgv({ cotizacionId, ordenId }: { cotizacionId: string; ordenId: string }) {
  const { alEnviar, enviando, error } = useEnvio(confirmarIgv)

  function enviar(evento: FormEvent<HTMLFormElement>) {
    const boton = (evento.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    alEnviar(evento, (datos) => {
      if (boton?.value) datos.set('incluye_igv', boton.value)
    })
  }

  return (
    <form onSubmit={enviar} className="space-y-2 print:hidden">
      <input type="hidden" name="cotizacion_id" value={cotizacionId} />
      <input type="hidden" name="orden_id" value={ordenId} />
      <p className="text-sm text-texto">¿El monto de la cotización incluye IGV? Míralo en el PDF aprobado.</p>
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" value="si" variante="secundario" tamano="sm" cargando={enviando}>
          Sí, incluye IGV
        </Boton>
        <Boton type="submit" value="no" variante="secundario" tamano="sm" cargando={enviando}>
          No, es sin IGV
        </Boton>
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
    </form>
  )
}

/**
 * Congela el costo. Va escondido en un desplegable: es un paso que se da una
 * vez por OT y no se deshace.
 */
export function CerrarCosto({ ordenId }: { ordenId: string }) {
  const { alEnviar, enviando, error } = useEnvio(cerrarCosto)

  return (
    <details className="rounded-[var(--radius-base)] border border-borde p-3 print:hidden">
      <summary className="cursor-pointer text-sm font-medium text-acento">Cerrar el costo de esta OT</summary>
      <form onSubmit={alEnviar} className="mt-3 space-y-3">
        <input type="hidden" name="orden_id" value={ordenId} />
        <p className="text-xs text-texto-suave">
          El costo queda congelado con su detalle, tu puesto y la fecha. No se edita ni se borra después: lo que llegue
          más tarde se verá como diferencia contra este cierre.
        </p>
        <Campo etiqueta="Nota del cierre" htmlFor="cierre-nota" ayuda="Opcional. Por ejemplo, qué se revisó antes de cerrar.">
          <AreaTexto id="cierre-nota" name="nota" rows={2} maxLength={1000} />
        </Campo>
        {error && (
          <p role="alert" className="text-sm text-peligro">
            {error}
          </p>
        )}
        <Boton type="submit" cargando={enviando}>
          Cerrar el costo
        </Boton>
      </form>
    </details>
  )
}

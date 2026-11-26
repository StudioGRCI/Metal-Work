'use client'

import { Ban } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { anularAveria } from '../acciones'

/** Lo que dijo la anulación: va en el renglón de estado del encabezado, fuera de la ventana. */
const CLAVE_AVISO = 'averias:anular:aviso'

export function AvisoDeLaAnulacion() {
  const [aviso] = useEstadoCompartido<string | null>(CLAVE_AVISO, null)
  // Montada siempre: el verde que nace con su texto no lo oye el lector.
  return (
    <p role="status" className={aviso ? 'text-sm text-exito' : 'sr-only'}>
      {aviso}
    </p>
  )
}

/**
 * Mantenimiento anula un reporte mal hecho, con su motivo. No se borra: queda
 * con quién, cuándo y por qué; si el equipo sigue parado por él, vuelve a como estaba.
 */
export function AnularAveria({ id, numero, paroElEquipo }: { id: string; numero: string; paroElEquipo: boolean }) {
  const [abierta, setAbierta] = useState(false)
  const [, setAviso] = useEstadoCompartido<string | null>(CLAVE_AVISO, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularAveria, (r) => {
    setAbierta(false)
    setAviso(r.mensaje ?? 'Reporte anulado.')
  })
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        data-anular-averia
        onClick={() => {
          limpiar()
          setAviso(null)
          setAbierta(true)
        }}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular el reporte ${numero}`}
        descripcion={
          paroElEquipo
            ? 'Para un reporte repetido o hecho por error. No se borra: queda con su motivo, le llega el aviso a quien lo reportó y, si el equipo sigue parado por este reporte, vuelve a como estaba.'
            : 'Para un reporte repetido o hecho por error. No se borra: queda con su motivo y le llega el aviso a quien lo reportó.'
        }
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-averia-${id}`} requerido>
              <AreaTexto
                id={`anular-averia-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: es la misma falla del reporte AV-0012-2026."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

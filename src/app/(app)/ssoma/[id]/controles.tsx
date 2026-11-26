'use client'

import { Ban } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { anularReporteSsoma } from '../acciones'

/** SSOMA anula un reporte mal hecho, con su motivo. No se borra: queda con quién, cuándo y por qué. */
export function AnularReporte({ id, numero }: { id: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularReporteSsoma, () => setAbierta(false))
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        data-anular-reporte
        onClick={() => {
          limpiar()
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
        descripcion="Para un reporte repetido o hecho por error. No se borra: queda con su motivo y le llega el aviso a quien lo reportó."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-ssoma-${id}`} requerido>
              <AreaTexto
                id={`anular-ssoma-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: es el mismo hecho del reporte RI-0012-2026."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

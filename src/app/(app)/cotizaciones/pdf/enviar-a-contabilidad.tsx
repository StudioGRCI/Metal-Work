'use client'

import { Send } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { useAccion } from '@/lib/envio'

import { enviarCotizacionAContabilidad } from './acciones-contabilidad'

/** Administración envía la cotización aprobada, con su OT, a Contabilidad para que la facture. */
export function EnviarAContabilidad({ cotizacionId, numero, ordenNumero }: { cotizacionId: string; numero: string; ordenNumero: string }) {
  const { ejecutar, enviando, error } = useAccion(enviarCotizacionAContabilidad)
  return (
    <div className="space-y-1">
      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        cargando={enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('cotizacion_id', cotizacionId)
          ejecutar(datos)
        }}
        data-enviar-contabilidad={numero}
      >
        <Send aria-hidden className="size-4" />
        Enviar a Contabilidad
      </Boton>
      <p className="max-w-sm text-xs text-texto-suave">Contabilidad la factura sobre la OT {ordenNumero} y pasa la factura a Tesorería.</p>
      {error && (
        <p role="alert" className="text-xs text-peligro">
          {error}
        </p>
      )}
    </div>
  )
}

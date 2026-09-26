'use client'

import { MessageSquareText } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { registrarObservacionCotizacionTesoreria } from '../cotizaciones/pdf/acciones-tesoreria'

export function ObservacionCotizacion({ cotizacionId }: { cotizacionId: string }) {
  const [nota, setNota] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(registrarObservacionCotizacionTesoreria, (r) => {
    setNota(r.mensaje ?? 'Observación registrada.')
  })
  return <form onSubmit={alEnviar} className="mt-4 space-y-3 border-t border-borde pt-4">
    <input type="hidden" name="cotizacion_id" value={cotizacionId} />
    <Campo etiqueta="Observación de Tesorería" htmlFor={`obs-tesoreria-${cotizacionId}`} ayuda="Se guarda en el historial financiero y queda visible para Tesorería y Administración.">
      <AreaTexto id={`obs-tesoreria-${cotizacionId}`} name="observacion" required minLength={3} maxLength={2000} disabled={enviando} placeholder="Escribe qué debe revisar o completar Administración…" />
    </Campo>
    {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
    {nota && <p role="status" className="text-sm text-exito">{nota}</p>}
    <Boton type="submit" variante="secundario" tamano="sm" cargando={enviando}>
      <MessageSquareText aria-hidden className="size-4" />Guardar observación
    </Boton>
  </form>
}

'use client'

import { Send } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { useEnvio } from '@/lib/envio'
import { liberarCotizacionATesoreria } from './acciones-tesoreria'

export function LiberarATesoreria({ cotizacionId }: { cotizacionId: string }) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(liberarCotizacionATesoreria, (r) => {
    setMensaje(r.mensaje ?? 'Liberada a Tesorería.')
  })
  return <form onSubmit={alEnviar} className="space-y-2">
    <input type="hidden" name="cotizacion_id" value={cotizacionId} />
    <p className="max-w-sm text-xs text-texto-suave">Comparte el PDF aceptado con Tesorería para revisión y observaciones financieras.</p>
    <Boton type="submit" variante="secundario" tamano="sm" cargando={enviando}>
      <Send aria-hidden className="size-4" />Liberar a Tesorería
    </Boton>
    {error && <p role="alert" className="text-xs text-peligro">{error}</p>}
    {mensaje && <p role="status" className="text-xs text-exito">{mensaje}</p>}
  </form>
}

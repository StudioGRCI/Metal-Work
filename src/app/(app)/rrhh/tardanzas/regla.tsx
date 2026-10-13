'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'

import { guardarReglaTardanza } from './acciones'

/** La tolerancia y el descuento por minuto, para que RR. HH. los ajuste sin pedirlo a nadie. */
export function FormularioRegla({ tolerancia, descuentoPorMinuto }: { tolerancia: number; descuentoPorMinuto: number }) {
  const [aviso, setAviso] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(guardarReglaTardanza, (r) => setAviso(r.mensaje ?? 'Regla guardada.'))
  return (
    <form
      onSubmit={(e) => {
        setAviso(null)
        alEnviar(e)
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tolerancia (minutos)" htmlFor="regla-tolerancia" requerido ayuda="Hasta estos minutos después de su hora no se descuenta.">
          <Entrada id="regla-tolerancia" name="tolerancia_minutos" type="number" min={0} max={120} step={1} required defaultValue={tolerancia} className="tabular" />
        </Campo>
        <Campo etiqueta="Descuento por minuto (S/)" htmlFor="regla-descuento" requerido ayuda="Pasada la tolerancia se descuentan todos los minutos de tardanza.">
          <Entrada id="regla-descuento" name="descuento_por_minuto" type="number" min={0} max={100} step={0.0001} required defaultValue={descuentoPorMinuto} className="tabular" />
        </Campo>
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      {aviso && !error && (
        <p role="status" className="text-sm text-exito">
          {aviso}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" variante="secundario" cargando={enviando}>
          Guardar la regla
        </Boton>
      </div>
    </form>
  )
}

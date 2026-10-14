'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'

import { guardarReglaTardanza } from './acciones'

/** La tolerancia y el descuento por tardanzas, para que RR. HH. los ajuste sin pedirlo a nadie. */
export function FormularioRegla({
  tolerancia,
  tardanzasPorDescuento,
  porcentajeDescuento,
}: {
  tolerancia: number
  tardanzasPorDescuento: number
  porcentajeDescuento: number
}) {
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Tolerancia (minutos)" htmlFor="regla-tolerancia" requerido ayuda="Hasta estos minutos después de su hora no cuenta como tardanza.">
          <Entrada id="regla-tolerancia" name="tolerancia_minutos" type="number" min={0} max={120} step={1} required defaultValue={tolerancia} className="tabular" />
        </Campo>
        <Campo etiqueta="Tardanzas por descuento" htmlFor="regla-veces" requerido ayuda="Cada tantas tardanzas en el mes, un descuento.">
          <Entrada id="regla-veces" name="tardanzas_por_descuento" type="number" min={1} max={31} step={1} required defaultValue={tardanzasPorDescuento} className="tabular" />
        </Campo>
        <Campo etiqueta="Descuento (% del sueldo)" htmlFor="regla-porcentaje" requerido ayuda="De su remuneración mensual, por cada grupo de tardanzas.">
          <Entrada id="regla-porcentaje" name="porcentaje_descuento" type="number" min={0} max={100} step={0.01} required defaultValue={porcentajeDescuento} className="tabular" />
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

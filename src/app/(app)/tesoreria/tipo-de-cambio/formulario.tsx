'use client'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'

import { registrarTipoDeCambio } from './acciones'

export function FormularioTipoDeCambio({ hoy }: { hoy: string }) {
  const { alEnviar, enviando, error, resultado } = useEnvio(registrarTipoDeCambio)
  return (
    <form onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
      <Campo etiqueta="Fecha" htmlFor="tc-fecha" requerido>
        <Entrada id="tc-fecha" type="date" name="fecha" defaultValue={hoy} max={hoy} required />
      </Campo>
      <Campo etiqueta="Compra" htmlFor="tc-compra" requerido ayuda="Soles por dólar">
        <Entrada id="tc-compra" name="compra" type="number" inputMode="decimal" min="0.0001" step="0.0001" placeholder="3.745" required />
      </Campo>
      <Campo etiqueta="Venta" htmlFor="tc-venta" requerido ayuda="Soles por dólar">
        <Entrada id="tc-venta" name="venta" type="number" inputMode="decimal" min="0.0001" step="0.0001" placeholder="3.752" required />
      </Campo>
      <Campo etiqueta="Fuente" htmlFor="tc-fuente">
        <Seleccion id="tc-fuente" name="fuente" defaultValue="SUNAT">
          <option value="SUNAT">SUNAT</option>
          <option value="SBS">SBS</option>
          <option value="BANCO">Banco</option>
          <option value="OTRO">Otra</option>
        </Seleccion>
      </Campo>
      <Boton type="submit" cargando={enviando}>
        Guardar cambio
      </Boton>
      {error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-2 lg:col-span-5">
          {error}
        </p>
      )}
      {resultado?.ok && (
        <p role="status" className="text-sm text-exito sm:col-span-2 lg:col-span-5">
          {resultado.mensaje}
        </p>
      )}
    </form>
  )
}

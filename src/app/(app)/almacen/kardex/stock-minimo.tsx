'use client'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'

import { fijarStockMinimo } from './acciones'

/** Fijar o quitar el stock mínimo del material que se está mirando. */
export function FijarStockMinimo({ materialId, minimo, unidad }: { materialId: string; minimo: number | null; unidad: string | null }) {
  // De cuál material: el de otro se llevaba la línea del rechazo de este (R13
  // de realización, cuadragésima quinta pasada).
  const { alEnviar, enviando, error, resultado } = useEnvio(fijarStockMinimo, undefined, { documento: `material:${materialId}` })
  return (
    <form onSubmit={alEnviar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="material_id" value={materialId} />
      <Campo etiqueta={`Stock mínimo${unidad ? ` (${unidad})` : ''}`} htmlFor="stock-minimo" className="w-44">
        <Entrada id="stock-minimo" name="minimo" type="number" inputMode="decimal" min={0} step="0.001"
          defaultValue={minimo ?? ''} placeholder="Sin mínimo" aria-describedby="stock-minimo-ayuda" />
      </Campo>
      <Boton type="submit" variante="contorno" cargando={enviando}>Guardar mínimo</Boton>
      <p id="stock-minimo-ayuda" className="w-full text-xs text-texto-suave">Cuando el saldo baja de aquí, avisa a Almacén y a Logística. Vacío: no avisa.</p>
      {error && <p role="alert" className="w-full text-xs text-peligro">{error}</p>}
      {resultado?.ok && <p role="status" className="w-full text-xs text-exito">{resultado.mensaje}</p>}
    </form>
  )
}

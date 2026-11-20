'use client'

import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { cantidad } from '@/lib/format'

import { fijarStockDeSeguridad } from './acciones'

/**
 * El mínimo y la compra por mayor de un material, en una ventana. El mínimo
 * dispara el aviso de stock bajo; la compra por mayor es cuánto se pide de una
 * vez (la caja de discos, el ciento de pernos).
 */
export function StockDeSeguridad({
  materialId,
  descripcion,
  unidad,
  minimo,
  porMayor,
  salio,
}: {
  materialId: string
  descripcion: string
  unidad: string | null
  minimo: number | null
  porMayor: number | null
  /** Lo que salió en 90 días: la referencia para fijar el mínimo. */
  salio: number
}) {
  const [abierta, setAbierta] = useState(false)
  const [listo, setListo] = useState<{ texto: string; n: number } | null>(null)
  const { alEnviar, enviando, error } = useEnvio(
    fijarStockDeSeguridad,
    (r) => {
      setAbierta(false)
      setListo((previo) => ({ texto: r.mensaje ?? 'Guardado.', n: (previo?.n ?? 0) + 1 }))
    },
    { documento: `material:${materialId}`, corrige: true },
  )
  const u = unidad ? ` (${unidad})` : ''
  return (
    <div className="space-y-1">
      <Boton
        type="button"
        tamano="sm"
        variante="contorno"
        onClick={() => {
          setListo(null)
          setAbierta(true)
        }}
        aria-label={`Mínimo y compra por mayor de ${descripcion}`}
      >
        <SlidersHorizontal aria-hidden className="size-4" />
        {minimo === null ? 'Fijar mínimo' : 'Cambiar'}
      </Boton>
      <p role="status" className={listo ? 'text-xs text-exito' : 'sr-only'}>
        {listo && <span key={listo.n}>{listo.texto}</span>}
      </p>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Stock de seguridad · ${descripcion}`}
        descripcion={`En los últimos 90 días salieron ${cantidad(salio)}${unidad ? ` ${unidad}` : ''}. Cuando lo que hay baja del mínimo, el sistema avisa a Almacén y a Logística con cuánto comprar.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="material_id" value={materialId} />
          <fieldset disabled={enviando} className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta={`Stock mínimo${u}`} htmlFor={`minimo-${materialId}`} ayuda="Vacío: no avisa." ayudaEnIcono={false}>
              <Entrada
                id={`minimo-${materialId}`}
                name="minimo"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.001"
                defaultValue={minimo ?? ''}
                placeholder="Sin mínimo"
              />
            </Campo>
            <Campo
              etiqueta={`Compra por mayor${u}`}
              htmlFor={`por-mayor-${materialId}`}
              ayuda="Cuánto se pide de una vez. Vacío: se repone hasta el mínimo."
              ayudaEnIcono={false}
            >
              <Entrada
                id={`por-mayor-${materialId}`}
                name="por_mayor"
                type="number"
                inputMode="decimal"
                min={0.001}
                step="0.001"
                defaultValue={porMayor ?? ''}
                placeholder="Hasta el mínimo"
              />
            </Campo>
          </fieldset>
          {error && <AvisoEnfocado rol="alert">{error}</AvisoEnfocado>}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Guardar
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}

'use client'

import { Tag } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { moneda as fmtMoneda } from '@/lib/format'

import { valorizarMaterial } from './acciones'

export type MaterialAValorizar = {
  id: string
  codigo: string
  descripcion: string
  unidad: string | null
  precio: number | null
  moneda: 'PEN' | 'USD' | null
  ultimaCompra: number | null
  monedaCompra: 'PEN' | 'USD' | null
}

/**
 * Fijar el precio unitario de un material del almacén. Cada vez es un precio
 * nuevo, vigente desde ahora: el anterior queda en el historial y lo que ya
 * salió del almacén no cambia de costo.
 */
export function FijarPrecio({ material }: { material: MaterialAValorizar }) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())

  const { alEnviar, enviando, error } = useEnvio(valorizarMaterial, () => {
    setId(crypto.randomUUID())
    setAbierta(false)
  })

  const sugerido = material.precio ?? material.ultimaCompra
  const monedaSugerida = material.moneda ?? material.monedaCompra ?? 'PEN'

  return (
    <>
      <Boton tamano="sm" variante={material.precio === null ? 'primario' : 'contorno'} onClick={() => setAbierta(true)}>
        <Tag aria-hidden className="size-4" />{material.precio === null ? 'Fijar precio' : 'Cambiar'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Precio de ${material.descripcion}`}
        descripcion="Precio unitario con el que se valoriza el almacén. Rige desde ahora; lo que ya salió conserva su costo."
      >
        <form key={id} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="operacion_id" value={id} />
          <input type="hidden" name="material_id" value={material.id} />

          <p className="text-sm text-texto-suave">
            {material.codigo}
            {material.ultimaCompra !== null && material.monedaCompra
              ? ` · última compra ${fmtMoneda(material.ultimaCompra, material.monedaCompra)} por ${material.unidad ?? 'unidad'}`
              : ' · nunca se compró por el sistema'}
          </p>

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Campo etiqueta={`Precio unitario${material.unidad ? ` por ${material.unidad}` : ''}`} htmlFor="val-precio" requerido>
              <Entrada id="val-precio" name="precio" type="number" inputMode="decimal" min={0} step="0.0001" required
                defaultValue={sugerido ?? undefined} />
            </Campo>
            <Campo etiqueta="Moneda" htmlFor="val-moneda" requerido>
              <Seleccion id="val-moneda" name="moneda" defaultValue={monedaSugerida} required>
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </Seleccion>
            </Campo>
          </div>

          <Campo etiqueta="De dónde sale el precio" htmlFor="val-observacion" ayuda="Proforma, factura de compra directa, precio de mercado…">
            <AreaTexto id="val-observacion" name="observacion" rows={2} maxLength={300} />
          </Campo>

          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <Boton type="submit" cargando={enviando}>Fijar precio</Boton>
        </form>
      </Ventana>
    </>
  )
}

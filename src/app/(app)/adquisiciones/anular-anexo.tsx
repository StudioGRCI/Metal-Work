'use client'

import { XCircle } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { anularDocumentoCompra } from '@/app/(app)/materiales/atencion/acciones-documentos'

/**
 * Logística anula la factura o la boleta que anexó por error a una OC, con su
 * motivo (migración 20261020210000). No se borra: queda tachada en la fila como
 * evidencia y deja de contar para el pago. Si la OC iba con boleta y esa
 * factura la sacaba del pago directo, vuelve a pagarse por su boleta. La factura
 * que ya se pagó por un camino y quedaría libre para el otro no se anula: la
 * fila no ofrece el botón (`bloqueoDelAnexo`, en `lib/dominio/adquisiciones`) y la base lo rechaza igual.
 * `porRevisar` es la factura que Contabilidad registró para otras OC y no
 * alcanza para esta: ahí el error es el anexo, y la ventana lo dice.
 */
export function AnularAnexo({
  id,
  etiqueta,
  oc,
  factura,
  porRevisar = null,
}: {
  id: string
  etiqueta: string
  oc: string
  factura: boolean
  porRevisar?: string | null
}) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularDocumentoCompra, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)} aria-label={`Anular ${etiqueta} de la ${oc}`}>
        <XCircle aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular ${etiqueta}`}
        descripcion={
          porRevisar
            ? `Contabilidad registró la ${porRevisar} para otras OC y no alcanza para esta: este anexo es el que está mal. No se borra: queda tachado en la ${oc} con su PDF, el motivo, quién y cuándo, y la OC vuelve a pagarse por su boleta. Si es de otra OC, después la anexas a la buena.`
            : factura
              ? `No se borra: queda tachada en la ${oc} con su PDF, el motivo, quién y cuándo, y deja de contar para su pago. Si era de otra OC, después la anexas a la buena. Tesorería y Contabilidad reciben el aviso si les cambia algo.`
              : `No se borra: queda tachada en la ${oc} con su PDF, el motivo, quién y cuándo. Después anexas la buena.`
        }
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-anexo-${id}`} requerido>
            <AreaTexto
              id={`anular-anexo-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              placeholder="Por ejemplo: era la factura de otra OC del mismo proveedor."
            />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

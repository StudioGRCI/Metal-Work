'use client'

import { FileUp, Truck } from 'lucide-react'
import { useState } from 'react'

import { SubirDocumentoCompra } from '@/app/(app)/materiales/atencion/subir-documento-compra'
import { Boton } from '@/components/ui/boton'
import { Ventana } from '@/components/ui/ventana'
import { useAccion } from '@/lib/envio'

import { mandarARecojo } from './acciones'

/** Lo que Logística hace con una compra desde la lista: mandarla a recojo y adjuntarle la factura. */
export function AccionesCompra({
  id,
  numero,
  recojo,
  adjuntar,
}: {
  id: string
  numero: string
  /** Se puede mandar a recojo: aprobada (o sin aprobación) y nadie la llevó todavía. */
  recojo: boolean
  adjuntar: boolean
}) {
  const [documentos, setDocumentos] = useState(false)
  // La primera carga lleva un identificador fijo: un reintento no duplica el documento.
  const [idDocumento] = useState(() => crypto.randomUUID())
  const envio = useAccion(mandarARecojo)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {recojo && (
        <Boton
          type="button"
          variante="secundario"
          tamano="sm"
          cargando={envio.enviando}
          onClick={() => {
            const datos = new FormData()
            datos.set('id', id)
            envio.ejecutar(datos)
          }}
        >
          <Truck aria-hidden className="size-4" />
          Mandar a recojo
        </Boton>
      )}
      {adjuntar && (
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => setDocumentos(true)}>
          <FileUp aria-hidden className="size-4" />
          Adjuntar
        </Boton>
      )}
      {envio.error && (
        <p role="alert" className="basis-full text-right text-xs text-peligro">
          {envio.error}
        </p>
      )}
      {envio.resultado?.ok && (
        <p role="status" className="basis-full text-right text-xs text-exito">
          {envio.resultado.mensaje}
        </p>
      )}
      <Ventana
        abierta={documentos}
        alCerrar={() => setDocumentos(false)}
        titulo={`Adjuntar a la compra ${numero}`}
        descripcion="La factura, o cualquier PDF de la compra. Queda en la compra y Tesorería lo ve para pagar."
        ancho="lg"
      >
        <SubirDocumentoCompra ordenCompraId={id} solicitudId={idDocumento} />
      </Ventana>
    </div>
  )
}

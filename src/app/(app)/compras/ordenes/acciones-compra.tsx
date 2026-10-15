'use client'

import { FileUp, Pencil, Truck } from 'lucide-react'
import { useState } from 'react'

import { SubirDocumentoCompra } from '@/app/(app)/materiales/atencion/subir-documento-compra'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { comprobantePedido } from '@/lib/dominio/proveedores'
import { useAccion, useEnvio } from '@/lib/envio'

import { corregirDatosCompra, mandarARecojo } from './acciones'

/**
 * Lo que Logística hace con una compra desde la lista: mandarla a recojo,
 * adjuntarle el comprobante y corregir si viene con factura o su código interno.
 */
export function AccionesCompra({
  id,
  numero,
  recojo,
  adjuntar,
  conFactura,
  codigoInterno,
  tieneComprobante,
  total,
  moneda,
}: {
  id: string
  numero: string
  /** El total con IGV (si va con factura) y la moneda: el detector compara la factura con ellos. */
  total: number
  moneda: string
  /** Se puede mandar a recojo: aprobada (o sin aprobación) y nadie la llevó todavía. */
  recojo: boolean
  adjuntar: boolean
  conFactura: boolean
  codigoInterno: string | null
  /** Con el comprobante ya adjunto, lo de la factura queda fijo; el código interno no. */
  tieneComprobante: boolean
}) {
  const [documentos, setDocumentos] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(false)
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
      {adjuntar && (
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setCorrigiendo(true)} aria-label={`Corregir la compra ${numero}`}>
          <Pencil aria-hidden className="size-4" />
          Corregir
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
        descripcion={
          conFactura
            ? 'La factura, o cualquier PDF de la compra. Queda en la compra y Tesorería lo ve para pagar.'
            : 'Es sin factura: adjunta la boleta, nota de venta o recibo. Queda en la compra y Tesorería lo ve para pagar.'
        }
        ancho="lg"
      >
        <SubirDocumentoCompra
          ordenCompraId={id}
          solicitudId={idDocumento}
          tipoInicial={conFactura ? 'FACTURA' : 'COMPROBANTE'}
          orden={{ numero, total, moneda }}
        />
      </Ventana>
      <Ventana abierta={corrigiendo} alCerrar={() => setCorrigiendo(false)} titulo={`Corregir la compra ${numero}`} ancho="md">
        <CorregirCompra
          id={id}
          conFactura={conFactura}
          codigoInterno={codigoInterno}
          tieneComprobante={tieneComprobante}
          alTerminar={() => setCorrigiendo(false)}
        />
      </Ventana>
    </div>
  )
}

function CorregirCompra({
  id,
  conFactura,
  codigoInterno,
  tieneComprobante,
  alTerminar,
}: {
  id: string
  conFactura: boolean
  codigoInterno: string | null
  tieneComprobante: boolean
  alTerminar: () => void
}) {
  const [factura, setFactura] = useState(conFactura)
  const { alEnviar, enviando, error } = useEnvio(corregirDatosCompra, alTerminar)
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="Código interno" htmlFor={`corregir-codigo-${id}`} requerido ayuda={AYUDA_CODIGO_INTERNO}>
        <Entrada
          id={`corregir-codigo-${id}`}
          name="codigo_interno"
          defaultValue={codigoInterno ?? ''}
          required
          minLength={2}
          maxLength={60}
          autoComplete="off"
        />
      </Campo>
      <Campo
        etiqueta="Comprobante"
        htmlFor={`corregir-factura-${id}`}
        ayuda={tieneComprobante ? 'El comprobante ya está adjunto: esto ya no se cambia.' : comprobantePedido(factura).pide}
      >
        {/* Un select desactivado no se envía: el valor viaja aparte. */}
        <Seleccion
          id={`corregir-factura-${id}`}
          value={factura ? 'true' : 'false'}
          onChange={(e) => setFactura(e.target.value === 'true')}
          disabled={tieneComprobante}
        >
          <option value="true">Con factura</option>
          <option value="false">Sin factura</option>
        </Seleccion>
      </Campo>
      <input type="hidden" name="con_factura" value={factura ? 'true' : 'false'} />
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando}>
          Guardar
        </Boton>
      </div>
    </form>
  )
}

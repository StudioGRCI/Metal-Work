'use client'

import { FileUp } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { registrarDocumentoCompra } from './acciones-documentos'

const TIPOS = [
  ['ORDEN_COMPRA', 'Orden de compra'],
  ['ORDEN_PAGO', 'Orden de pago'],
  ['ORDEN_SERVICIO', 'Orden de servicio'],
  ['FACTURA', 'Factura'],
  ['OTRO', 'Otro documento'],
] as const

export function SubirDocumentoCompra({ ordenCompraId, solicitudId }: {
  ordenCompraId: string
  solicitudId: string
}) {
  const [id, setId] = useState(solicitudId)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(registrarDocumentoCompra, (r) => {
    setMensaje(r.mensaje ?? 'Documento adjuntado.')
    setId(crypto.randomUUID())
  })
  return <form onSubmit={alEnviar} className="grid gap-2 rounded-md border border-borde bg-superficie p-3 sm:grid-cols-[1fr_1.3fr_auto] sm:items-end">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
    <Campo etiqueta="Tipo de documento" htmlFor={`tipo-doc-compra-${ordenCompraId}`}>
      <Seleccion id={`tipo-doc-compra-${ordenCompraId}`} name="tipo" required disabled={enviando} defaultValue="">
        <option value="" disabled>Elige el tipo</option>
        {TIPOS.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="PDF para Tesorería" htmlFor={`archivo-compra-${ordenCompraId}`} ayuda="Hasta 20 MB. Cada documento queda registrado en la compra.">
      <Entrada id={`archivo-compra-${ordenCompraId}`} name="archivo" type="file" accept="application/pdf,.pdf" required disabled={enviando} />
    </Campo>
    <Boton type="submit" variante="secundario" tamano="sm" cargando={enviando}>
      <FileUp aria-hidden className="size-4" />Adjuntar
    </Boton>
    {error && <p role="alert" className="text-xs text-peligro sm:col-span-3">{error}</p>}
    {mensaje && <p role="status" className="text-xs text-exito sm:col-span-3">{mensaje}</p>}
  </form>
}

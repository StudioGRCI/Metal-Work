'use client'

import { FileUp } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { registrarDocumentoCompra } from './acciones-documentos'
import { subirArchivoPrivado } from '@/lib/subida-privada'

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
  const { alEnviar, enviando, error } = useEnvio(async (_previo, datos) => {
    setMensaje(null)
    const archivo = datos.get('archivo')
    if (!(archivo instanceof File) || archivo.size < 1 || archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
      return { ok: false, error: 'Selecciona un PDF válido de hasta 20 MB.' }
    }
    datos.delete('archivo')
    datos.set('nombre_archivo', archivo.name.trim().slice(0, 200))
    return subirArchivoPrivado({
      bucket: 'documentos-compras', ruta: `compra/${ordenCompraId}/${id}.pdf`,
      archivo, contentType: 'application/pdf', registrar: () => registrarDocumentoCompra(null, datos),
    })
  }, (r) => {
    setMensaje(r.mensaje ?? 'Documento adjuntado.')
    setId(crypto.randomUUID())
  })
  return <form key={id} onSubmit={alEnviar} className="grid min-w-0 gap-4 rounded-xl border border-borde bg-superficie p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
    <Campo etiqueta="Tipo de documento" htmlFor={`tipo-doc-compra-${ordenCompraId}`}>
      <Seleccion id={`tipo-doc-compra-${ordenCompraId}`} name="tipo" required disabled={enviando} defaultValue="">
        <option value="" disabled>Elige el tipo</option>
        {TIPOS.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Documento PDF" htmlFor={`archivo-compra-${ordenCompraId}`} ayuda="Hasta 20 MB. Se conserva en la compra y queda disponible para Contabilidad y Tesorería.">
      <Entrada id={`archivo-compra-${ordenCompraId}`} name="archivo" type="file" accept="application/pdf,.pdf" required disabled={enviando} />
    </Campo>
    <Boton type="submit" variante="secundario" tamano="sm" cargando={enviando}>
      <FileUp aria-hidden className="size-4" />Adjuntar
    </Boton>
    {error && <p role="alert" className="text-xs text-peligro sm:col-span-3">{error}</p>}
    {mensaje && <p role="status" className="text-xs text-exito sm:col-span-3">{mensaje}</p>}
  </form>
}

'use client'

import { FileUp } from 'lucide-react'
import { useState } from 'react'

import {
  AvisoFacturaDeLaOrden,
  CamposDeLaFactura,
  faltaEnLaFactura,
  useDatosDeFactura,
  useDetectorDeFactura,
} from '@/app/(app)/compras/ordenes/detector-oc'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { registrarDocumentoCompra } from './acciones-documentos'
import { subirArchivoPrivado } from '@/lib/subida-privada'

const TIPOS = [
  // La cotización o proforma del proveedor; antes se subía como «Orden de compra» u «Otro».
  ['COTIZACION', 'Cotización del proveedor'],
  ['ORDEN_COMPRA', 'Orden de compra'],
  ['ORDEN_PAGO', 'Orden de pago'],
  ['ORDEN_SERVICIO', 'Orden de servicio'],
  ['FACTURA', 'Factura'],
  // Sin factura igual se pide un comprobante: boleta, nota de venta o recibo.
  ['COMPROBANTE', 'Boleta, nota de venta o recibo'],
  ['OTRO', 'Otro documento'],
] as const

export function SubirDocumentoCompra({ ordenCompraId, solicitudId, tipoInicial, orden }: {
  ordenCompraId: string
  solicitudId: string
  /** El que pide la compra: FACTURA, o COMPROBANTE si es sin factura. */
  tipoInicial?: 'FACTURA' | 'COMPROBANTE'
  /** El número, el total con IGV y la moneda de la orden: el detector compara la factura con ellos. */
  orden?: { numero: string; total: number; moneda: string }
}) {
  const [id, setId] = useState(solicitudId)
  const [tipo, setTipo] = useState<string>(tipoInicial ?? '')
  const detector = useDetectorDeFactura()
  const factura = useDatosDeFactura()
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(async (_previo, datos) => {
    setMensaje(null)
    const archivo = datos.get('archivo')
    if (!(archivo instanceof File) || archivo.size < 1 || archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
      return { ok: false, error: 'Selecciona un PDF válido de hasta 20 MB.' }
    }
    // El número y la fecha se revisan antes de subir el PDF, no después.
    const falta = tipo === 'FACTURA' ? faltaEnLaFactura(factura.numero, factura.fecha) : null
    if (falta) return { ok: false, error: falta }
    datos.delete('archivo')
    datos.set('nombre_archivo', archivo.name.trim().slice(0, 200))
    return subirArchivoPrivado({
      bucket: 'documentos-compras', ruta: `compra/${ordenCompraId}/${id}.pdf`,
      archivo, contentType: 'application/pdf', registrar: () => registrarDocumentoCompra(null, datos),
    })
  }, (r) => {
    setMensaje(r.mensaje ?? 'Documento adjuntado.')
    setId(crypto.randomUUID())
    factura.vaciar()
    void detector.leer(undefined)
  })
  return <form key={id} onSubmit={alEnviar} className="grid min-w-0 gap-4 rounded-xl border border-borde bg-superficie p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
    <Campo etiqueta="Tipo de documento" htmlFor={`tipo-doc-compra-${ordenCompraId}`}>
      <Seleccion id={`tipo-doc-compra-${ordenCompraId}`} name="tipo" required disabled={enviando} value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="" disabled>Elige el tipo</option>
        {TIPOS.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
      </Seleccion>
    </Campo>
    <Campo etiqueta="Documento PDF" htmlFor={`archivo-compra-${ordenCompraId}`} ayuda="Hasta 20 MB. Se conserva en la compra y queda disponible para Contabilidad y Tesorería.">
      <Entrada id={`archivo-compra-${ordenCompraId}`} name="archivo" type="file" accept="application/pdf,.pdf" required disabled={enviando}
        onChange={(e) => void detector.leer(e.target.files?.[0]).then(factura.completar)} />
    </Campo>
    <Boton type="submit" variante="secundario" tamano="sm" cargando={enviando}>
      <FileUp aria-hidden className="size-4" />Adjuntar
    </Boton>
    {tipo === 'FACTURA' && (
      <>
        <div className="grid gap-4 sm:col-span-3 sm:grid-cols-2">
          <CamposDeLaFactura id={`factura-compra-${ordenCompraId}`} datos={factura} requerido disabled={enviando} />
        </div>
        <div className="sm:col-span-3">
          <AvisoFacturaDeLaOrden lectura={detector.lectura} leyendo={detector.leyendo} total={orden?.total ?? null}
            moneda={orden?.moneda ?? 'PEN'} numero={orden?.numero} parcialPosible />
        </div>
      </>
    )}
    {error && <p role="alert" className="text-xs text-peligro sm:col-span-3">{error}</p>}
    {mensaje && <p role="status" className="text-xs text-exito sm:col-span-3">{mensaje}</p>}
  </form>
}

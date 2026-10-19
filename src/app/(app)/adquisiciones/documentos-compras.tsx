import { FileText, FolderOpen, ReceiptText } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { FacturaDeLogistica } from '@/lib/datos/adquisiciones'
import type { DocumentoCompraTesoreria } from '@/lib/datos/tesoreria'
import { fecha } from '@/lib/format'

const TIPO_DOCUMENTO: Record<string, string> = {
  ORDEN_COMPRA: 'Orden de compra',
  ORDEN_PAGO: 'Orden de pago',
  ORDEN_SERVICIO: 'Orden de servicio',
  FACTURA: 'Factura',
  COMPROBANTE: 'Boleta, nota de venta o recibo',
  OTRO: 'Otro documento',
}

const AREA: Record<string, string> = { MTZ: 'Maestranza', PRD: 'Producción', ACB: 'Acabados' }

/**
 * Los PDF que Logística adjuntó a cada compra: órdenes de compra, de pago, de
 * servicio y facturas. Antes estaban en la portada de Tesorería; desde el
 * 2026-10-14 van en Adquisiciones, donde Tesorería ve todo lo comprado. Cada
 * factura dice su número, su fecha y si Contabilidad ya la registró.
 */
export function DocumentosDeCompras({
  documentos,
  facturas,
}: {
  documentos: DocumentoCompraTesoreria[]
  /** Las facturas anexadas, por su id: su número, su fecha y si ya se registraron. */
  facturas: Map<string, FacturaDeLogistica>
}) {
  return (
    <Tarjeta className="mt-5">
      <TarjetaCabecera titulo="Documentos de compras de Logística" ayuda="Los PDF de órdenes de compra, de pago, de servicio y las facturas que Logística adjuntó a cada compra." />
      <TarjetaCuerpo className="space-y-2">
        {documentos.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="rounded-full bg-acento-suave p-3 text-acento">
              <FolderOpen aria-hidden className="size-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-texto">Todavía no hay documentos de compras</p>
            <p className="mt-1 max-w-lg text-sm text-texto-suave">
              Logística los adjunta desde la atención de materiales. Cada archivo conserva proveedor, referencia, OT y área.
            </p>
          </div>
        ) : (
          documentos.map((documento) => {
            const factura = documento.id ? facturas.get(documento.id) : undefined
            return (
            <article
              key={documento.id}
              className="flex flex-col gap-2 rounded-[var(--radius-base)] border border-borde p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ReceiptText aria-hidden className="size-4 shrink-0 text-acento" />
                  <p className="font-medium text-texto">
                    {TIPO_DOCUMENTO[documento.tipo ?? ''] ?? 'Documento de compra'}
                    {factura?.numero && <span className="tabular"> {factura.numero}</span>}
                    {factura?.fecha && <span className="font-normal text-texto-suave"> del {fecha(factura.fecha)}</span>}
                  </p>
                  {factura && (
                    <Insignia tono={factura.registrada ? 'exito' : 'aviso'}>
                      {factura.registrada ? 'Registrada por Contabilidad' : 'Falta registrarla'}
                    </Insignia>
                  )}
                  {documento.ordenes.length > 0 ? (
                    documento.ordenes.map((o) => (
                      <Insignia key={`${o.orden_id}-${o.area_destino}`} tono="neutro">
                        OT {o.numero_ot} · {AREA[o.area_destino] ?? o.area_destino}
                      </Insignia>
                    ))
                  ) : (
                    <Insignia tono="neutro">{documento.numero_ot ? `OT ${documento.numero_ot}` : 'Compra para almacén'}</Insignia>
                  )}
                </div>
                <p className="mt-1 break-words text-sm text-texto-suave">{documento.nombre_archivo}</p>
                <p className="mt-1 text-xs text-texto-tenue">
                  {documento.proveedor} · {documento.referencia} · {AREA[documento.area_destino ?? ''] ?? documento.area_destino ?? 'Área'} ·{' '}
                  {fecha(documento.creado_en)}
                </p>
              </div>
              {documento.url ? (
                <a
                  href={documento.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-acento hover:underline"
                >
                  <FileText aria-hidden className="size-4" />
                  Abrir PDF
                </a>
              ) : (
                <p role="alert" className="text-sm text-aviso">
                  Archivo no disponible. Recarga o avisa a Logística.
                </p>
              )}
            </article>
            )
          })
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

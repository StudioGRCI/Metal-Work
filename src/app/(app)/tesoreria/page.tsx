import { FileText, FolderOpen, MessageSquareText, ReceiptText } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { documentosDeCompraParaTesoreria } from '@/lib/datos/tesoreria'
import { listarCotizacionesPdf } from '@/lib/datos/cotizaciones-pdf'
import { fecha as fmtFecha } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { ObservacionCotizacion } from './observacion-cotizacion'

export const metadata = { title: 'Tesorería' }

const TIPO_DOCUMENTO: Record<string, string> = {
  ORDEN_COMPRA: 'Orden de compra',
  ORDEN_PAGO: 'Orden de pago',
  ORDEN_SERVICIO: 'Orden de servicio',
  FACTURA: 'Factura',
  OTRO: 'Otro documento',
}

const AREA: Record<string, string> = { MTZ: 'Maestranza', PRD: 'Producción', ACB: 'Acabados' }

export default async function PaginaTesoreria() {
  await exigirPermiso('tesoreria.ver_documentos')
  const [cotizaciones, documentos] = await Promise.all([
    listarCotizacionesPdf(),
    documentosDeCompraParaTesoreria(),
  ])
  const aceptadas = cotizaciones.filter((c) => c.estado === 'APROBADA' && c.liberacionTesoreria)

  return <>
    <EncabezadoPagina
      titulo="Tesorería"
      descripcion="Revisa las cotizaciones que Administración liberó y consulta los comprobantes adjuntados por Logística."
    />

    <Tarjeta className="mb-5">
      <TarjetaCabecera titulo="Cotizaciones liberadas" descripcion="Solo aparecen las aprobadas por Gerencia y enviadas aquí por Administración." />
      <TarjetaCuerpo className="space-y-3">
        {aceptadas.length === 0 ? (
          <EstadoVacio
            icono={FileText}
            titulo="No hay cotizaciones liberadas"
            descripcion="Cuando Administración libere una cotización aprobada, aparecerá aquí para revisión financiera."
          />
        ) : aceptadas.map((cotizacion) => (
          <article key={cotizacion.id} className="rounded-[var(--radius-base)] border border-borde p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-texto">{cotizacion.numero}</h2>
                  <Insignia tono="exito">Aprobada</Insignia>
                  <Insignia tono="info">En Tesorería</Insignia>
                </div>
                <p className="mt-1 text-sm text-texto-suave">
                  {cotizacion.cliente ?? 'Cliente'}{cotizacion.carroceria ? ` · ${cotizacion.carroceria}` : ''}
                </p>
                <p className="mt-1 text-xs text-texto-tenue">
                  Liberada {cotizacion.liberacionTesoreria ? fmtFecha(cotizacion.liberacionTesoreria.liberado_en) : ''}
                </p>
              </div>
              {cotizacion.url ? (
                <a href={cotizacion.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-acento hover:underline">
                  <FileText aria-hidden className="size-4" />Abrir cotización
                </a>
              ) : (
                <p role="alert" className="text-sm text-aviso">No se pudo preparar el enlace temporal al archivo. Recarga para volver a intentar.</p>
              )}
            </div>
            {cotizacion.observacionesTesoreria.length > 0 && (
              <ol className="mt-4 space-y-2 border-t border-borde pt-3">
                {cotizacion.observacionesTesoreria.map((observacion) => (
                  <li key={observacion.id} className="flex gap-2 rounded-[var(--radius-base)] bg-aviso-suave p-3 text-sm">
                    <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0 text-aviso" />
                    <div><p className="whitespace-pre-wrap text-texto">{observacion.observacion}</p><p className="mt-1 text-xs text-texto-suave">{fmtFecha(observacion.creado_en)}</p></div>
                  </li>
                ))}
              </ol>
            )}
            {cotizacion.id && <ObservacionCotizacion cotizacionId={cotizacion.id} />}
          </article>
        ))}
      </TarjetaCuerpo>
    </Tarjeta>

    <Tarjeta>
      <TarjetaCabecera titulo="Documentos de compras" descripcion="PDF de órdenes de compra, pago, servicio y facturas que Logística adjuntó." />
      <TarjetaCuerpo className="space-y-2">
        {documentos.length === 0 ? (
          <EstadoVacio
            icono={FolderOpen}
            titulo="Todavía no hay comprobantes de compra"
            descripcion="Logística puede adjuntar los PDF desde la atención de materiales. Cada archivo conservará proveedor, referencia, OT y área."
          />
        ) : documentos.map((documento) => (
          <article key={documento.id} className="flex flex-col gap-2 rounded-[var(--radius-base)] border border-borde p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ReceiptText aria-hidden className="size-4 shrink-0 text-acento" />
                <p className="font-medium text-texto">{TIPO_DOCUMENTO[documento.tipo ?? ''] ?? 'Documento de compra'}</p>
                <Insignia tono="neutro">OT {documento.numero_ot ?? '—'}</Insignia>
              </div>
              <p className="mt-1 break-words text-sm text-texto-suave">{documento.nombre_archivo}</p>
              <p className="mt-1 text-xs text-texto-tenue">
                {documento.proveedor} · {documento.referencia} · {AREA[documento.area_destino ?? ''] ?? documento.area_destino ?? 'Área'} · {fmtFecha(documento.creado_en)}
              </p>
            </div>
            {documento.url ? (
              <a href={documento.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-acento hover:underline">
                <FileText aria-hidden className="size-4" />Abrir PDF
              </a>
            ) : (
              <p role="alert" className="text-sm text-aviso">Archivo no disponible. Recarga o informa a Logística.</p>
            )}
          </article>
        ))}
      </TarjetaCuerpo>
    </Tarjeta>
  </>
}

function EstadoVacio({ icono: Icono, titulo, descripcion }: {
  icono: typeof FileText
  titulo: string
  descripcion: string
}) {
  return <div className="flex flex-col items-center py-8 text-center">
    <span className="rounded-full bg-acento-suave p-3 text-acento"><Icono aria-hidden className="size-5" /></span>
    <p className="mt-3 text-sm font-semibold text-texto">{titulo}</p>
    <p className="mt-1 max-w-lg text-sm text-texto-suave">{descripcion}</p>
  </div>
}

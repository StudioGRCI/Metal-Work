import { Download, FileText, ReceiptText } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { bandejaDeFacturacion, type CotizacionPorFacturar } from '@/lib/datos/facturacion'
import { ESTADO_FACTURA_VENTA } from '@/lib/dominio/finanzas'
import { fecha, hoyLima, moneda, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnexarFactura, AnularFactura, EnviarFactura } from './acciones-factura'

export const metadata = { title: 'Facturación' }

const codigo = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

/** En qué va la cotización para Contabilidad, por sus facturas vigentes. */
function estadoDe(c: CotizacionPorFacturar): { etiqueta: string; tono: 'aviso' | 'exito' | 'acento' } {
  const vigentes = c.facturas.filter((f) => f.estado !== 'ANULADA')
  if (vigentes.length === 0) return { etiqueta: 'Por facturar', tono: 'aviso' }
  if (vigentes.some((f) => f.estado === 'ANEXADA')) return { etiqueta: 'Factura por enviar', tono: 'acento' }
  return { etiqueta: 'En Tesorería', tono: 'exito' }
}

/**
 * La OT pasa por Contabilidad (migración 20261015120000): cada cotización que
 * Administración envió con su OT llega aquí con el cliente, su RUC y su
 * dirección fiscal. Contabilidad emite la factura en SUNAT, la anexa con su PDF
 * y la envía a Tesorería, donde entra a las cuentas por cobrar.
 */
export default async function PaginaFacturacion() {
  const perfil = await exigirPermiso('contabilidad.facturar')
  const factura = puede(perfil, 'contabilidad.facturar')
  const cotizaciones = await bandejaDeFacturacion()
  const hoy = hoyLima()

  return (
    <>
      <EncabezadoPagina
        titulo="Facturación"
        descripcion="Las cotizaciones que Administración te envió con su OT: anexa la factura que emitiste en SUNAT y envíala a Tesorería para que la cobre."
      />

      {cotizaciones.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-col items-center py-8 text-center">
            <span className="rounded-full bg-acento-suave p-3 text-acento">
              <ReceiptText aria-hidden className="size-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-texto">Todavía no hay cotizaciones por facturar</p>
            <p className="mt-1 max-w-lg text-sm text-texto-suave">
              Administración te las envía desde Cotización, cuando ya emitió la OT. Te llega un aviso con cada una.
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {cotizaciones.map((c) => {
            const estado = estadoDe(c)
            const vigentes = c.facturas.filter((f) => f.estado !== 'ANULADA')
            const facturado = vigentes.filter((f) => f.moneda === c.moneda).reduce((n, f) => n + Number(f.total), 0)
            return (
              // Con `id`: el aviso de la campana aterriza en esta cotización (`#id`).
              <li key={c.envio_id} id={c.cotizacion_id ?? undefined} className="scroll-mt-20 target:[&>div]:border-acento">
                <Tarjeta>
                  <TarjetaCuerpo className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div>
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-texto">Cotización {c.numero}</span>
                          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                        </p>
                        <p className="mt-0.5 text-sm text-texto">
                          {c.cliente ?? 'Cliente sin registrar'}
                          {c.carroceria && <span className="text-texto-suave"> · {c.carroceria}</span>}
                        </p>
                        <p className="text-xs text-texto-suave">
                          {c.cliente_documento ?? 'Sin documento'}
                          {c.cliente_direccion ? ` · ${c.cliente_direccion}` : ' · Sin dirección fiscal: pídela a Administración'}
                        </p>
                      </div>
                      <p className="text-xs text-texto-tenue">
                        Enviada por {c.enviado_por ?? 'Administración'} el {fecha(c.enviado_en)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {c.orden_id && (
                        <Link href={`/ordenes/${c.orden_id}`} className="font-medium text-acento hover:underline">
                          OT {c.orden_numero}
                        </Link>
                      )}
                      <span className="font-semibold tabular text-texto">
                        {c.monto_venta !== null ? `Total de venta: ${moneda(c.monto_venta, codigo(c.moneda))}` : 'Total de venta sin registrar'}
                      </span>
                      {vigentes.length > 0 && c.monto_venta !== null && (
                        <span className="tabular text-texto-suave">Facturado: {moneda(facturado, codigo(c.moneda))}</span>
                      )}
                      {c.url ? (
                        <a
                          href={c.url}
                          target={c.archivo_mime === 'application/pdf' ? '_blank' : undefined}
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-1.5 text-acento hover:underline sm:min-h-0"
                        >
                          {c.archivo_mime === 'application/pdf' ? <FileText aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
                          {c.archivo_mime === 'application/pdf' ? 'Abrir la cotización' : 'Bajar la cotización'}
                        </a>
                      ) : (
                        <span role="alert" className="text-aviso">No se pudo abrir la cotización. Recarga la página.</span>
                      )}
                    </div>

                    {c.facturas.length > 0 && (
                      <ol className="space-y-2 border-t border-borde pt-3">
                        {c.facturas.map((f) => {
                          const e = ESTADO_FACTURA_VENTA[f.estado] ?? { etiqueta: f.estado, tono: 'neutro' as const }
                          return (
                            <li
                              key={f.id}
                              className="flex flex-col gap-2 rounded-[var(--radius-base)] border border-borde p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className={`font-medium tabular ${f.estado === 'ANULADA' ? 'text-texto-suave line-through' : 'text-texto'}`}>
                                    Factura {f.numero}
                                  </span>
                                  <Insignia tono={e.tono}>{e.etiqueta}</Insignia>
                                  {f.concepto && <span className="text-texto-suave">{f.concepto}</span>}
                                </p>
                                <p className="mt-0.5 text-xs text-texto-suave">
                                  <span className="tabular font-medium text-texto">{moneda(f.total, codigo(f.moneda))}</span> · emitida el{' '}
                                  {fecha(f.fecha_emision)} · vence el {fecha(f.fecha_vencimiento)}
                                  {f.enviada_en && ` · en Tesorería desde el ${fecha(f.enviada_en)}`}
                                </p>
                                {f.estado === 'ANULADA' && f.motivo_anulacion && (
                                  <p className="mt-0.5 text-xs text-peligro">
                                    Anulada el {fecha(f.anulada_en)}: {f.motivo_anulacion}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {f.url && (
                                  <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0">
                                    <FileText aria-hidden className="size-4" />
                                    Abrir PDF
                                  </a>
                                )}
                                {factura && f.estado === 'ANEXADA' && <EnviarFactura facturaId={f.id} numero={f.numero} />}
                                {factura && f.estado !== 'ANULADA' && (
                                  <AnularFactura facturaId={f.id} numero={f.numero} enTesoreria={f.estado === 'ENVIADA'} />
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ol>
                    )}

                    {factura && c.cotizacion_id && (
                      <AnexarFactura
                        cotizacionId={c.cotizacion_id}
                        numeroCotizacion={c.numero ?? ''}
                        hoy={hoy}
                        monedaCotizacion={codigo(c.moneda)}
                        totalCotizacion={c.monto_venta}
                      />
                    )}
                  </TarjetaCuerpo>
                </Tarjeta>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

import { Download, FileText, Hourglass, ReceiptText } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { FacturaDeVenta } from '@/components/finanzas/factura-de-venta'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { bandejaDeFacturacion, type CotizacionParaFacturar } from '@/lib/datos/facturacion'
import { totalConIgv } from '@/lib/dominio/finanzas'
import { fecha, hoyLima, moneda, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularFactura, RegistrarFactura } from './acciones-factura'

export const metadata = { title: 'Facturación' }

const codigo = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

/** En qué va la cotización para Contabilidad, por su código y sus facturas vigentes. */
function estadoDe(c: CotizacionParaFacturar): { etiqueta: string; tono: 'aviso' | 'exito' | 'neutro' } {
  if (!c.codigo_interno) return { etiqueta: 'Sin código interno', tono: 'neutro' }
  if (!c.facturas.some((f) => !f.anulada_en)) return { etiqueta: 'Por facturar', tono: 'aviso' }
  return { etiqueta: 'Facturada', tono: 'exito' }
}

/**
 * La factura de venta cuelga del código interno (migración 20261015124000):
 * cada cotización que Gerencia aprobó llega aquí con el cliente, su RUC y su
 * dirección fiscal; cuando Administración carga la OT con el código interno de
 * la unidad, Contabilidad registra la factura que emitió en SUNAT, con su PDF,
 * y la factura entra sola a las cuentas por cobrar de Tesorería.
 */
export default async function PaginaFacturacion() {
  const perfil = await exigirPermiso(['contabilidad.facturar', 'cotizaciones.ver_aprobadas'])
  const factura = puede(perfil, 'contabilidad.facturar')
  const cotizaciones = await bandejaDeFacturacion()
  const hoy = hoyLima()
  const porFacturar = cotizaciones.filter((c) => estadoDe(c).etiqueta === 'Por facturar').length

  return (
    <>
      <EncabezadoPagina
        titulo="Facturación"
        ayuda="Las cotizaciones aprobadas, por código interno: registra la factura que emitiste en SUNAT y Tesorería la tiene por cobrar."
      />

      {porFacturar > 0 && (
        <p className="mb-4 text-sm text-texto-suave">
          {porFacturar} {porFacturar === 1 ? 'cotización espera' : 'cotizaciones esperan'} su factura.
        </p>
      )}

      {cotizaciones.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-col items-center py-8 text-center">
            <span className="rounded-full bg-acento-suave p-3 text-acento">
              <ReceiptText aria-hidden className="size-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-texto">Todavía no hay cotizaciones aprobadas</p>
            <p className="mt-1 max-w-lg text-sm text-texto-suave">
              Cuando Gerencia apruebe una y Administración cargue su OT con el código interno, aparece aquí para facturarla.
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {cotizaciones.map((c) => {
            const estado = estadoDe(c)
            const m = codigo(c.moneda)
            const total = totalConIgv(c.monto_venta === null ? null : Number(c.monto_venta), c.incluye_igv)
            const facturado = c.facturas.filter((f) => !f.anulada_en && f.moneda === c.moneda).reduce((n, f) => n + Number(f.total), 0)
            return (
              // Con `id`: el aviso de la campana aterriza en esta cotización (`#id`).
              <li key={c.cotizacion_id} id={c.cotizacion_id ?? undefined} className="scroll-mt-20" data-cotizacion={c.numero ?? undefined}>
                <Tarjeta>
                  <TarjetaCuerpo className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div>
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-texto">
                            {c.codigo_interno ? `Código ${c.codigo_interno}` : 'Sin código interno'}
                          </span>
                          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                        </p>
                        <p className="mt-0.5 text-sm text-texto">
                          {c.cliente ?? 'Cliente sin registrar'}
                          <span className="text-texto-suave">
                            {' '}
                            · cotización {c.numero}
                            {c.carroceria && ` · ${c.carroceria}`}
                          </span>
                        </p>
                        <p className="text-xs text-texto-suave">
                          {c.cliente_documento ?? 'Sin documento'}
                          {c.cliente_direccion ? ` · ${c.cliente_direccion}` : ' · Sin dirección fiscal: pídela a Administración'}
                        </p>
                      </div>
                      {c.aprobada_en && <p className="text-xs text-texto-tenue">Aprobada el {fecha(c.aprobada_en)}</p>}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-semibold tabular text-texto">
                        {total === null
                          ? 'Total de venta sin registrar'
                          : `Total de venta: ${moneda(total, m)}${c.incluye_igv === null ? ' (falta confirmar si incluye IGV)' : ' con IGV'}`}
                      </span>
                      {facturado > 0 && <span className="tabular text-texto-suave">Facturado: {moneda(facturado, m)}</span>}
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

                    {c.en_correccion && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>Ventas está corrigiendo esta cotización y Gerencia todavía no aprueba la versión nueva: se factura cuando la apruebe, porque el total puede cambiar.</span>
                      </p>
                    )}

                    {!c.codigo_interno && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-neutro-suave px-2.5 py-1.5 text-xs text-texto-suave">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>Falta que Administración cargue la OT con el código interno de la unidad: la factura se registra en ese código.</span>
                      </p>
                    )}

                    {c.facturas.length > 0 && (
                      <div className="space-y-2 border-t border-borde pt-3">
                        {c.facturas.map((f) => (
                          <FacturaDeVenta
                            key={f.id}
                            factura={f}
                            acciones={
                              factura && !f.anulada_en && !f.cobros.some((b) => !b.anulado_en) && f.id && f.numero ? (
                                <AnularFactura facturaId={f.id} numero={f.numero} />
                              ) : null
                            }
                          />
                        ))}
                      </div>
                    )}

                    {/* La base no deja facturar mientras la corrección espera a Gerencia (migración 20261026140000). */}
                    {factura && c.cotizacion_id && c.codigo_interno && !c.en_correccion && (
                      <RegistrarFactura
                        cotizacionId={c.cotizacion_id}
                        numeroCotizacion={c.numero ?? ''}
                        codigoInterno={c.codigo_interno}
                        hoy={hoy}
                        monedaCotizacion={m}
                        totalCotizacion={total}
                        facturado={facturado}
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

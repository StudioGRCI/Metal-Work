import { Download, FileText, HandCoins } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { FacturaDeVenta } from '@/components/finanzas/factura-de-venta'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { cajaDeLosPagos, cuentasParaPagar } from '@/lib/datos/caja'
import { solicitudesPendientesTesoreria } from '@/lib/datos/costos-ot'
import { COBRADAS_A_LA_VISTA, cotizacionesAprobadas, facturasDeVenta } from '@/lib/datos/facturacion'
import { revisionesDeSalidaPendientes } from '@/lib/datos/vehiculos'
import { resumenPorMoneda, totalConIgv } from '@/lib/dominio/finanzas'
import { hoyLima, moneda, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularCobro, CobrarFactura } from '../formularios'
import { RevisionesDeSalida } from '../revisiones-de-salida'
import { SolicitudesOT } from '../solicitudes-ot'

export const metadata = { title: 'Cuentas por cobrar' }

const codigo = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

/**
 * Las facturas de venta que registró Contabilidad (migración 20261015124000):
 * cada una colgada del código interno y de su cotización, con el PDF. Tesorería
 * registra cada cobro con su voucher hasta cancelarla. Debajo, las cotizaciones
 * aprobadas, para saber qué viene por cobrar. Arriba, las salidas de vehículos
 * que Requerimientos pide revisar antes de entregarlos (migración 20261016110000).
 */
export default async function PaginaPorCobrar() {
  const perfil = await exigirPermiso('tesoreria.ver_documentos')
  // Paga quien lleva la caja: el pago sale de una de sus cuentas (la base pide los dos permisos).
  const cobra = puede(perfil, 'tesoreria.registrar_cobros') && puede(perfil, 'tesoreria.caja')
  const responde = puede(perfil, 'tesoreria.liberar')
  const [facturas, cotizaciones, solicitudes, salidas, cuentasCaja] = await Promise.all([
    facturasDeVenta(),
    cotizacionesAprobadas(),
    responde ? solicitudesPendientesTesoreria() : Promise.resolve([]),
    responde ? revisionesDeSalidaPendientes() : Promise.resolve([]),
    // La cuenta a la que entra cada cobro: la caja diaria se mueve sola (20261019100000).
    cobra ? cuentasParaPagar() : Promise.resolve([]),
  ])
  // Para quien lleva la caja, a qué cuenta entró cada cobro.
  const cajas = puede(perfil, 'tesoreria.caja')
    ? await cajaDeLosPagos('COBRO_FACTURA_VENTA', facturas.flatMap((f) => f.cobros.map((b) => b.id)))
    : undefined
  const hoy = hoyLima()
  const pendientes = facturas.filter((f) => !f.cancelada && Number(f.saldo) > 0)
  const cobradas = facturas.filter((f) => !pendientes.includes(f))
  const vencidas = pendientes.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento < hoy).length
  const resumen = resumenPorMoneda(pendientes.map((f) => ({ moneda: f.moneda, monto: Number(f.saldo) })), ['factura', 'facturas'])

  return (
    <AvisoDeLaCaja>
      <EncabezadoPagina
        titulo="Cuentas por cobrar"
        descripcion={resumen && `Por cobrar: ${resumen}${vencidas > 0 ? ` · ${vencidas === 1 ? 'una vencida' : `${vencidas} vencidas`}` : ''}.`}
        ayuda="Las facturas que registró Contabilidad, por código interno, de la que vence antes a la que vence después. Registra cada cobro con su voucher."
      />

      {salidas.length > 0 && <RevisionesDeSalida revisiones={salidas} />}
      {solicitudes.length > 0 && <SolicitudesOT solicitudes={solicitudes} />}

      <Tarjeta>
        <TarjetaCabecera titulo="Por cobrar" ayuda="Cada factura con su saldo; lo vencido sale en rojo." />
        <TarjetaCuerpo className="space-y-3">
          {pendientes.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="rounded-full bg-acento-suave p-3 text-acento">
                <HandCoins aria-hidden className="size-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-texto">No hay facturas por cobrar</p>
              <p className="mt-1 max-w-lg text-sm text-texto-suave">
                Llegan solas cuando Contabilidad registra la factura de una cotización aprobada. Te llega un aviso con cada una.
              </p>
            </div>
          ) : (
            pendientes.map((f) => (
              <FacturaDeVenta
                key={f.id}
                factura={f}
                conCotizacion
                acciones={
                  cobra && f.id && f.numero ? (
                    <CobrarFactura
                      facturaId={f.id}
                      numero={f.numero}
                      cliente={f.cliente ?? 'Cliente sin registrar'}
                      hoy={hoy}
                      saldo={Number(f.saldo)}
                      codigoMoneda={codigo(f.moneda)}
                      cuentas={cuentasCaja}
                    />
                  ) : null
                }
                accionCobro={cobra ? (b) => <AnularCobro cobroId={b.id} /> : undefined}
                cajas={cajas}
              />
            ))
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {cobradas.length > 0 && (
        <SeccionDesplegable
          titulo={cobradas.length >= COBRADAS_A_LA_VISTA ? `Las últimas ${COBRADAS_A_LA_VISTA} cobradas` : `Cobradas (${cobradas.length})`}
          className="mt-5"
        >
          <div className="space-y-3">
            {cobradas.map((f) => (
              <FacturaDeVenta
                key={f.id}
                factura={f}
                conCotizacion
                accionCobro={cobra ? (b) => <AnularCobro cobroId={b.id} /> : undefined}
                cajas={cajas}
              />
            ))}
          </div>
        </SeccionDesplegable>
      )}

      {/* Para saber qué viene por cobrar; sin ninguna, no ocupa la pantalla. */}
      {cotizaciones.length > 0 && (
        <Tarjeta className="mt-5">
          <TarjetaCabecera
            titulo="Cotizaciones aprobadas"
            ayuda="Lo que Gerencia aprobó, por código interno, con lo que Contabilidad ya facturó y lo cobrado."
          />
          <TarjetaCuerpo className="space-y-2">
            {cotizaciones.map((c) => {
              const m = codigo(c.moneda)
              const total = totalConIgv(c.monto_venta === null ? null : Number(c.monto_venta), c.incluye_igv)
              return (
                <div
                  key={c.cotizacion_id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[var(--radius-base)] border border-borde p-3 text-sm"
                  data-cotizacion={c.numero ?? undefined}
                >
                  <span>
                    <span className="font-medium text-texto">{c.codigo_interno ? `Código ${c.codigo_interno}` : 'Sin código interno'}</span>
                    <span className="text-texto-suave">
                      {' '}
                      · {c.cliente ?? 'Cliente sin registrar'} · cotización {c.numero}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-texto-suave">
                      {Number(c.facturas) === 0 ? (
                        <Insignia tono="neutro">{c.codigo_interno ? 'Contabilidad aún no la factura' : 'Falta cargar la OT'}</Insignia>
                      ) : (
                        <span className="tabular">
                          Facturado {moneda(c.facturado, m)} · cobrado {moneda(c.cobrado, m)}
                        </span>
                      )}
                      {c.url && (
                        <a
                          href={c.url}
                          target={c.archivo_mime === 'application/pdf' ? '_blank' : undefined}
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0"
                        >
                          {c.archivo_mime === 'application/pdf' ? <FileText aria-hidden className="size-3.5" /> : <Download aria-hidden className="size-3.5" />}
                          {c.archivo_mime === 'application/pdf' ? 'Abrir la cotización' : 'Bajar la cotización'}
                        </a>
                      )}
                    </span>
                  </span>
                  <strong className="tabular">{total === null ? <span className="font-normal text-texto-suave">Sin total</span> : moneda(total, m)}</strong>
                </div>
              )
            })}
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </AvisoDeLaCaja>
  )
}

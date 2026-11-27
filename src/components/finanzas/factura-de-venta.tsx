import { FileText, Paperclip } from 'lucide-react'
import type { ReactNode } from 'react'

import { CajaDeLaLinea } from '@/components/finanzas/caja-del-pago'
import { Insignia } from '@/components/ui/etiqueta-estado'
import type { CajaDelPago } from '@/lib/datos/caja'
import type { CobroFactura, FacturaVenta } from '@/lib/datos/facturacion'
import { estadoFacturaVenta } from '@/lib/dominio/finanzas'
import { diasDelVencimiento } from '@/lib/dominio/vencimiento'
import { diasHasta, fecha, moneda, parteDe, porcentaje, type CodigoMoneda } from '@/lib/format'

const codigo = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

/**
 * Una factura de venta con sus cobros y sus vouchers, como la ven Contabilidad
 * (Facturación) y Tesorería (Cuentas por cobrar). Lo que cada una puede hacer
 * con ella llega por `acciones` y, por cobro, por `accionCobro`. La de una
 * cotización de varias unidades dice de cuál es, o que es por toda la
 * cotización, con lo que le toca a cada una (migración 20261126998000).
 */
export function FacturaDeVenta({
  factura: f,
  conCotizacion = false,
  acciones,
  accionCobro,
  cajas,
  delCodigo,
}: {
  factura: FacturaVenta
  /** Tesorería la lee suelta: dice de qué código interno y de qué cotización es. */
  conCotizacion?: boolean
  acciones?: ReactNode
  accionCobro?: (cobro: CobroFactura) => ReactNode
  /** Para quien lleva la caja: a qué cuenta entró cada cobro. */
  cajas?: Map<string, CajaDelPago>
  /** En la ficha de un código: de la factura por toda la cotización, se marca la parte de ese código. */
  delCodigo?: string
}) {
  const m = codigo(f.moneda)
  const estado = estadoFacturaVenta(f)
  const saldo = Number(f.saldo ?? 0)
  const anulada = Boolean(f.anulada_en)
  // Solo la de una cotización de varias unidades dice de cuál es: con una sola no hay qué decir.
  const deVarias = Number(f.unidades_de_la_cotizacion ?? 1) > 1
  const porToda = f.partes.length > 1
  const deQue = !deVarias
    ? null
    : porToda
      ? `Toda la cotización · ${f.partes.length} unidades`
      : f.numero_de_unidad != null
        ? `Unidad ${f.numero_de_unidad} de ${f.unidades_de_la_cotizacion}`
        : null
  // El código que su unidad tiene hoy: si la OT se anuló y se cargó otra, la factura sigue a la unidad.
  const codigoDeHoy = (!porToda && f.partes[0]?.codigo_interno) || f.codigo_interno
  // En la ficha de un código, de la factura por toda la cotización manda lo de ese código:
  // con el saldo de la factura entera, quien sumaba las facturas del código se pasaba.
  const mia = porToda && delCodigo !== undefined ? f.partes.find((p) => p.codigo_interno === delCodigo) : undefined
  const saldoMio = Number(mia?.saldo ?? 0)
  return (
    // Con `id`: el aviso de la campana aterriza en esta factura (`#id`).
    <article
      id={f.id ?? undefined}
      className="scroll-mt-20 rounded-[var(--radius-base)] border border-borde p-3 target:border-acento"
      data-factura={f.numero ?? undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`font-medium tabular ${anulada ? 'text-texto-suave line-through' : 'text-texto'}`}>Factura {f.numero}</span>
          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          {deQue && (
            <span className="text-sm text-texto" data-de-que-unidad>
              {deQue}
            </span>
          )}
          {f.concepto && <span className="text-sm text-texto-suave">{f.concepto}</span>}
        </p>
        {!anulada && (
          <p className="tabular text-sm font-semibold text-texto" data-saldo-de-la-factura>
            {mia ? (
              saldoMio > 0 ? `Saldo de este código ${moneda(saldoMio, m)}` : 'Sin saldo en este código'
            ) : (
              <>
                {saldo > 0 ? `Saldo ${moneda(saldo, m)}` : 'Sin saldo'}
                {/* Lo que falta cobrar como parte del total (DKS, 27/10/2026: porcentaje y costo). */}
                {saldo > 0 && Number(f.cobrado) > 0 && (
                  <span className="font-normal text-texto-suave"> · {porcentaje(parteDe(saldo, f.total))} del total</span>
                )}
              </>
            )}
          </p>
        )}
      </div>
      {conCotizacion && (
        <p className="mt-0.5 text-sm text-texto">
          {f.cliente}
          <span className="text-texto-suave">
            {/* La de toda la cotización nombra sus códigos abajo, con lo que le toca a cada uno. */}
            {!porToda && (
              <>
                {' '}
                · código <span className="whitespace-nowrap font-medium text-texto">{codigoDeHoy}</span>
              </>
            )}{' '}
            · cotización {f.cotizacion_numero}
          </span>
        </p>
      )}
      <p className="mt-0.5 text-xs text-texto-suave">
        {mia ? (
          <span data-de-este-codigo>
            A este código le tocan <span className="tabular font-medium text-texto">{moneda(mia.monto, m)}</span>
            {Number(mia.cobrado) > 0 && (
              <>
                {' '}
                · cobrado <span className="tabular">{moneda(mia.cobrado, m)}</span>
              </>
            )}{' '}
            · la factura es por <span className="tabular whitespace-nowrap">{moneda(f.total, m)}</span>
            {!anulada && saldo > 0 && (
              <>
                , con saldo de <span className="tabular whitespace-nowrap">{moneda(saldo, m)}</span>
              </>
            )}
          </span>
        ) : (
          <>
            Total <span className="tabular font-medium text-texto">{moneda(f.total, m)}</span>
            {Number(f.cobrado) > 0 && (
              <>
                {' '}
                · cobrado <span className="tabular">{moneda(f.cobrado, m)}</span>
                {parteDe(f.cobrado, f.total) !== null && ` · ${porcentaje(parteDe(f.cobrado, f.total))} de la factura`}
              </>
            )}
          </>
        )}{' '}
        · emitida el {fecha(f.fecha_emision)}
        {!anulada && saldo > 0 && (
          <>
            {' '}
            · <Vence dia={f.fecha_vencimiento} />
          </>
        )}
      </p>
      {porToda && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-texto-suave" aria-label="Lo que le toca a cada unidad" data-partes>
          {f.partes.map((p) => {
            const este = delCodigo !== undefined && p.codigo_interno === delCodigo
            return (
              <li key={p.numero_de_unidad} className={este ? 'font-medium text-texto' : undefined} data-parte={p.numero_de_unidad}>
                Unidad {p.numero_de_unidad} · <span className="whitespace-nowrap">{este ? 'este código' : `código ${p.codigo_interno}`}</span> ·{' '}
                <span className="tabular whitespace-nowrap">{moneda(p.monto, m)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {anulada && (
        <p className="mt-0.5 text-xs text-peligro">
          Anulada el {fecha(f.anulada_en)}: {f.motivo_anulacion}
        </p>
      )}
      {f.cancelada && Number(f.cobrado) < Number(f.total) && (
        <p className="mt-0.5 text-xs text-texto-suave">
          Cancelada con {moneda(Number(f.total) - Number(f.cobrado), m)} menos que el total (detracción o retención).
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {f.url ? (
          <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0">
            <FileText aria-hidden className="size-4" />
            Abrir la factura
          </a>
        ) : (
          <span className="text-xs text-aviso">No se pudo preparar el enlace a la factura. Recarga la página.</span>
        )}
        {acciones}
      </div>

      {f.cobros.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2 text-xs text-texto-suave">
          {f.cobros.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                <span className={b.anulado_en ? 'line-through' : undefined}>
                  Cobro del {fecha(b.fecha)} · <span className="tabular font-medium text-texto">{moneda(b.monto, m)}</span>
                  {mia && <> de toda la factura</>}
                  {b.operacion && <> · op. {b.operacion}</>}
                  {b.cancela && !b.anulado_en && <> · la canceló</>}
                </span>
                {/* Fuera del tachado: que su ingreso también se anuló es lo que se tiene que leer. */}
                <CajaDeLaLinea cajas={cajas} id={b.id} tipo="cobro" monedaDocumento={m} />
              </span>
              {b.url ? (
                <a href={b.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0">
                  <Paperclip aria-hidden className="size-3.5" />
                  Voucher
                </a>
              ) : (
                <span className="text-aviso">Voucher no disponible</span>
              )}
              {b.anulado_en ? <span className="text-peligro">Anulado: {b.motivo_anulacion}</span> : accionCobro?.(b)}
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

/** El vencimiento dicho como se lee, con sus días contados en Lima: lo vencido, en rojo (plan 11.1). */
function Vence({ dia }: { dia: string | null }) {
  const faltan = diasHasta(dia)
  if (faltan === null) return <>sin vencimiento</>
  if (faltan < 0) {
    return (
      <span className="text-peligro">
        venció el {fecha(dia)}, <span className="whitespace-nowrap">{diasDelVencimiento(faltan)}</span>
      </span>
    )
  }
  if (faltan === 0) {
    return (
      <span className="text-aviso">
        vence hoy
      </span>
    )
  }
  return (
    <span>
      vence el {fecha(dia)}, <span className="whitespace-nowrap">{diasDelVencimiento(faltan)}</span>
    </span>
  )
}

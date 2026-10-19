import { FileText, Paperclip } from 'lucide-react'
import type { ReactNode } from 'react'

import { CajaDeLaLinea } from '@/components/finanzas/caja-del-pago'
import { Insignia } from '@/components/ui/etiqueta-estado'
import type { CajaDelPago } from '@/lib/datos/caja'
import type { CobroFactura, FacturaVenta } from '@/lib/datos/facturacion'
import { estadoFacturaVenta } from '@/lib/dominio/finanzas'
import { diasHasta, fecha, moneda, type CodigoMoneda } from '@/lib/format'

const codigo = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

/**
 * Una factura de venta con sus cobros y sus vouchers, como la ven Contabilidad
 * (Facturación) y Tesorería (Cuentas por cobrar). Lo que cada una puede hacer
 * con ella llega por `acciones` y, por cobro, por `accionCobro`.
 */
export function FacturaDeVenta({
  factura: f,
  conCotizacion = false,
  acciones,
  accionCobro,
  cajas,
}: {
  factura: FacturaVenta
  /** Tesorería la lee suelta: dice de qué código interno y de qué cotización es. */
  conCotizacion?: boolean
  acciones?: ReactNode
  accionCobro?: (cobro: CobroFactura) => ReactNode
  /** Para quien lleva la caja: a qué cuenta entró cada cobro. */
  cajas?: Map<string, CajaDelPago>
}) {
  const m = codigo(f.moneda)
  const estado = estadoFacturaVenta(f)
  const saldo = Number(f.saldo ?? 0)
  const anulada = Boolean(f.anulada_en)
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
          {f.concepto && <span className="text-sm text-texto-suave">{f.concepto}</span>}
        </p>
        {!anulada && (
          <p className="tabular text-sm font-semibold text-texto">{saldo > 0 ? `Saldo ${moneda(saldo, m)}` : 'Sin saldo'}</p>
        )}
      </div>
      {conCotizacion && (
        <p className="mt-0.5 text-sm text-texto">
          {f.cliente}
          <span className="text-texto-suave">
            {' '}
            · código <span className="font-medium text-texto">{f.codigo_interno}</span> · cotización {f.cotizacion_numero}
          </span>
        </p>
      )}
      <p className="mt-0.5 text-xs text-texto-suave">
        Total <span className="tabular font-medium text-texto">{moneda(f.total, m)}</span>
        {Number(f.cobrado) > 0 && (
          <>
            {' '}
            · cobrado <span className="tabular">{moneda(f.cobrado, m)}</span>
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
              <span className={b.anulado_en ? 'line-through' : undefined}>
                Cobro del {fecha(b.fecha)} · <span className="tabular font-medium text-texto">{moneda(b.monto, m)}</span>
                {b.operacion && <> · op. {b.operacion}</>}
                {b.cancela && !b.anulado_en && <> · la canceló</>}
                <CajaDeLaLinea cajas={cajas} id={b.id} tipo="cobro" />
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

/** El vencimiento dicho como se lee: lo vencido, en rojo. */
function Vence({ dia }: { dia: string | null }) {
  const faltan = diasHasta(dia)
  if (faltan === null) return <>sin vencimiento</>
  if (faltan < 0) {
    return (
      <span className="text-peligro">
        venció el {fecha(dia)}, hace {-faltan} {faltan === -1 ? 'día' : 'días'}
      </span>
    )
  }
  if (faltan === 0) return <span className="text-aviso">vence hoy</span>
  return <>vence el {fecha(dia)}</>
}

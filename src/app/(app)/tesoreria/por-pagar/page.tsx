import { FileText, Receipt } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cuentasPorPagar, type CuentaPorPagar } from '@/lib/datos/adquisiciones'
import { TIPO_COMPROBANTE, TIPO_PLANILLA, definir } from '@/lib/dominio/estados'
import { CONTROL_FACTURA_COMPRA } from '@/lib/dominio/finanzas'
import { fecha, hoyLima, moneda, periodo } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { AnularPagoFactura, PagarFactura } from '../formularios'
import { codigoMoneda, Vencimiento } from '../vencimiento'

export const metadata = { title: 'Cuentas por pagar' }

/**
 * Lo que la casa debe: cada factura que Contabilidad registró en Adquisiciones,
 * al contado o a crédito, con sus OC y si su total calza con ellas; Tesorería la
 * paga con su voucher (migración 20261015122000). Debajo, las compras a crédito
 * que todavía esperan su factura y, para consultar, las planillas que RR. HH.
 * cerró y repartió por OT. Los servicios de terceros se pagan en «Pagos de
 * servicio».
 */
export default async function PaginaPorPagar() {
  const perfil = await exigirPermiso('tesoreria.ver_documentos')
  const paga = puede(perfil, 'tesoreria.registrar_pagos')
  const db = await createClient()
  const [cuentas, pendientes, planillas] = await Promise.all([
    cuentasPorPagar(),
    db.from('v_compras_credito_sin_comprobante').select('orden_compra_id,numero,numero_ot,proveedor,referencia,fecha_compra,fecha_vencimiento,moneda,total_estimado').order('fecha_vencimiento').limit(100),
    db.rpc('resumen_planilla_por_ot'),
  ])
  for (const r of [pendientes, planillas]) if (r.error) throw new Error(`No se pudieron cargar las cuentas por pagar: ${r.error.message}`)
  const hoy = hoyLima()
  const porPagar = cuentas.filter((c) => Number(c.saldo) > 0)
  const pagadas = cuentas.filter((c) => Number(c.saldo) <= 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Cuentas por pagar"
        descripcion="Las facturas de compra que registró Contabilidad, al contado o a crédito, de la que vence antes a la que vence después. Cada pago va con su voucher."
      />

      <Tarjeta>
        <TarjetaCabecera titulo="Por pagar" descripcion="Cada factura con sus OC y su saldo; lo vencido sale en rojo." />
        <TarjetaCuerpo className="space-y-3">
          {porPagar.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="rounded-full bg-acento-suave p-3 text-acento">
                <Receipt aria-hidden className="size-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-texto">No hay facturas por pagar</p>
              <p className="mt-1 max-w-lg text-sm text-texto-suave">Aparecen cuando Contabilidad registra una factura de compra en Adquisiciones.</p>
            </div>
          ) : (
            porPagar.map((c) => <Factura key={c.id} cuenta={c} paga={paga} hoy={hoy} />)
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta className="mt-5">
        <TarjetaCabecera titulo="Compras a crédito sin comprobante" descripcion="Logística marcó crédito; Contabilidad todavía tiene que registrar la factura en Adquisiciones." />
        <TarjetaCuerpo className="space-y-2">
          {(pendientes.data ?? []).length === 0 ? (
            <p className="text-sm text-texto-suave">No hay compras a crédito esperando su factura.</p>
          ) : (
            (pendientes.data ?? []).map((c) => (
              <div
                key={c.orden_compra_id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[var(--radius-base)] border border-borde p-3 text-sm"
              >
                <span>
                  <span className="text-texto">
                    {c.numero_ot ? `OT ${c.numero_ot}` : 'Para almacén'} · {c.proveedor} · {c.numero ?? c.referencia}
                  </span>
                  <span className="block text-xs text-texto-suave">
                    Comprada el {fecha(c.fecha_compra)} · <Vencimiento dia={c.fecha_vencimiento} saldo={Number(c.total_estimado ?? 1)} />
                  </span>
                </span>
                <strong className="tabular">
                  {c.total_estimado === null ? <span className="font-normal text-aviso">Precio pendiente</span> : moneda(c.total_estimado, codigoMoneda(c.moneda))}
                </strong>
              </div>
            ))
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {pagadas.length > 0 && (
        <details className="mt-5 rounded-[var(--radius-base)] border border-borde bg-superficie">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-texto">Pagadas ({pagadas.length})</summary>
          <div className="space-y-3 border-t border-borde p-4">
            {pagadas.map((c) => (
              <Factura key={c.id} cuenta={c} paga={paga} hoy={hoy} />
            ))}
          </div>
        </details>
      )}

      <Tarjeta className="mt-5">
        <TarjetaCabecera titulo="Planillas distribuidas por OT" descripcion="Para consultar: las planillas que cerró RR. HH. Los nombres del personal se quedan en RR. HH." />
        <TarjetaCuerpo className="space-y-2">
          {(planillas.data ?? []).length === 0 ? (
            <p className="text-sm text-texto-suave">Todavía no hay planillas cerradas.</p>
          ) : (
            (planillas.data ?? []).map((p, i) => (
              <p
                key={`${p.orden_id}-${p.tipo}-${p.periodo}-${i}`}
                className="flex flex-wrap justify-between gap-2 rounded-[var(--radius-base)] border border-borde p-3 text-sm"
              >
                <span>
                  OT {p.numero_ot} · {definir(TIPO_PLANILLA, p.tipo).etiqueta} · {periodo(p.periodo)}
                </span>
                <strong className="tabular">{moneda(p.monto, codigoMoneda(p.moneda))}</strong>
              </p>
            ))
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}

/** Una factura de compra: sus OC, el aviso de monto, lo pagado con cada voucher y el botón para pagar. */
function Factura({ cuenta: c, paga, hoy }: { cuenta: CuentaPorPagar; paga: boolean; hoy: string }) {
  const m = codigoMoneda(c.moneda)
  const saldo = Number(c.saldo)
  const control = c.control
  const aviso = control ? (CONTROL_FACTURA_COMPRA[control.control] ?? { etiqueta: control.control, tono: 'neutro' as const }) : null
  return (
    <article className="rounded-[var(--radius-base)] border border-borde p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-texto">
              {c.proveedor} · <span className="tabular">{c.numero_documento}</span>
            </span>
            {saldo <= 0 && <Insignia tono="exito">Pagada</Insignia>}
            {saldo > 0 && Number(c.pagado) > 0 && <Insignia tono="aviso">Pagada en parte</Insignia>}
            {aviso && <Insignia tono={aviso.tono}>{aviso.etiqueta}</Insignia>}
          </p>
          <p className="text-xs text-texto-suave">
            {definir(TIPO_COMPROBANTE, c.tipo ?? '').etiqueta} · {c.condicion_pago === 'CREDITO' ? 'crédito' : 'contado'} ·{' '}
            {c.numero_ot ? `OT ${c.numero_ot}` : 'sin OT'} · <Vencimiento dia={c.fecha_vencimiento} saldo={saldo} />
          </p>
          {control && control.ordenes.length > 0 && (
            <p className="text-xs text-texto-suave">
              {control.ordenes.length === 1 ? 'OC ' : `${control.ordenes.length} OC: `}
              {control.ordenes.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ' · '}
                  <span className="tabular text-texto">{o.numero ?? o.referencia}</span>
                  {o.numero_ot && ` (OT ${o.numero_ot})`}
                </span>
              ))}
              {control.control === 'NO_CALZA' && control.total_oc !== null && ` · suman ${moneda(control.total_oc, m)}`}
            </p>
          )}
          {c.url && (
            <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-acento hover:underline sm:min-h-0">
              <FileText aria-hidden className="size-3.5" />
              Factura
            </a>
          )}
        </div>
        <div className="text-right">
          <p className="tabular text-sm font-semibold text-texto">{saldo > 0 ? `Saldo ${moneda(saldo, m)}` : moneda(c.total, m)}</p>
          <p className="tabular text-xs text-texto-suave">
            Total {moneda(c.total, m)}
            {Number(c.pagado) > 0 && saldo > 0 && ` · pagado ${moneda(c.pagado, m)}`}
          </p>
        </div>
      </div>

      {c.pagos.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2">
          {c.pagos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className={p.anulado_en ? 'text-texto-suave line-through' : 'text-texto-suave'}>
                Pago del {fecha(p.fecha)} · <span className="tabular text-texto">{moneda(p.monto, m)}</span> · op. {p.referencia}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {p.anulado_en && <span className="text-peligro">Anulado: {p.motivo_anulacion}</span>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0">
                    <FileText aria-hidden className="size-3.5" />
                    Voucher
                  </a>
                )}
                {!p.archivo_ruta && !p.anulado_en && <span>sin voucher (anotado antes)</span>}
                {paga && !p.anulado_en && <AnularPagoFactura pagoId={p.id} />}
              </span>
            </li>
          ))}
        </ol>
      )}

      {paga && saldo > 0 && c.id && (
        <div className="mt-3">
          <PagarFactura
            adquisicionId={c.id}
            numero={c.numero_documento ?? 'factura'}
            proveedor={c.proveedor ?? ''}
            hoy={hoy}
            saldo={saldo}
            codigoMoneda={m}
          />
        </div>
      )}
    </article>
  )
}

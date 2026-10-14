import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_PLANILLA, definir } from '@/lib/dominio/estados'
import { fecha, hoyLima, moneda, periodo } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { Movimiento } from '../formularios'
import { codigoMoneda, Vencimiento } from '../vencimiento'

export const metadata = { title: 'Cuentas por pagar' }

/**
 * Lo que la casa debe: los comprobantes a crédito que registró Contabilidad en
 * Adquisiciones, las compras a crédito que todavía esperan su factura y, para
 * consultar, las planillas que RR. HH. cerró y repartió por OT. Los servicios de
 * terceros se pagan en «Pagos de servicio».
 */
export default async function PaginaPorPagar() {
  const perfil = await exigirPermiso('tesoreria.ver_documentos')
  const paga = puede(perfil, 'tesoreria.registrar_pagos')
  const db = await createClient()
  const [pagar, pendientes, planillas] = await Promise.all([
    db.from('v_cuentas_pagar').select('id,numero_ot,proveedor,numero_documento,fecha_vencimiento,moneda,total,pagado,saldo').order('fecha_vencimiento').limit(200),
    db.from('v_compras_credito_sin_comprobante').select('orden_compra_id,numero,numero_ot,proveedor,referencia,fecha_compra,fecha_vencimiento,moneda,total_estimado').order('fecha_vencimiento').limit(100),
    db.rpc('resumen_planilla_por_ot'),
  ])
  for (const r of [pagar, pendientes, planillas]) if (r.error) throw new Error(`No se pudieron cargar las cuentas por pagar: ${r.error.message}`)
  const hoy = hoyLima()
  const porPagar = (pagar.data ?? []).filter((c) => Number(c.saldo) > 0)
  const pagadas = (pagar.data ?? []).filter((c) => Number(c.saldo) <= 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Cuentas por pagar"
        descripcion="Los comprobantes a crédito que registró Contabilidad, de la que vence antes a la que vence después, y las compras a crédito que esperan su factura."
      />

      <Tarjeta>
        <TarjetaCabecera titulo="Por pagar" descripcion="Cada comprobante con su saldo; lo vencido sale en rojo." />
        <TarjetaCuerpo className="space-y-3">
          {porPagar.length === 0 ? (
            <p className="text-sm text-texto-suave">
              No hay comprobantes por pagar. Aparecen cuando Contabilidad registra en Adquisiciones una factura a crédito.
            </p>
          ) : (
            porPagar.map((c) => (
              <article key={c.id} className="rounded-[var(--radius-base)] border border-borde p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-medium text-texto">
                    {c.proveedor} · <span className="tabular">{c.numero_documento}</span>
                  </p>
                  <p className="tabular text-sm font-semibold text-texto">Saldo {moneda(c.saldo, codigoMoneda(c.moneda))}</p>
                </div>
                <p className="text-xs text-texto-suave">
                  {c.numero_ot ? `OT ${c.numero_ot}` : 'Sin OT'} · <Vencimiento dia={c.fecha_vencimiento} saldo={Number(c.saldo)} /> · total{' '}
                  {moneda(c.total, codigoMoneda(c.moneda))}
                  {Number(c.pagado) > 0 && ` · pagado ${moneda(c.pagado, codigoMoneda(c.moneda))}`}
                </p>
                {paga && c.id && <Movimiento id={c.id} tipo="pago" saldo={Number(c.saldo)} hoy={hoy} />}
              </article>
            ))
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
          <div className="space-y-2 border-t border-borde p-4">
            {pagadas.map((c) => (
              <p key={c.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>
                  {c.proveedor} · <span className="tabular">{c.numero_documento}</span> · {c.numero_ot ? `OT ${c.numero_ot}` : 'Sin OT'}
                </span>
                <strong className="tabular">{moneda(c.total, codigoMoneda(c.moneda))}</strong>
              </p>
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

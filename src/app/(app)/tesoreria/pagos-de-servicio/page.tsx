import { FileText, Wrench } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { serviciosPorPagar, type ServicioPorPagar } from '@/lib/datos/facturacion'
import { resumenDetraccion } from '@/lib/dominio/detraccion'
import { ESTADO_SERVICIO } from '@/lib/dominio/logistica'
import { fecha, hoyLima, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularPagoServicio, PagarServicio } from '../formularios'
import { codigoMoneda } from '../vencimiento'

export const metadata = { title: 'Pagos de servicio' }

/**
 * Los trabajos de terceros —arenado, torno, pintura— que Logística encargó con
 * su orden de servicio y Gerencia aprobó (migración 20261015120000). Tesorería
 * los paga contra la factura del proveedor, con el voucher; primero los que ya
 * volvieron conformes. Si la OS lleva detracción, esa parte se deposita en el
 * Banco de la Nación y al proveedor se le paga el resto (20261015141000).
 */
export default async function PaginaPagosDeServicio() {
  const perfil = await exigirPermiso(['tesoreria.pagar_servicios', 'tesoreria.ver_documentos'])
  const paga = puede(perfil, 'tesoreria.pagar_servicios')
  const servicios = await serviciosPorPagar(puede(perfil, 'proveedores.ver_cuentas'))
  const hoy = hoyLima()
  const porPagar = servicios
    .filter((s) => !s.cancelada)
    .sort((a, b) => Number(b.estado === 'CONFORME') - Number(a.estado === 'CONFORME'))
  const pagados = servicios.filter((s) => s.cancelada)

  return (
    <>
      <EncabezadoPagina
        titulo="Pagos de servicio"
        descripcion="Las órdenes de servicio que aprobó Gerencia: paga cada una al proveedor con su voucher. Primero las que ya volvieron conformes."
      />

      <Tarjeta>
        <TarjetaCabecera titulo="Por pagar" descripcion="Una orden a cuenta sigue aquí hasta que registres el pago que la cancela." />
        <TarjetaCuerpo className="space-y-3">
          {porPagar.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="rounded-full bg-acento-suave p-3 text-acento">
                <Wrench aria-hidden className="size-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-texto">No hay servicios por pagar</p>
              <p className="mt-1 max-w-lg text-sm text-texto-suave">
                Aparecen cuando Gerencia aprueba una orden de servicio de Logística. Lo normal es pagarla cuando Logística la marca conforme.
              </p>
            </div>
          ) : (
            porPagar.map((s) => <Servicio key={s.id} servicio={s} paga={paga} hoy={hoy} />)
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {pagados.length > 0 && (
        <details className="mt-5 rounded-[var(--radius-base)] border border-borde bg-superficie">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-texto">Pagados ({pagados.length})</summary>
          <div className="space-y-3 border-t border-borde p-4">
            {pagados.map((s) => (
              <Servicio key={s.id} servicio={s} paga={paga} hoy={hoy} />
            ))}
          </div>
        </details>
      )}
    </>
  )
}

function Servicio({ servicio: s, paga, hoy }: { servicio: ServicioPorPagar; paga: boolean; hoy: string }) {
  const m = codigoMoneda(s.moneda)
  const saldo = Math.max(Number(s.monto ?? 0) - Number(s.pagado ?? 0), 0)
  const estado = ESTADO_SERVICIO[s.estado ?? ''] ?? { etiqueta: s.estado ?? '—', tono: 'neutro' as const }
  const detraccion = resumenDetraccion(s.detraccion)
  return (
    <article className="rounded-[var(--radius-base)] border border-borde p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium tabular text-texto">{s.numero}</span>
            <Insignia tono={s.cancelada ? 'exito' : estado.tono}>{s.cancelada ? 'Pagada' : estado.etiqueta}</Insignia>
            {!s.cancelada && Number(s.pagado) > 0 && <Insignia tono="aviso">Pagada en parte</Insignia>}
            <Insignia tono={detraccion.tono}>{detraccion.texto}</Insignia>
          </p>
          <p className="mt-0.5 text-sm text-texto">
            {s.proveedor}
            {s.proveedor_documento && <span className="text-texto-suave"> · RUC {s.proveedor_documento}</span>}
          </p>
          <p className="text-xs text-texto-suave">
            {s.descripcion}
            {' · '}
            {s.condicion_pago === 'CREDITO' ? `crédito a ${s.dias_credito} días` : 'contado'}
            {s.conformidad_en && ` · conforme el ${fecha(s.conformidad_en)}`}
            {s.codigo_interno && ` · código ${s.codigo_interno}`}
          </p>
          {s.detraccion.afecta && s.detraccion.monto !== null && !s.cancelada && (
            <p className="text-xs text-texto-suave">
              {detraccion.detalle}: la detracción va a la cuenta del proveedor en el Banco de la Nación y a él se le paga el resto.
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="tabular text-sm font-semibold text-texto">{moneda(s.monto, m)}</p>
          {Number(s.pagado) > 0 && <p className="tabular text-xs text-texto-suave">Pagado {moneda(s.pagado, m)}</p>}
        </div>
      </div>

      {!s.cancelada && s.cuentas.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-[var(--radius-base)] bg-superficie-2 p-2 text-xs text-texto-suave">
          {s.cuentas.map((c) => (
            <li key={c.id}>
              {c.banco} · <span className="tabular text-texto">{c.numero_cuenta}</span> · {c.moneda === 'USD' ? 'dólares' : 'soles'} · {c.titular}
            </li>
          ))}
        </ul>
      )}

      {s.pagos.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2">
          {s.pagos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className={p.anulado_en ? 'text-texto-suave line-through' : 'text-texto-suave'}>
                Pago del {fecha(p.fecha_pago)} · <span className="tabular text-texto">{moneda(p.monto, codigoMoneda(p.moneda))}</span>
                {p.cancela ? ' · cancela la orden' : ' · a cuenta'}
                {p.operacion && ` · op. ${p.operacion}`}
                {p.comprobante_proveedor && ` · comprobante ${p.comprobante_proveedor}`}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {p.anulado_en && <span className="text-peligro">Anulado: {p.motivo_anulacion}</span>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0">
                    <FileText aria-hidden className="size-3.5" />
                    Voucher
                  </a>
                )}
                {paga && !p.anulado_en && <AnularPagoServicio pagoId={p.id} />}
              </span>
            </li>
          ))}
        </ol>
      )}

      {paga && !s.cancelada && s.id && (
        <div className="mt-3">
          <PagarServicio
            ordenServicioId={s.id}
            numero={s.numero ?? 'orden de servicio'}
            proveedor={s.proveedor ?? 'Proveedor'}
            hoy={hoy}
            saldo={saldo}
            codigoMoneda={m}
          />
        </div>
      )}
    </article>
  )
}

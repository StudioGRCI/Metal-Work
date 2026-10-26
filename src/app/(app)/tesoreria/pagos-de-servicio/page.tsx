import { FileText, Wrench } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { CajaDeLaLinea } from '@/components/finanzas/caja-del-pago'
import { ParaPagar } from '@/components/finanzas/para-pagar'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cajaDeLosPagos, cuentasParaPagar, type CajaDelPago } from '@/lib/datos/caja'
import { serviciosPorPagar, type ServicioPorPagar } from '@/lib/datos/facturacion'
import { AdjuntarDocumentoServicio } from '@/app/(app)/compras/servicios/documentos-servicio'
import { etiquetaDocumentoServicio } from '@/lib/dominio/adquisiciones'
import type { CuentaParaPagar } from '@/lib/dominio/caja'
import { faltaDelServicio, resumenDetraccion } from '@/lib/dominio/detraccion'
import { resumenPorMoneda } from '@/lib/dominio/finanzas'
import { ESTADO_SERVICIO } from '@/lib/dominio/logistica'
import { fecha, hoyLima, moneda, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularPagoServicio, PagarServicio } from '../formularios'
import { codigoMoneda } from '../vencimiento'

export const metadata = { title: 'Pagos de servicio' }

/**
 * Los trabajos de terceros —arenado, torno, pintura— que Logística encargó con
 * su orden de servicio y Gerencia aprobó (migración 20261015120000). Tesorería
 * los paga contra la factura del proveedor, con el voucher; primero los que ya
 * volvieron conformes. Lo que se debe es el total con IGV; si la OS lleva
 * detracción, esa parte se deposita en el Banco de la Nación y al proveedor se le
 * paga el resto (20261015141000). Cuánto falta de cada parte lo da la base
 * (`saldos_de_servicios`, migración 20261026100000).
 * Al pagar se ven la factura y el contrato que adjuntó Logística a la OS y las
 * cuentas del proveedor; si la factura llega a Tesorería, la adjunta aquí
 * (migración 20261020210000).
 */
export default async function PaginaPagosDeServicio() {
  const perfil = await exigirPermiso(['tesoreria.pagar_servicios', 'tesoreria.ver_documentos'])
  // Paga quien lleva la caja: el pago sale de una de sus cuentas (la base pide los dos permisos).
  const paga = puede(perfil, 'tesoreria.pagar_servicios') && puede(perfil, 'tesoreria.caja')
  const adjunta = puede(perfil, 'tesoreria.pagar_servicios')
  const verCuentas = puede(perfil, 'proveedores.ver_cuentas')
  const [servicios, cuentasCaja] = await Promise.all([
    serviciosPorPagar(verCuentas),
    // La cuenta de la que sale cada pago: la caja diaria se mueve sola (20261019100000).
    paga ? cuentasParaPagar() : Promise.resolve([]),
  ])
  // Para quien lleva la caja, de qué cuenta salió cada pago.
  const cajas = puede(perfil, 'tesoreria.caja')
    ? await cajaDeLosPagos('PAGO_ORDEN_SERVICIO', servicios.flatMap((s) => s.pagos.map((p) => p.id)))
    : undefined
  const hoy = hoyLima()
  const porPagar = servicios
    .filter((s) => !s.cancelada)
    .sort((a, b) => Number(b.estado === 'CONFORME') - Number(a.estado === 'CONFORME'))
  const pagados = servicios.filter((s) => s.cancelada)
  const conformes = porPagar.filter((s) => s.estado === 'CONFORME').length
  const resumen = resumenPorMoneda(porPagar.map((s) => ({ moneda: s.moneda, monto: faltaDelServicio(s.saldo) })), ['orden', 'órdenes'])

  return (
    <AvisoDeLaCaja>
      <EncabezadoPagina
        titulo="Pagos de servicio"
        descripcion={resumen && `Por pagar: ${resumen}${conformes > 0 ? ` · ${conformes === 1 ? 'una conforme' : `${conformes} conformes`}` : ''}.`}
        ayuda="Las órdenes de servicio que aprobó Gerencia: paga cada una al proveedor con su voucher. Primero las que ya volvieron conformes."
      />

      <Tarjeta>
        <TarjetaCabecera titulo="Por pagar" ayuda="Una orden a cuenta sigue aquí hasta que registres el pago que la cancela." />
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
            porPagar.map((s) => <Servicio key={s.id} servicio={s} paga={paga} adjunta={adjunta} verCuentas={verCuentas} hoy={hoy} cuentasCaja={cuentasCaja} cajas={cajas} />)
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {pagados.length > 0 && (
        <SeccionDesplegable titulo={`Pagados (${pagados.length})`} className="mt-5">
          <div className="space-y-3">
            {pagados.map((s) => (
              <Servicio key={s.id} servicio={s} paga={paga} adjunta={adjunta} verCuentas={verCuentas} hoy={hoy} cuentasCaja={cuentasCaja} cajas={cajas} />
            ))}
          </div>
        </SeccionDesplegable>
      )}
    </AvisoDeLaCaja>
  )
}

/** Lo que falta de una orden pagada en parte, en una frase. */
function loQueFalta(saldo: ServicioPorPagar['saldo'], m: CodigoMoneda) {
  const partes = [
    saldo.saldoProveedor > 0 ? `${moneda(saldo.saldoProveedor, m)} al proveedor` : null,
    saldo.saldoDetraccion > 0 ? `${moneda(saldo.saldoDetraccion)} de detracción` : null,
  ].filter(Boolean)
  return partes.length > 0 ? `Falta ${partes.join(' y ')}.` : 'Ya se pagó todo, pero ningún pago dice que la cancela.'
}

function Servicio({
  servicio: s,
  paga,
  adjunta,
  verCuentas,
  hoy,
  cuentasCaja,
  cajas,
}: {
  servicio: ServicioPorPagar
  paga: boolean
  adjunta: boolean
  verCuentas: boolean
  hoy: string
  cuentasCaja: CuentaParaPagar[]
  cajas: Map<string, CajaDelPago> | undefined
}) {
  const m = codigoMoneda(s.moneda)
  const saldo = s.saldo
  const pagado = saldo.pagadoProveedor > 0 || saldo.pagadoDetraccion > 0
  const conDetraccion = saldo.detraccion > 0
  const estado = ESTADO_SERVICIO[s.estado ?? ''] ?? { etiqueta: s.estado ?? '—', tono: 'neutro' as const }
  const detraccion = resumenDetraccion(s.detraccion)
  // La factura y el contrato de la OS, con las cuentas del proveedor: lo que se mira para pagar.
  const documentos = s.documentos.map((d) => ({ clave: d.id, etiqueta: etiquetaDocumentoServicio(d), url: d.url }))
  const comprobante = s.documentos.some((d) => d.tipo === 'FACTURA' || d.tipo === 'BOLETA' || d.tipo === 'RECIBO')
  const sinCuentas = verCuentas ? 'El proveedor no tiene cuentas activas en Proveedores: pídeselas a Logística.' : null
  return (
    <article className="rounded-[var(--radius-base)] border border-borde p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {/* Con un texto largo, el total sigue en su columna de la derecha. */}
        <div className="min-w-0 sm:flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium tabular text-texto">{s.numero}</span>
            <Insignia tono={s.cancelada ? 'exito' : estado.tono}>{s.cancelada ? 'Pagada' : estado.etiqueta}</Insignia>
            {!s.cancelada && pagado && <Insignia tono="aviso">Pagada en parte</Insignia>}
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
          {conDetraccion && !s.cancelada && (
            <p className="text-xs text-texto-suave">
              {detraccion.detalle}. Al proveedor se le pagan {moneda(saldo.alProveedor, m)}; la detracción va a su cuenta del Banco de la Nación.
            </p>
          )}
          {!s.cancelada && pagado && <p className="text-xs text-texto-suave">{loQueFalta(saldo, m)}</p>}
        </div>
        {/* En el teléfono baja bajo el proveedor, alineada a la izquierda como el resto. */}
        <div className="shrink-0 sm:text-right">
          <p className="tabular text-sm font-semibold text-texto">{moneda(saldo.total, m)}</p>
          <p className="text-xs text-texto-suave">con IGV</p>
          {saldo.pagadoProveedor > 0 && <p className="tabular text-xs text-texto-suave">Pagado al proveedor {moneda(saldo.pagadoProveedor, m)}</p>}
          {saldo.pagadoDetraccion > 0 && <p className="tabular text-xs text-texto-suave">Detracción depositada {moneda(saldo.pagadoDetraccion)}</p>}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        <ParaPagar documentos={documentos} cuentas={s.cancelada ? [] : s.cuentas} monedaDocumento={m} sinCuentas={s.cancelada ? null : sinCuentas} />
        {!s.cancelada && !comprobante && (
          <p className="text-xs text-texto-suave">
            Falta la factura o el recibo del proveedor: la adjunta Logística en la OS{adjunta ? ', o tú aquí' : ''}.
          </p>
        )}
        {/* El pago, encima de los pagos anteriores como en Cuentas por pagar y por cobrar. */}
        {s.id && !s.cancelada && (paga || adjunta) && (
          <div className="flex flex-wrap items-center gap-2">
            {paga && (
              <PagarServicio
                ordenServicioId={s.id}
                numero={s.numero ?? 'orden de servicio'}
                proveedor={s.proveedor ?? 'Proveedor'}
                hoy={hoy}
                saldo={saldo}
                codigoMoneda={m}
                cuentas={cuentasCaja}
                paraPagar={<ParaPagar documentos={documentos} cuentas={s.cuentas} monedaDocumento={m} sinCuentas={sinCuentas} />}
              />
            )}
            {adjunta && <AdjuntarDocumentoServicio ordenServicioId={s.id} numero={s.numero ?? 'orden de servicio'} />}
          </div>
        )}
      </div>
      {s.pagos.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2">
          {s.pagos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="text-texto-suave">
                <span className={p.anulado_en ? 'line-through' : undefined}>
                  {p.destino === 'DETRACCION' ? 'Detracción del' : 'Pago del'} {fecha(p.fecha_pago)} ·{' '}
                  <span className="tabular text-texto">{moneda(p.monto, codigoMoneda(p.moneda))}</span>
                  {p.cancela ? ' · cancela la orden' : ' · a cuenta'}
                  {p.operacion && ` · op. ${p.operacion}`}
                  {p.comprobante_proveedor && ` · comprobante ${p.comprobante_proveedor}`}
                </span>
                {/* Fuera del tachado: que su egreso también se anuló es lo que se tiene que leer. */}
                <CajaDeLaLinea cajas={cajas} id={p.id} tipo="pago" monedaDocumento={codigoMoneda(p.moneda)} />
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

    </article>
  )
}

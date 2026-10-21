import { FileText, Receipt, ShoppingCart } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { ParaPagar, type DocumentoParaPagar } from '@/components/finanzas/para-pagar'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { CajaDeLaLinea } from '@/components/finanzas/caja-del-pago'
import { AvisosDelDetector, avisosDeFacturaRegistrada, InsigniaDelDetector } from '@/app/(app)/adquisiciones/detector'
import {
  comprasConBoletaPorPagar,
  cuentasPorPagar,
  PAGADAS_A_LA_VISTA,
  type CompraConBoleta,
  type CuentaPorPagar,
} from '@/lib/datos/adquisiciones'
import { cajaDeLosPagos, cuentasParaPagar, type CajaDelPago } from '@/lib/datos/caja'
import { correccionesDe, type CorreccionVista } from '@/lib/datos/correcciones'
import { TIPO_COMPROBANTE, TIPO_PLANILLA, definir } from '@/lib/dominio/estados'
import type { CuentaParaPagar } from '@/lib/dominio/caja'
import { CONTROL_FACTURA_COMPRA, detalleDelControl, resumenPorMoneda } from '@/lib/dominio/finanzas'
import { fecha, hoyLima, moneda, periodo } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { AnularPagoCompra, AnularPagoFactura, PagarCompra, PagarFactura } from '../formularios'
import { codigoMoneda, Vencimiento } from '../vencimiento'

export const metadata = { title: 'Cuentas por pagar' }

/** El PDF de una OC lo arma la aplicación; quien no tiene `compras.ver` no lo abre. */
const pdfDeLaOc = (id: string) => `/compras/${id}/pdf`

/**
 * Lo que la casa debe: cada factura que Contabilidad registró en Adquisiciones,
 * al contado o a crédito, con sus OC y si su total calza con ellas; Tesorería la
 * paga con su voucher (migración 20261015122000). Después, las OC con boleta,
 * que Tesorería paga directo como una OS (migración 20261020210000). Al pagar
 * se ven la OC, su factura o boleta y las cuentas del proveedor (DKS, 20/10).
 * Debajo, cuando las hay, las compras a crédito que todavía esperan su factura
 * y, para consultar, las planillas que RR. HH. cerró y repartió por OT. Los
 * servicios de terceros se pagan en «Pagos de servicio».
 */
export default async function PaginaPorPagar() {
  const perfil = await exigirPermiso('tesoreria.ver_documentos')
  // Paga quien lleva la caja: el pago sale de una de sus cuentas (la base pide los dos permisos).
  const paga = puede(perfil, 'tesoreria.registrar_pagos') && puede(perfil, 'tesoreria.caja')
  const verCuentas = puede(perfil, 'proveedores.ver_cuentas')
  const verOc = puede(perfil, 'compras.ver')
  const db = await createClient()
  const [cuentas, boletas, pendientes, planillas, cuentasCaja] = await Promise.all([
    cuentasPorPagar(verCuentas),
    comprasConBoletaPorPagar(verCuentas),
    db.from('v_compras_credito_sin_comprobante').select('orden_compra_id,numero,numero_ot,proveedor,referencia,fecha_compra,fecha_vencimiento,moneda,total_estimado').order('fecha_vencimiento').limit(100),
    db.rpc('resumen_planilla_por_ot'),
    // La cuenta de la que sale cada pago: la caja diaria se mueve sola (20261019100000).
    paga ? cuentasParaPagar() : Promise.resolve([]),
  ])
  for (const r of [pendientes, planillas]) if (r.error) throw new Error(`No se pudieron cargar las cuentas por pagar: ${r.error.message}`)
  const hoy = hoyLima()
  // Las correcciones de cada factura, con su justificante: Tesorería paga lo que quedó.
  // Y, para quien lleva la caja, de qué cuenta salió cada pago.
  const verCaja = puede(perfil, 'tesoreria.caja')
  const [correcciones, cajas, cajasBoleta] = await Promise.all([
    correccionesDe('FACTURA_COMPRA', cuentas.flatMap((c) => (c.id ? [c.id] : []))),
    verCaja ? cajaDeLosPagos('PAGO_ADQUISICION', cuentas.flatMap((c) => c.pagos.map((p) => p.id))) : undefined,
    verCaja ? cajaDeLosPagos('PAGO_ORDEN_COMPRA', boletas.flatMap((b) => b.pagos.map((p) => p.id))) : undefined,
  ])
  const porPagar = cuentas.filter((c) => Number(c.saldo) > 0)
  const pagadas = cuentas.filter((c) => Number(c.saldo) <= 0)
  // La pagada a la que después llegó su comprobante pide algo (anular su pago): va arriba, no en las pagadas.
  const boletasPorPagar = boletas.filter((b) => !b.cancelada || b.comprobante_en_camino)
  const boletasPagadas = boletas.filter((b) => b.cancelada && !b.comprobante_en_camino)
  // La que espera su comprobante se paga por él: no suma al «Por pagar» ni a lo vencido.
  const pagables = boletasPorPagar.filter((b) => !b.comprobante_en_camino)
  const vencidas =
    porPagar.filter((c) => c.fecha_vencimiento && c.fecha_vencimiento < hoy).length +
    pagables.filter((b) => b.vence && b.vence < hoy && saldoDeLaBoleta(b) > 0).length
  const resumen = resumenPorMoneda(
    [
      ...porPagar.map((c) => ({ moneda: c.moneda, monto: Number(c.saldo) })),
      ...pagables.map((b) => ({ moneda: b.moneda, monto: saldoDeLaBoleta(b) })),
    ],
    ['documento', 'documentos'],
  )
  const pendientesCredito = pendientes.data ?? []
  const planillasPorOt = planillas.data ?? []

  return (
    <AvisoDeLaCaja>
      <EncabezadoPagina
        titulo="Cuentas por pagar"
        descripcion={resumen && `Por pagar: ${resumen}${vencidas > 0 ? ` · ${vencidas === 1 ? 'uno vencido' : `${vencidas} vencidos`}` : ''}.`}
        ayuda="Las facturas de compra que registró Contabilidad, al contado o a crédito, y las OC con boleta, que se pagan directo. Van de la que vence antes a la que vence después; cada pago va con su voucher. Al pagar se ven la OC, su factura o boleta y las cuentas del proveedor."
      />

      <Tarjeta>
        <TarjetaCabecera titulo="Facturas por pagar" ayuda="Cada factura con sus OC y su saldo; lo vencido sale en rojo." />
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
            porPagar.map((c) => (
              <Factura key={c.id} cuenta={c} paga={paga} verOc={verOc} verCuentas={verCuentas} hoy={hoy} correcciones={correcciones.get(c.id ?? '')} cuentasCaja={cuentasCaja} cajas={cajas} />
            ))
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {/* El id es el ancla con que Adquisiciones salta a las OC con boleta. */}
      <Tarjeta id="compras-con-boleta" className="mt-5 scroll-mt-20">
        <TarjetaCabecera
          titulo="OC con boleta por pagar"
          ayuda="Las OC que van con boleta, nota de venta o recibo: no pasan por Contabilidad y Tesorería las paga directo, sin IGV. Si el proveedor entrega factura después, se paga por ella en «Facturas por pagar» y la tarjeta dice qué falta. Las que se emitieron antes de que Tesorería las pagara aquí se pagaron fuera del sistema y no salen."
        />
        <TarjetaCuerpo className="space-y-3">
          {boletasPorPagar.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="rounded-full bg-acento-suave p-3 text-acento">
                <ShoppingCart aria-hidden className="size-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-texto">No hay OC con boleta por pagar</p>
              <p className="mt-1 max-w-lg text-sm text-texto-suave">Aparecen cuando Logística emite una OC con boleta y queda aprobada.</p>
            </div>
          ) : (
            boletasPorPagar.map((b) => (
              <CompraConBoletaFila key={b.id} compra={b} paga={paga} verOc={verOc} verCuentas={verCuentas} hoy={hoy} cuentasCaja={cuentasCaja} cajas={cajasBoleta} />
            ))
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {/* Para consultar: sin nada que mostrar no ocupan la pantalla. */}
      {pendientesCredito.length > 0 && (
        <Tarjeta className="mt-5">
          <TarjetaCabecera titulo="Compras a crédito sin comprobante" ayuda="Logística marcó crédito; Contabilidad todavía tiene que registrar la factura en Adquisiciones." />
          <TarjetaCuerpo className="space-y-2">
            {pendientesCredito.map((c) => (
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
            ))}
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {pagadas.length > 0 && (
        <details className="mt-5 rounded-[var(--radius-base)] border border-borde bg-superficie">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-texto">
            {pagadas.length >= PAGADAS_A_LA_VISTA ? `Las ${PAGADAS_A_LA_VISTA} facturas pagadas de emisión más reciente` : `Facturas pagadas (${pagadas.length})`}
          </summary>
          <div className="space-y-3 border-t border-borde p-4">
            {pagadas.map((c) => (
              <Factura key={c.id} cuenta={c} paga={paga} verOc={verOc} verCuentas={verCuentas} hoy={hoy} correcciones={correcciones.get(c.id ?? '')} cuentasCaja={cuentasCaja} cajas={cajas} />
            ))}
          </div>
        </details>
      )}

      {boletasPagadas.length > 0 && (
        <details className="mt-5 rounded-[var(--radius-base)] border border-borde bg-superficie">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-texto">
            {boletasPagadas.length >= PAGADAS_A_LA_VISTA ? `Las ${PAGADAS_A_LA_VISTA} OC con boleta pagadas más recientes` : `OC con boleta pagadas (${boletasPagadas.length})`}
          </summary>
          <div className="space-y-3 border-t border-borde p-4">
            {boletasPagadas.map((b) => (
              <CompraConBoletaFila key={b.id} compra={b} paga={paga} verOc={verOc} verCuentas={verCuentas} hoy={hoy} cuentasCaja={cuentasCaja} cajas={cajasBoleta} />
            ))}
          </div>
        </details>
      )}

      {planillasPorOt.length > 0 && (
        <Tarjeta className="mt-5">
          <TarjetaCabecera titulo="Planillas distribuidas por OT" ayuda="Para consultar: las planillas que cerró RR. HH. Los nombres del personal se quedan en RR. HH." />
          <TarjetaCuerpo className="space-y-2">
            {planillasPorOt.map((p, i) => (
              <p
                key={`${p.orden_id}-${p.tipo}-${p.periodo}-${i}`}
                className="flex flex-wrap justify-between gap-2 rounded-[var(--radius-base)] border border-borde p-3 text-sm"
              >
                <span>
                  OT {p.numero_ot} · {definir(TIPO_PLANILLA, p.tipo).etiqueta} · {periodo(p.periodo)}
                </span>
                <strong className="tabular">{moneda(p.monto, codigoMoneda(p.moneda))}</strong>
              </p>
            ))}
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </AvisoDeLaCaja>
  )
}

/** Cómo se nombra cada documento de la OC con boleta en la tarjeta y en la ventana del pago. */
function etiquetaDelComprobante(d: CompraConBoleta['comprobantes'][number]) {
  if (!d.numero) return d.nombre
  if (d.tipo === 'BORRADOR') return `Comprobante ${d.numero} (en borrador)`
  return `${d.tipo === 'FACTURA' ? 'Factura' : 'Boleta'} ${d.numero}`
}

/**
 * Lo que dice la tarjeta cuando el proveedor ya entregó su comprobante: se paga
 * por él en «Facturas por pagar». Si la OC ya tenía un pago directo, Contabilidad
 * no lo registra hasta que Tesorería lo anule; a quien no paga se le dice
 * quién lo hace, no se le pide.
 */
function avisoDelComprobante(b: CompraConBoleta, vigentes: number, paga: boolean): string | null {
  const numero = b.comprobante_en_camino
  if (!numero) return null
  const deLogistica = b.comprobante_en_camino_origen === 'LOGISTICA'
  const lo = deLogistica ? 'la' : 'lo'
  const llego = deLogistica
    ? `El proveedor entregó la factura ${numero} y Logística la anexó a la OC`
    : `Contabilidad tiene en borrador el comprobante ${numero} de esta OC`
  if (vigentes === 0) return `${llego}: cuando Contabilidad ${lo} registre, se paga en «Facturas por pagar».`
  const pagos = vigentes === 1 ? 'el pago' : 'los pagos'
  const sigue = paga
    ? `Anula ${pagos} de aquí y, cuando Contabilidad ${lo} registre, págal${deLogistica ? 'a' : 'o'} en «Facturas por pagar» con ${vigentes === 1 ? 'el mismo voucher' : 'los mismos vouchers'}.`
    : `Tesorería tiene que anular ${pagos} de aquí para que Contabilidad ${lo} registre; después se paga en «Facturas por pagar».`
  return `${llego}, pero esta OC ya tiene ${vigentes === 1 ? 'un pago directo' : 'pagos directos'}: Contabilidad no ${lo} registra mientras ${vigentes === 1 ? 'siga vigente' : 'sigan vigentes'}. ${sigue}`
}

/** Lo que le falta pagar a una OC con boleta; una cancelada «a cuenta» ya no debe nada. */
function saldoDeLaBoleta(b: CompraConBoleta) {
  return b.cancelada ? 0 : Math.max(Number(b.total ?? 0) - Number(b.pagado ?? 0), 0)
}

/** Por qué no sale ninguna cuenta del proveedor, si quien mira puede verlas. */
function sinCuentas(verCuentas: boolean, conProveedor: boolean) {
  if (!verCuentas) return null
  return conProveedor
    ? 'El proveedor no tiene cuentas activas en Proveedores: pídeselas a Logística.'
    : 'La factura no está ligada a una OC: busca la cuenta del proveedor en Proveedores.'
}

/** Una factura de compra: sus OC, el aviso de monto, lo pagado con cada voucher y el botón para pagar. */
function Factura({
  cuenta: c,
  paga,
  verOc,
  verCuentas,
  hoy,
  correcciones,
  cuentasCaja,
  cajas,
}: {
  cuenta: CuentaPorPagar
  paga: boolean
  verOc: boolean
  verCuentas: boolean
  hoy: string
  correcciones: CorreccionVista[] | undefined
  cuentasCaja: CuentaParaPagar[]
  cajas: Map<string, CajaDelPago> | undefined
}) {
  const m = codigoMoneda(c.moneda)
  const saldo = Number(c.saldo)
  const control = c.control
  const aviso = control ? (CONTROL_FACTURA_COMPRA[control.control] ?? { etiqueta: control.control, tono: 'neutro' as const }) : null
  const avisos = avisosDeFacturaRegistrada(c, control)
  const ordenes = control?.ordenes ?? []
  // Lo que Tesorería mira al pagar: la factura, sus OC y a dónde transferir.
  const documentos: DocumentoParaPagar[] = [
    ...(c.url ? [{ clave: 'factura', etiqueta: `Factura ${c.numero_documento ?? ''}`.trim(), url: c.url }] : []),
    ...(verOc ? ordenes.map((o) => ({ clave: o.id, etiqueta: `PDF de la ${o.numero ?? `OC ${o.referencia}`}`, url: pdfDeLaOc(o.id), descarga: true })) : []),
  ]
  return (
    // El id es el ancla con que Adquisiciones salta a esta factura.
    <article id={`factura-${c.id}`} className="scroll-mt-20 rounded-[var(--radius-base)] border border-borde p-3 target:border-acento">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-texto">
              {c.proveedor} · <span className="tabular">{c.numero_documento}</span>
            </span>
            {saldo <= 0 && <Insignia tono="exito">Pagada</Insignia>}
            {saldo > 0 && Number(c.pagado) > 0 && <Insignia tono="aviso">Pagada en parte</Insignia>}
            {aviso && <Insignia tono={aviso.tono}>{aviso.etiqueta}</Insignia>}
            <InsigniaDelDetector avisos={avisos} />
          </p>
          <p className="text-xs text-texto-suave">
            {definir(TIPO_COMPROBANTE, c.tipo ?? '').etiqueta} · {c.condicion_pago === 'CREDITO' ? 'crédito' : 'contado'} ·{' '}
            {c.numero_ot ? `OT ${c.numero_ot}` : 'sin OT'} · <Vencimiento dia={c.fecha_vencimiento} saldo={saldo} />
          </p>
          {ordenes.length > 0 && (
            <p className="text-xs text-texto-suave">
              {ordenes.length === 1 ? 'OC ' : `${ordenes.length} OC: `}
              {/* El PDF de cada OC va abajo, con la factura y las cuentas del proveedor. */}
              {ordenes.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ' · '}
                  <span className="tabular whitespace-nowrap text-texto">{o.numero ?? o.referencia}</span>
                  {o.numero_ot && ` (OT ${o.numero_ot})`}
                </span>
              ))}
            </p>
          )}
          {control && detalleDelControl(control, (n) => moneda(n, m)) && (
            <p className={`text-xs ${control.control === 'NO_CALZA' ? 'text-aviso' : 'text-texto-suave'}`}>
              {detalleDelControl(control, (n) => moneda(n, m))}
            </p>
          )}
          <AvisosDelDetector avisos={avisos} />
          <HistorialDeCorrecciones correcciones={correcciones} />
        </div>
        {/* En el teléfono baja bajo el proveedor, alineada a la izquierda como el resto. */}
        <div className="sm:text-right">
          <p className="tabular text-sm font-semibold text-texto">{saldo > 0 ? `Saldo ${moneda(saldo, m)}` : moneda(c.total, m)}</p>
          <p className="tabular text-xs text-texto-suave">
            Total {moneda(c.total, m)}
            {Number(c.pagado) > 0 && saldo > 0 && ` · pagado ${moneda(c.pagado, m)}`}
          </p>
        </div>
      </div>

      {/* La factura, sus OC y a dónde transferir, como en la OC con boleta y la OS; debajo, el pago. */}
      <div className="mt-2 space-y-2">
        <ParaPagar
          documentos={documentos}
          cuentas={saldo > 0 ? c.cuentasProveedor : []}
          monedaDocumento={m}
          sinCuentas={saldo > 0 ? sinCuentas(verCuentas, ordenes.length > 0) : null}
        />
        {paga && saldo > 0 && c.id && (
          <PagarFactura
            adquisicionId={c.id}
            numero={c.numero_documento ?? 'factura'}
            proveedor={c.proveedor ?? ''}
            hoy={hoy}
            saldo={saldo}
            codigoMoneda={m}
            cuentas={cuentasCaja}
            paraPagar={
              <ParaPagar documentos={documentos} cuentas={c.cuentasProveedor} monedaDocumento={m} sinCuentas={sinCuentas(verCuentas, ordenes.length > 0)} />
            }
          />
        )}
      </div>
      {c.pagos.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2">
          {c.pagos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="text-texto-suave">
                <span className={p.anulado_en ? 'line-through' : undefined}>
                  Pago del {fecha(p.fecha)} · <span className="tabular text-texto">{moneda(p.monto, m)}</span> · op. {p.referencia}
                </span>
                {/* Fuera del tachado: que su egreso también se anuló es lo que se tiene que leer. */}
                <CajaDeLaLinea cajas={cajas} id={p.id} tipo="pago" monedaDocumento={m} />
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

    </article>
  )
}

/**
 * Una OC con boleta: el PDF de la OC, la boleta que adjuntó Logística (o que
 * todavía falta), las cuentas del proveedor, lo pagado con cada voucher y el
 * botón para pagar.
 */
function CompraConBoletaFila({
  compra: b,
  paga,
  verOc,
  verCuentas,
  hoy,
  cuentasCaja,
  cajas,
}: {
  compra: CompraConBoleta
  paga: boolean
  verOc: boolean
  verCuentas: boolean
  hoy: string
  cuentasCaja: CuentaParaPagar[]
  cajas: Map<string, CajaDelPago> | undefined
}) {
  if (!b.id) return null
  const m = codigoMoneda(b.moneda)
  const saldo = saldoDeLaBoleta(b)
  const pagado = Number(b.pagado ?? 0)
  const nombre = b.numero ?? `OC ${b.referencia}`
  const documentos: DocumentoParaPagar[] = [
    ...(verOc ? [{ clave: 'oc', etiqueta: `PDF de la ${nombre}`, url: pdfDeLaOc(b.id), descarga: true }] : []),
    ...b.comprobantes.map((d) => ({ clave: d.id, etiqueta: etiquetaDelComprobante(d), url: d.url })),
  ]
  const sinBoleta = !b.comprobantes.some((d) => d.tipo === 'COMPROBANTE')
  // El proveedor entregó su comprobante: se paga por él en «Facturas por pagar», no aquí.
  const enCamino = Boolean(b.comprobante_en_camino)
  const vigentes = b.pagos.filter((p) => !p.anulado_en).length
  const conPagoVigente = vigentes > 0
  const aviso = avisoDelComprobante(b, vigentes, paga)
  const cobra = saldo > 0 && !enCamino
  const condicion = b.condicion_pago === 'CREDITO' ? `crédito a ${b.dias_credito ?? 0} días` : 'contado'
  return (
    <article id={`compra-${b.id}`} className="scroll-mt-20 rounded-[var(--radius-base)] border border-borde p-3 target:border-acento">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-texto">
              {b.proveedor} · <span className="tabular whitespace-nowrap">{nombre}</span>
            </span>
            {b.cancelada && <Insignia tono="exito">Pagada</Insignia>}
            {!b.cancelada && pagado > 0 && <Insignia tono="aviso">Pagada en parte</Insignia>}
            {b.sin_precio && <Insignia tono="aviso">Líneas sin precio</Insignia>}
            {enCamino && (
              <Insignia tono="aviso">
                {conPagoVigente ? 'Pago por anular' : b.comprobante_en_camino_origen === 'LOGISTICA' ? 'Llegó factura' : 'En Contabilidad'}
              </Insignia>
            )}
          </p>
          <p className="text-xs text-texto-suave">
            Boleta · {condicion}
            {b.codigo_interno && ` · ${b.codigo_interno}`}
            {b.cancelada ? ` · Pagada el ${fecha(b.ultimo_pago)}` : !enCamino && <> · <Vencimiento dia={b.vence} saldo={saldo} /></>}
          </p>
          {aviso ? (
            <p className="text-xs text-aviso">{aviso}</p>
          ) : (
            sinBoleta &&
            !b.cancelada && <p className="text-xs text-texto-suave">Falta la boleta: Logística la adjunta en la OC cuando el proveedor la entregue.</p>
          )}
          {b.estuvo_en_factura && (
            <p className="text-xs text-aviso">
              Estuvo en la factura {b.estuvo_en_factura}, que ya tiene un pago, hasta que una corrección la sacó: mira ese pago antes de pagarla aquí.
            </p>
          )}
          {b.sin_precio && <p className="text-xs text-aviso">Logística tiene que completar los precios antes del pago.</p>}
        </div>
        <div className="sm:text-right">
          <p className="tabular text-sm font-semibold text-texto">{saldo > 0 ? `Saldo ${moneda(saldo, m)}` : moneda(b.total ?? 0, m)}</p>
          <p className="tabular text-xs text-texto-suave">
            Total {moneda(b.total ?? 0, m)}
            {pagado > 0 && saldo > 0 && ` · pagado ${moneda(pagado, m)}`}
          </p>
        </div>
      </div>

      <div className="mt-2 space-y-2">
        <ParaPagar
          documentos={documentos}
          cuentas={cobra ? b.cuentasProveedor : []}
          monedaDocumento={m}
          sinCuentas={cobra ? sinCuentas(verCuentas, true) : null}
        />
        {paga && cobra && !b.sin_precio && (
          <PagarCompra
            ordenCompraId={b.id}
            numero={nombre}
            proveedor={b.proveedor ?? ''}
            hoy={hoy}
            saldo={saldo}
            codigoMoneda={m}
            cuentas={cuentasCaja}
            paraPagar={<ParaPagar documentos={documentos} cuentas={b.cuentasProveedor} monedaDocumento={m} sinCuentas={sinCuentas(verCuentas, true)} />}
          />
        )}
      </div>
      {b.pagos.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2">
          {b.pagos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="text-texto-suave">
                <span className={p.anulado_en ? 'line-through' : undefined}>
                  Pago del {fecha(p.fecha_pago)} · <span className="tabular text-texto">{moneda(p.monto, m)}</span>
                  {p.operacion && ` · op. ${p.operacion}`}
                  {p.comprobante_proveedor && ` · boleta ${p.comprobante_proveedor}`}
                  {p.cancela && !p.anulado_en && ' · cancela la OC'}
                </span>
                {/* Fuera del tachado: que su egreso también se anuló es lo que se tiene que leer. */}
                <CajaDeLaLinea cajas={cajas} id={p.id} tipo="pago" monedaDocumento={m} />
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {p.anulado_en && <span className="text-peligro">Anulado: {p.motivo_anulacion}</span>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0">
                    <FileText aria-hidden className="size-3.5" />
                    Voucher
                  </a>
                )}
                {paga && !p.anulado_en && <AnularPagoCompra pagoId={p.id} />}
              </span>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

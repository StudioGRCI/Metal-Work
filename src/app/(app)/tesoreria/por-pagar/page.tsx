import type { ReactNode } from 'react'
import { FileText, Receipt, ShoppingCart } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { ParaPagar, type DocumentoParaPagar } from '@/components/finanzas/para-pagar'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
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
import { nombreMoneda, type CuentaParaPagar } from '@/lib/dominio/caja'
import { CONTROL_FACTURA_COMPRA, detalleDelControl, resumenPorMoneda } from '@/lib/dominio/finanzas'
import { devueltaEntera, queQuedaSinElPago, queQuedaTrasLaDevolucion, topeDeLaDevolucion, type BoletaParaDevolver } from '@/lib/dominio/pago-de-boleta'
import { fecha, hoyLima, moneda, periodo, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { AnularPagoCompra, AnularPagoFactura, PagarCompra, PagarFactura } from '../formularios'
import {
  AnularDevolucion,
  DescontarDeOtraFactura,
  RegistrarDevolucion,
  SoltarToma,
  TomarAlCambio,
  type FacturaParaDescontar,
} from '../formularios-boleta'
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
  // Pasar lo pagado por la boleta a una factura, o deshacerlo, no mueve la caja: basta registrar pagos.
  const pasa = puede(perfil, 'tesoreria.registrar_pagos')
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
  const [correcciones, cajas, cajasBoleta, cajasDevolucion, ventanas] = await Promise.all([
    correccionesDe('FACTURA_COMPRA', cuentas.flatMap((c) => (c.id ? [c.id] : []))),
    verCaja ? cajaDeLosPagos('PAGO_ADQUISICION', cuentas.flatMap((c) => c.pagos.map((p) => p.id))) : undefined,
    verCaja ? cajaDeLosPagos('PAGO_ORDEN_COMPRA', boletas.flatMap((b) => b.pagos.map((p) => p.id))) : undefined,
    verCaja ? cajaDeLosPagos('DEVOLUCION_ORDEN_COMPRA', boletas.flatMap((b) => b.devoluciones.map((d) => d.id))) : undefined,
    pasa ? paraLasVentanasDeLaBoleta(db, boletas) : { descontables: new Map<string, FacturaParaDescontar[]>(), cambios: new Map<string, number | null>() },
  ])
  // La factura en otra moneda que espera lo pagado por la boleta no se paga encima: primero se le pasa al cambio.
  const esperanBoleta = new Map(boletas.flatMap((b) => (b.id && b.otra_moneda && b.otra_factura_id ? [[b.otra_factura_id, b] as const] : [])))
  const nombresOc = new Map(boletas.flatMap((b) => (b.id ? [[b.id, nombreDeLaOc(b)] as const] : [])))
  const porPagar = cuentas.filter((c) => Number(c.saldo) > 0)
  const pagadas = cuentas.filter((c) => Number(c.saldo) <= 0)
  // La pagada que pide algo (pedir la devolución, o la factura en otra moneda) o
  // que espera su comprobante va arriba, no en las pagadas.
  // La que el proveedor devolvió entera va al final: no se le debe, y por su vencimiento quedaba entre las que sí.
  const arriba = boletas.filter((b) => !b.cancelada || b.comprobante_en_camino || pideAlgo(b))
  const boletasPorPagar = [...arriba.filter((b) => !devueltaEntera(b)), ...arriba.filter((b) => devueltaEntera(b))]
  const boletasPagadas = boletas.filter((b) => b.cancelada && !b.comprobante_en_camino && !pideAlgo(b))
  // La que espera su comprobante o ya tiene su factura se paga por ella: no suma al «Por pagar» ni a lo vencido.
  // Tampoco la que el proveedor devolvió entera: no se le debe hasta que la vuelva a cobrar.
  const pagables = boletasPorPagar.filter((b) => !b.comprobante_en_camino && !b.factura && !devueltaEntera(b))
  // Lo que le pide a Tesorería algo que no es pagar: el encabezado lo cuenta y lleva a su tarjeta.
  const deMas = boletasPorPagar.filter((b) => Number(b.de_mas ?? 0) > 0).length
  const otraMoneda = boletasPorPagar.filter((b) => b.otra_moneda).length
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
  const avisos = [
    deMas > 0 ? (deMas === 1 ? 'una OC pagada de más' : `${deMas} OC pagadas de más`) : null,
    otraMoneda > 0 ? (otraMoneda === 1 ? 'una OC con factura en otra moneda' : `${otraMoneda} OC con factura en otra moneda`) : null,
  ].filter((a) => a !== null)

  return (
    <AvisoDeLaCaja>
      <EncabezadoPagina
        titulo="Cuentas por pagar"
        descripcion={
          (resumen || avisos.length > 0) && (
            <>
              {resumen && `Por pagar: ${resumen}${vencidas > 0 ? ` · ${vencidas === 1 ? 'uno vencido' : `${vencidas} vencidos`}` : ''}`}
              {avisos.map((a, i) => (
                <span key={a}>
                  {(resumen || i > 0) && ' · '}
                  <a href="#compras-con-boleta" className="font-medium text-peligro underline-offset-2 hover:underline">
                    {a}
                  </a>
                </span>
              ))}
              .
            </>
          )
        }
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
              <Factura
                key={c.id}
                cuenta={c}
                paga={paga}
                pasa={pasa}
                verOc={verOc}
                verCuentas={verCuentas}
                hoy={hoy}
                correcciones={correcciones.get(c.id ?? '')}
                cuentasCaja={cuentasCaja}
                cajas={cajas}
                esperaBoleta={esperanBoleta.get(c.id ?? '')}
                nombresOc={nombresOc}
              />
            ))
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {/* El id es el ancla con que Adquisiciones salta a las OC con boleta. */}
      <Tarjeta id="compras-con-boleta" className="mt-5 scroll-mt-20">
        <TarjetaCabecera
          titulo="OC con boleta por pagar"
          ayuda="Las OC que van con boleta, nota de venta o recibo: no pasan por Contabilidad y Tesorería las paga directo, sin IGV. Si el proveedor entrega factura después, al registrarla toma lo que se pagó por la boleta: lo que falte se paga por ella en «Facturas por pagar»; si es por menos, la tarjeta dice lo pagado de más, y ahí se registra la devolución o se descuenta de otra factura. Si la factura va en otra moneda, la tarjeta la pasa al cambio. Nada de eso anula un pago. Las que se emitieron antes de que Tesorería las pagara aquí se pagaron fuera del sistema y no salen."
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
              <CompraConBoletaFila
                key={b.id}
                compra={b}
                paga={paga}
                pasa={pasa}
                verOc={verOc}
                verCuentas={verCuentas}
                hoy={hoy}
                cuentasCaja={cuentasCaja}
                cajas={cajasBoleta}
                cajasDevolucion={cajasDevolucion}
                descontables={ventanas.descontables.get(b.id ?? '')}
                cambios={ventanas.cambios}
              />
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
        <SeccionDesplegable
          titulo={pagadas.length >= PAGADAS_A_LA_VISTA ? `Las ${PAGADAS_A_LA_VISTA} facturas pagadas de emisión más reciente` : `Facturas pagadas (${pagadas.length})`}
          className="mt-5"
        >
          <div className="space-y-3">
            {pagadas.map((c) => (
              <Factura
                key={c.id}
                cuenta={c}
                paga={paga}
                pasa={pasa}
                verOc={verOc}
                verCuentas={verCuentas}
                hoy={hoy}
                correcciones={correcciones.get(c.id ?? '')}
                cuentasCaja={cuentasCaja}
                cajas={cajas}
                esperaBoleta={esperanBoleta.get(c.id ?? '')}
                nombresOc={nombresOc}
              />
            ))}
          </div>
        </SeccionDesplegable>
      )}

      {boletasPagadas.length > 0 && (
        <SeccionDesplegable
          titulo={boletasPagadas.length >= PAGADAS_A_LA_VISTA ? `Las ${PAGADAS_A_LA_VISTA} OC con boleta pagadas más recientes` : `OC con boleta pagadas (${boletasPagadas.length})`}
          className="mt-5"
        >
          <div className="space-y-3">
            {boletasPagadas.map((b) => (
              <CompraConBoletaFila
                key={b.id}
                compra={b}
                paga={paga}
                pasa={pasa}
                verOc={verOc}
                verCuentas={verCuentas}
                hoy={hoy}
                cuentasCaja={cuentasCaja}
                cajas={cajasBoleta}
                cajasDevolucion={cajasDevolucion}
                descontables={ventanas.descontables.get(b.id ?? '')}
                cambios={ventanas.cambios}
              />
            ))}
          </div>
        </SeccionDesplegable>
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
  if (d.tipo === 'BORRADOR') return `Comprobante ${d.numero} (en borrador${d.sinPdf ? ', sin PDF todavía' : ''})`
  return `${d.tipo === 'FACTURA' ? 'Factura' : 'Boleta'} ${d.numero}`
}

/** «OC-0001-MW», o «OC 12» si todavía no tiene número. */
const nombreDeLaOc = (b: CompraConBoleta) => b.numero ?? `OC ${b.referencia}`

/** La otra moneda: la de la factura que no es la de la OC. */
const laOtra = (m: CodigoMoneda): CodigoMoneda => (m === 'USD' ? 'PEN' : 'USD')

type Db = Awaited<ReturnType<typeof createClient>>

/** El día del último pago vigente de la OC: el cambio de ese día es el que propone «La factura lo toma al cambio». */
const diaDelUltimoPago = (b: CompraConBoleta) => b.pagos.filter((p) => !p.anulado_en).at(-1)?.fecha_pago ?? null

/**
 * Lo que las ventanas de la OC con boleta piden a la base, y solo para quien las
 * usa: las otras facturas del proveedor con saldo, donde descontar lo pagado de
 * más, y el cambio de venta del día del último pago, que propone «La factura lo
 * toma al cambio». Si no se pueden leer no se adivina: la página lo dice.
 */
async function paraLasVentanasDeLaBoleta(db: Db, boletas: CompraConBoleta[]) {
  const conDeMas = boletas.flatMap((b) => (b.id && Number(b.de_mas ?? 0) > 0 ? [b.id] : []))
  const dias = [...new Set(boletas.flatMap((b) => (b.otra_moneda && diaDelUltimoPago(b) ? [diaDelUltimoPago(b)!] : [])))]
  const [facturas, cambios] = await Promise.all([
    Promise.all(
      conDeMas.map(async (id) => {
        const { data, error } = await db.rpc('facturas_para_descontar', { p_compra: id })
        if (error) throw new Error(`No se pudieron leer las facturas del proveedor: ${error.message}`)
        const lista: FacturaParaDescontar[] = (data ?? []).flatMap((f) =>
          f.id && f.numero ? [{ id: f.id, numero: f.numero, moneda: codigoMoneda(f.moneda), fecha: f.fecha_emision, saldo: Number(f.saldo ?? 0) }] : [],
        )
        return [id, lista] as const
      }),
    ),
    Promise.all(
      dias.map(async (dia) => {
        const { data, error } = await db.rpc('cambio_del_dia', { p_fecha: dia, p_operacion: 'VENTA' })
        if (error) throw new Error(`No se pudo leer el tipo de cambio: ${error.message}`)
        // Sin el cambio de ese día (ni de los nueve anteriores) la base devuelve null.
        return [dia, Number(data) || null] as const
      }),
    ),
  ])
  return { descontables: new Map(facturas), cambios: new Map(cambios) }
}

/** La OC con boleta en las cifras de `pago-de-boleta`: lo que dicen en vivo las ventanas de la devolución y del pago. */
function boletaParaLaCuenta(b: CompraConBoleta): BoletaParaDevolver {
  return {
    total: Number(b.total ?? 0),
    neto: Number(b.pagado ?? 0),
    aplicado: Number(b.aplicado ?? 0),
    aMano: Number(b.a_mano ?? 0),
    aOtras: Number(b.a_otras ?? 0),
    factura: b.factura,
    facturaSaldo: Number(b.factura_saldo ?? 0),
    deMas: Number(b.de_mas ?? 0),
    sinTomar: Number(b.sin_tomar ?? 0),
    otraMoneda: Boolean(b.otra_moneda),
    otraFactura: b.otra_factura,
    sinCompletar: Boolean(b.sin_completar),
    enCamino: Boolean(b.comprobante_en_camino_origen),
    entera: Boolean(b.entera),
  }
}

/**
 * Lo que falta facturar de una OC con boleta cuyas facturas la cubren en parte:
 * el total menos lo que facturan (o, si es más, lo que tomaron de la boleta: la
 * factura en otra moneda no se convierte, y cuenta lo que tomó al cambio).
 */
function porFacturarDe(b: CompraConBoleta) {
  return Math.max(redondear(Number(b.total ?? 0) - Math.max(Number(b.facturado ?? 0), Number(b.aplicado ?? 0))), 0)
}

/** Lo que la factura de la compra tomó al cambio de los pagos vigentes, sumado: la factura, y cuánto en cada moneda. */
function loTomadoAlCambio(b: CompraConBoleta) {
  const tomas = b.pagos.filter((p) => !p.anulado_en).flatMap((p) => p.tomas.filter((t) => t.aMano && t.deLaCompra))
  if (tomas.length === 0) return null
  return {
    facturaId: tomas[0].facturaId,
    factura: tomas[0].factura,
    moneda: codigoMoneda(tomas[0].moneda),
    monto: redondear(tomas.reduce((s, t) => s + t.monto, 0)),
    deLaBoleta: redondear(tomas.reduce((s, t) => s + t.deLaBoleta, 0)),
  }
}

/**
 * Lo que dice la tarjeta de la OC con boleta cuando el proveedor entregó su
 * comprobante (migración 20261020210000). Registrada, la factura toma lo que
 * Tesorería pagó por la boleta: lo que le falte se paga por ella en «Facturas
 * por pagar»; si ya estaba pagada o es por menos, lo que no tomó se pagó de más,
 * y Tesorería registra la devolución o lo descuenta de otra factura del
 * proveedor. La factura en otra moneda no toma sola: Tesorería se lo pasa al
 * cambio. Nada de eso anula un pago (undécima vuelta). A quien no paga se le
 * dice quién lo hace, no se le pide. El número y los montos no se parten en el
 * teléfono.
 */
function avisoDelPago(b: CompraConBoleta, vigentes: number, paga: boolean, m: CodigoMoneda): ReactNode {
  const numero = (n: string | null) => <span className="whitespace-nowrap">{n}</span>
  const monto = (n: number, en: CodigoMoneda = m) => <span className="whitespace-nowrap">{moneda(n, en)}</span>
  const aLaFactura = (id: string | null, n: string | null) => (
    <a href={`#factura-${id}`} className="font-medium underline-offset-2 hover:underline">
      {numero(n)}
    </a>
  )
  if (anexoPorRevisar(b)) {
    // La factura es de otras OC y no alcanza para esta: el anexo está por revisar.
    const factura = <>Logística anexó a esta OC la factura {numero(b.comprobante_en_camino)}, que Contabilidad registró para otras OC y que no alcanza para esta</>
    return vigentes > 0 ? (
      <>
        {factura}: la factura no toma lo pagado por la boleta. Si el anexo fue por error, Logística lo anula en Adquisiciones; si la OC sí era parte
        de esa factura, no la pagues dos veces: pregúntale a Contabilidad.
      </>
    ) : (
      <>
        {factura}: no se paga por ella ni por su boleta mientras el anexo siga. Si fue por error, Logística lo anula en Adquisiciones y la OC se paga aquí.
      </>
    )
  }
  if (b.factura && vigentes > 0) {
    const factura = aLaFactura(b.factura_id, b.factura)
    const deMas = Number(b.de_mas ?? 0)
    const aplicado = Number(b.aplicado ?? 0)
    const devuelto = Number(b.devuelto ?? 0)
    if (deMas > 0) {
      return (
        <>
          Su factura {factura}, que llegó después, ya tenía pagos o es por menos:{' '}
          {aplicado > 0 ? <>tomó {monto(aplicado)} de lo pagado por la boleta y se pagaron</> : <>no tomó nada de lo pagado por la boleta, y se pagaron</>}{' '}
          {monto(deMas)} de más{devuelto > 0 && <>, después de los {monto(devuelto)} que ya devolvió</>}.{' '}
          {paga
            ? 'Pide al proveedor la devolución y, cuando la devuelva, regístrala con «Registrar devolución». Si te la descuenta en otra factura suya, usa «Lo descuenta de otra factura».'
            : 'Tesorería pide al proveedor la devolución.'}
        </>
      )
    }
    if (b.otra_moneda) {
      const otra = laOtra(m)
      return (
        <>
          Su factura {aLaFactura(b.otra_factura_id, b.otra_factura ?? b.factura)} va en {nombreMoneda(otra)}: no toma sola lo pagado por la boleta,
          porque el sistema no convierte, y no se paga encima. Quedan {monto(Number(b.sin_tomar ?? 0))} por pasar a ella.{' '}
          {paga
            ? 'Si el proveedor tomó ese pago a cuenta de la factura, usa «La factura lo toma al cambio» y paga solo lo que falte; si te lo devolvió, «Registrar devolución».'
            : 'Tesorería lo pasa a la factura al cambio, o registra la devolución.'}
        </>
      )
    }
    const alCambio = loTomadoAlCambio(b)
    const otraSaldo = Number(b.otra_saldo ?? 0)
    // Sus facturas la cubren en parte: falta facturar el total menos lo facturado. De eso, lo pagado por la boleta
    // que ninguna tomó lo tomará la que falta, y lo demás se paga por ella.
    const porFacturar = porFacturarDe(b)
    const sinTomar = Number(b.sin_tomar ?? 0)
    const tomara = Math.min(sinTomar, porFacturar)
    const loDemas = redondear(porFacturar - tomara)
    const sobra = redondear(sinTomar - tomara)
    const laQueFalta = (
      <>
        Falta la factura por el resto, {monto(porFacturar)}
        {tomara > 0 ? (
          <>
            : tomará los {monto(tomara)} pagados por la boleta que ninguna factura tomó{loDemas > 0 && <>, y lo demás, {monto(loDemas)}, se paga por ella</>}
          </>
        ) : (
          ', que se paga por ella cuando llegue'
        )}
        {sobra >= 1 && <>; lo que sobra, {monto(sobra)}, quedará pagado de más</>}.
      </>
    )
    if (alCambio) {
      const cambio = (
        <>
          ({monto(alCambio.deLaBoleta)} = {monto(alCambio.monto, alCambio.moneda)})
        </>
      )
      if (otraSaldo > 0) {
        return (
          <>
            Su factura {aLaFactura(alCambio.facturaId, alCambio.factura)}, en {nombreMoneda(alCambio.moneda)}, tomó al cambio lo pagado por la boleta {cambio}{' '}
            y le faltan {monto(otraSaldo, alCambio.moneda)}, que se pagan por ella en «Facturas por pagar».
          </>
        )
      }
      if (b.entera || porFacturar < 1) {
        return (
          <>
            Pagada por su factura {aLaFactura(alCambio.facturaId, alCambio.factura)}, que tomó al cambio lo pagado por la boleta {cambio}.
          </>
        )
      }
      return (
        <>
          Su factura {aLaFactura(alCambio.facturaId, alCambio.factura)} es por una parte de la OC y tomó al cambio lo suyo {cambio}. {laQueFalta}
        </>
      )
    }
    if (otraSaldo > 0 && b.otra_factura) {
      // Su factura en otra moneda no espera nada de la boleta (no quedó nada sin tomar): debe lo suyo.
      const otra = laOtra(m)
      return (
        <>
          Su factura {aLaFactura(b.otra_factura_id, b.otra_factura)}, en {nombreMoneda(otra)}, no tomó nada de lo pagado por la boleta y le faltan{' '}
          {monto(otraSaldo, otra)}, que se pagan por ella en «Facturas por pagar».
        </>
      )
    }
    const falta = Number(b.factura_saldo ?? 0)
    if (falta <= 0 && !b.entera && porFacturar >= 1) {
      return (
        <>
          Su factura {factura} es por una parte de la OC y ya tomó {monto(aplicado)} de lo pagado por la boleta. {laQueFalta}
        </>
      )
    }
    // Si lo pagado por la boleta se descontó en otra factura, esta se pagó aparte: la línea de lo descontado lo dice.
    if (falta <= 0) return aplicado > 0 ? <>Pagada por su factura {factura}, que tomó lo pagado por la boleta.</> : <>Pagada por su factura {factura}.</>
    // Un pago la dio por cancelada con menos: la diferencia es un descuento que la factura no trae.
    const sinCompletar = Boolean(b.sin_completar)
    return (
      <>
        Contabilidad registró su factura {factura}:{' '}
        {aplicado > 0 ? <>tomó {monto(aplicado)} de lo pagado por la boleta y le faltan</> : <>no tomó nada de lo pagado por la boleta y le faltan</>}{' '}
        {monto(falta)}, que se pagan por ella en «Facturas por pagar».
        {sinCompletar && (
          <>
            {' '}
            {paga ? 'Diste la OC por cancelada' : 'Tesorería la dio por cancelada'} con {monto(Number(b.pagado ?? 0))}: si el descuento sigue en pie,{' '}
            pide al proveedor la nota de crédito por {monto(falta)} y no {paga ? 'pagues' : 'paga'} esa diferencia.
          </>
        )}
        {/* Su factura es por una parte: lo que no factura espera la que falta. */}
        {!b.entera && porFacturar >= 1 && <> {laQueFalta}</>}
      </>
    )
  }
  if (!b.comprobante_en_camino) {
    // Sin factura, lo devuelto vuelve a deberse, salvo que Tesorería dijera al registrarlo que con lo que quedaba la
    // OC quedaba pagada (el proveedor cobró de más o entregó menos): entonces está cancelada y no llega aquí.
    const devuelto = Number(b.devuelto ?? 0)
    const saldo = saldoDeLaBoleta(b)
    if (b.factura || devuelto <= 0 || saldo <= 0) return null
    const neto = Number(b.pagado ?? 0)
    if (neto <= 0) {
      return paga ? (
        <>El proveedor ya devolvió todo lo que se pagó por su boleta: págala de nuevo solo si te la vuelve a cobrar.</>
      ) : (
        <>El proveedor ya devolvió todo lo que se pagó por su boleta: Tesorería la paga de nuevo solo si se la vuelve a cobrar.</>
      )
    }
    // Anular la devolución solo entra si sin ella lo pagado no pasa del total; con varias, la que decide es la última.
    const devoluciones = b.devoluciones.filter((d) => !d.anulado_en)
    const ultima = devoluciones.at(-1)
    const seAnula = ultima !== undefined && redondear(neto + Number(ultima.monto)) <= Number(b.total ?? 0)
    return paga ? (
      <>
        El proveedor devolvió {monto(devuelto)} de lo pagado y a la OC le faltan {monto(saldo)}, que se pagan aquí.
        {seAnula && (
          <>
            {' '}
            Si con lo que quedaba ya estaba pagada, anula {devoluciones.length > 1 ? 'la última devolución' : 'la devolución'} y regístrala de nuevo con «Sí,
            queda pagada».
          </>
        )}
      </>
    ) : (
      <>
        El proveedor devolvió {monto(devuelto)} de lo pagado y a la OC le faltan {monto(saldo)}: Tesorería paga lo que falta.
      </>
    )
  }
  const deLogistica = b.comprobante_en_camino_origen === 'LOGISTICA'
  const llego = deLogistica ? (
    <>El proveedor entregó la factura {numero(b.comprobante_en_camino)} y Logística la anexó a la OC</>
  ) : (
    <>Contabilidad tiene en borrador el comprobante {numero(b.comprobante_en_camino)} de esta OC</>
  )
  const lo = deLogistica ? 'la' : 'lo'
  return vigentes > 0 ? (
    <>
      {llego}: cuando Contabilidad {lo} registre, toma lo que ya se pagó por la boleta y solo se paga lo que falte, en «Facturas por pagar». Si es por
      menos, el sistema avisa lo pagado de más.
    </>
  ) : (
    <>
      {llego}: cuando Contabilidad {lo} registre, se paga en «Facturas por pagar».
    </>
  )
}

/**
 * Lo que dice la ventana «Anular el pago» de la OC con boleta cuando el pago no
 * salió: lo que la base va a hacer. Si su factura había tomado los pagos por la
 * boleta, los vuelve a repartir sin este; lo que una factura tomaba a mano de
 * él (al cambio, o descontado) se deshace y esa factura vuelve a deberlo. Sin
 * factura, la OC sigue pagada si otro pago la dio por cancelada o los otros
 * llegan al total.
 */
function queQuedaAlAnular(b: CompraConBoleta, pagoId: string, m: CodigoMoneda): string {
  const pago = b.pagos.find((p) => p.id === pagoId)
  const este = Number(pago?.monto ?? 0)
  const otros = b.pagos.filter((p) => !p.anulado_en && p.id !== pagoId)
  // Lo que tomaban a mano de este pago se deshace con él (`conciliar_pago_directo`).
  const aMano = (pago?.tomas ?? []).filter((t) => t.aMano)
  const deshace = aMano.map((t) =>
    t.deLaCompra
      ? `La factura ${t.factura} tomó a mano ${moneda(t.monto, codigoMoneda(t.moneda))} de este pago: deja de tomarlo y vuelve a deber eso.`
      : `Lo descontado de la factura ${t.factura} con este pago se deshace: vuelve a deber ${moneda(t.monto, codigoMoneda(t.moneda))}.`,
  )
  if (anexoPorRevisar(b)) {
    return `La factura ${b.comprobante_en_camino} anexada a esta OC, que Contabilidad registró para otras OC, no alcanza para ella: la OC vuelve a deber, y se paga por su boleta cuando Logística anule ese anexo.`
  }
  if (b.factura) {
    const queda = queQuedaSinElPago(boletaParaLaCuenta(b), este, pago?.tomas ?? [], m)
    return [queda, ...deshace].filter(Boolean).join(' ')
  }
  if (b.comprobante_en_camino) {
    return `La OC se paga por su comprobante ${b.comprobante_en_camino} en «Facturas por pagar» cuando Contabilidad lo registre${
      otros.length > 0 ? ': tomará lo que quede pagado por la boleta' : ''
    }.`
  }
  if (otros.some((p) => p.cancela_sin_completar)) return 'La OC sigue pagada: otro de sus pagos la dio por cancelada.'
  const total = Number(b.total ?? 0)
  const neto = redondear(Number(b.pagado ?? 0) - este)
  if (otros.length > 0 && neto >= total) return 'La OC sigue pagada: sus otros pagos cubren el total.'
  return `La OC vuelve a deber ${moneda(Math.max(total - neto, 0), m)}.`
}

const redondear = (n: number) => Math.round(n * 100) / 100

/** Lo que le pide a Tesorería algo que no es pagar: lo pagado de más, o la factura en otra moneda que espera lo pagado por la boleta. */
function pideAlgo(b: CompraConBoleta) {
  return Number(b.de_mas ?? 0) > 0 || Boolean(b.otra_moneda)
}

/** Logística le anexó una factura que Contabilidad registró para otras OC y no alcanza para esta: no la toma ni se paga por ella. */
function anexoPorRevisar(b: CompraConBoleta) {
  return b.comprobante_en_camino_origen === 'REGISTRADA' && b.comprobante_en_camino_alcanza === false
}

/**
 * Lo que la base diría de la OC sin factura si se anula esa devolución: si queda
 * cancelada sin llegar al total (`compras_con_boleta_por_pagar` lo trae para
 * cada devolución vigente). Con factura no cuenta: la factura dice cuánto se paga.
 */
function sinCompletarAlAnular(b: CompraConBoleta, devolucionId: string) {
  const mapa = b.sin_completar_al_anular
  return Boolean(mapa && typeof mapa === 'object' && !Array.isArray(mapa) && mapa[devolucionId] === true)
}

/**
 * Por qué la base no deja anular la devolución: sin ella, lo pagado por la boleta
 * pasaría de su total (por los pagos de después, o porque el total bajó). Null si entra.
 * Dice de cuánto tiene que ser la correcta para que entre; si es menor, se le pagó de más al proveedor
 * y la salida es registrar también la diferencia cuando la devuelva (un pago no se anula con una devolución vigente).
 */
function noSeAnulaLaDevolucion(b: CompraConBoleta, monto: number, m: CodigoMoneda): string | null {
  const sinElla = redondear(Number(b.pagado ?? 0) + monto)
  const total = Number(b.total ?? 0)
  if (sinElla <= total) return null
  return `No se puede anular todavía: sin ella, lo pagado por la boleta (${moneda(sinElla, m)}) pasaría de su total (${moneda(total, m)}). Si la registraste mal, registra primero la correcta, de ${moneda(redondear(sinElla - total), m)} o más, y después anula esta. Si lo que devolvió fue menos, al proveedor se le pagó de más: pídele la diferencia y, cuando entre, regístrala también; después anula esta.`
}

/** Lo que le falta pagar a una OC con boleta, sobre lo neto (lo pagado menos lo devuelto); una cancelada «a cuenta» ya no debe nada. */
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

/** Cómo se lee en la línea de un pago lo que una factura tomó de él: sola, al cambio o descontado. */
function textoDeLaToma(t: CompraConBoleta['pagos'][number]['tomas'][number], m: CodigoMoneda) {
  const enLaFactura = moneda(t.monto, codigoMoneda(t.moneda))
  const deLaBoleta = codigoMoneda(t.moneda) !== m ? ` (${moneda(t.deLaBoleta, m)})` : ''
  if (!t.aMano) return `tomado por la factura ${t.factura}: ${enLaFactura}`
  if (t.deLaCompra) return `tomado al cambio por ${t.factura}: ${enLaFactura}${deLaBoleta}`
  return `descontado en ${t.factura}: ${enLaFactura}${deLaBoleta}`
}

/** Una factura de compra: sus OC, el aviso de monto, lo pagado con cada voucher y el botón para pagar. */
function Factura({
  cuenta: c,
  paga,
  pasa,
  verOc,
  verCuentas,
  hoy,
  correcciones,
  cuentasCaja,
  cajas,
  esperaBoleta,
  nombresOc,
}: {
  cuenta: CuentaPorPagar
  paga: boolean
  /** Puede pasar a una factura lo pagado por la boleta, o deshacerlo. */
  pasa: boolean
  verOc: boolean
  verCuentas: boolean
  hoy: string
  correcciones: CorreccionVista[] | undefined
  cuentasCaja: CuentaParaPagar[]
  cajas: Map<string, CajaDelPago> | undefined
  /** La OC con boleta cuyo pago espera esta factura en otra moneda, si la hay. */
  esperaBoleta: CompraConBoleta | undefined
  nombresOc: Map<string, string>
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
  // Lo que Tesorería le pasó a mano de cada OC con boleta se deshace junto: el botón va en la última línea de esa OC.
  const aManoVigentes = c.pagos.filter((p) => p.monto_de_la_boleta !== null && !p.anulado_en && p.ordenCompraDeLaBoleta)
  const ultimaAMano = new Map(aManoVigentes.map((p) => [p.ordenCompraDeLaBoleta!, p.id]))
  const aManoDe = (oc: string) => redondear(aManoVigentes.filter((p) => p.ordenCompraDeLaBoleta === oc).reduce((s, p) => s + Number(p.monto), 0))
  // Tomaba de pagos por la boleta que se anularon por mal registrados: si ese dinero sí salió, se paga con el mismo
  // voucher, no con otro. Una sola nota con todo lo que tomaban. Lo que Tesorería registró en la factura después de
  // la primera anulación se descuenta, y cuando llega a lo que tomaban la nota ya no corre: lo que siga debiendo sí
  // se transfiere. Si la factura debía algo aparte de esas tomas (`deudaPropia`), no se sabe si lo registrado pagó
  // eso o lo que tomaban: la nota no da la cifra del resto, que podría pagarse dos veces.
  const tomasAnuladas = c.pagos
    .filter((p) => p.pago_orden_compra_id && p.anulado_en && p.motivo_anulacion?.startsWith('Se anuló el pago de la boleta'))
    .sort((a, b) => (a.anulado_en! < b.anulado_en! ? -1 : 1))
  const tomabaDeAnulados = redondear(tomasAnuladas.reduce((s, p) => s + Number(p.monto), 0))
  const primeraAnulacion = tomasAnuladas[0]?.anulado_en ?? null
  const sumar = (cumple: (q: CuentaPorPagar['pagos'][number]) => boolean) =>
    redondear(c.pagos.filter((q) => !q.anulado_en && cumple(q)).reduce((s, q) => s + Number(q.monto), 0))
  const registradoDespues = primeraAnulacion ? sumar((q) => !q.pago_orden_compra_id && q.creado_en > primeraAnulacion) : 0
  const deudaPropia = primeraAnulacion
    ? Math.max(
        redondear(Number(c.total) - tomabaDeAnulados - sumar((q) => Boolean(q.pago_orden_compra_id)) - sumar((q) => !q.pago_orden_compra_id && q.creado_en <= primeraAnulacion)),
        0,
      )
    : 0
  const faltaDeAnulados = saldo > 0 && registradoDespues < tomabaDeAnulados ? Math.min(redondear(tomabaDeAnulados - registradoDespues), saldo) : 0
  const mismoVoucher = tomasAnuladas.length > 1 ? 'esos mismos vouchers' : 'ese mismo voucher'
  const espera = saldo > 0 && esperaBoleta?.id ? esperaBoleta : null
  return (
    // El id es el ancla con que Adquisiciones salta a esta factura.
    <article id={`factura-${c.id}`} className="scroll-mt-20 rounded-[var(--radius-base)] border border-borde p-3 target:border-acento">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {/* Con un aviso largo, el monto sigue en su columna de la derecha. */}
        <div className="min-w-0 sm:flex-1">
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
          cuentas={saldo > 0 && !espera ? c.cuentasProveedor : []}
          monedaDocumento={m}
          sinCuentas={saldo > 0 && !espera ? sinCuentas(verCuentas, ordenes.length > 0) : null}
        />
        {paga &&
          faltaDeAnulados > 0.005 && (
            <p className="text-xs text-aviso">
              {tomasAnuladas.length === 1 ? (
                <>
                  Tomaba {moneda(tomasAnuladas[0].monto, m)} del pago por la boleta ({tomasAnuladas[0].referencia}), que se anuló.{' '}
                  {tomasAnuladas[0].motivo_anulacion}.
                </>
              ) : (
                <>
                  Tomaba {moneda(tomabaDeAnulados, m)} de {tomasAnuladas.length} pagos por la boleta que se anularon.{' '}
                  {[...new Set(tomasAnuladas.map((p) => p.motivo_anulacion))].filter(Boolean).join('. ')}.
                </>
              )}{' '}
              {registradoDespues <= 0 ? (
                <>Si ese dinero sí salió, no transfieras otra vez: registra aquí el pago con {mismoVoucher}.</>
              ) : deudaPropia > 0 ? (
                <>
                  Después se registraron {moneda(registradoDespues, m)} en esta factura. Si ese dinero sí salió, no lo transfieras otra vez: lo que
                  de él no esté entre lo registrado, regístralo aquí con {mismoVoucher}.
                </>
              ) : (
                <>
                  Después se registraron {moneda(registradoDespues, m)} en esta factura. Si el resto, {moneda(faltaDeAnulados, m)}, también salió, no
                  lo transfieras otra vez: regístralo aquí con {mismoVoucher}.
                </>
              )}
            </p>
          )}
        {espera ? (
          <p className="text-xs text-aviso">
            Espera lo pagado por la boleta de la <span className="whitespace-nowrap">{nombreDeLaOc(espera)}</span>:{' '}
            <span className="whitespace-nowrap">{moneda(Number(espera.sin_tomar ?? 0), codigoMoneda(espera.moneda))}</span> sin pasar a esta factura.{' '}
            {pasa ? (
              <>
                Primero, en{' '}
                <a href={`#compra-${espera.id}`} className="inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline sm:min-h-0">
                  su OC con boleta
                </a>
                , «La factura lo toma al cambio»; después se paga aquí lo que falte.
              </>
            ) : (
              'Tesorería lo pasa a la factura al cambio antes de pagarla.'
            )}
          </p>
        ) : (
          paga &&
          saldo > 0 &&
          c.id && (
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
          )
        )}
      </div>
      {c.pagos.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2">
          {c.pagos.map((p) => {
            const deLaBoleta = Boolean(p.pago_orden_compra_id)
            const aMano = p.monto_de_la_boleta !== null
            const otraMoneda = aMano && p.monedaDeLaBoleta !== null && codigoMoneda(p.monedaDeLaBoleta) !== m
            return (
              <li key={p.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="text-texto-suave">
                  <span className={p.anulado_en ? 'line-through' : undefined}>
                    {/* El que tomó del pago por la boleta lleva en la referencia de qué OC y de qué día es, y si fue al cambio o descontado. */}
                    Pago del {fecha(p.fecha)} · <span className="tabular text-texto">{moneda(p.monto, m)}</span>
                    {otraMoneda && ` (${moneda(Number(p.monto_de_la_boleta), codigoMoneda(p.monedaDeLaBoleta))} de la boleta)`} ·{' '}
                    {deLaBoleta ? p.referencia : `op. ${p.referencia}`}
                  </span>
                  {/* Fuera del tachado: que su egreso también se anuló es lo que se tiene que leer. El de la boleta movió la caja allá. */}
                  {!deLaBoleta && <CajaDeLaLinea cajas={cajas} id={p.id} tipo="pago" monedaDocumento={m} />}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {p.anulado_en && <span className="text-peligro">Anulado: {p.motivo_anulacion}</span>}
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0">
                      <FileText aria-hidden className="size-3.5" />
                      {/* El descuento lleva su nota de crédito (DKS, 2026-10-21); lo que tomó sola, el voucher de la boleta. */}
                      {deLaBoleta ? (p.esNota ? 'Nota de crédito o documento' : 'Voucher de la boleta') : 'Voucher'}
                    </a>
                  )}
                  {!p.archivo_ruta && !deLaBoleta && !p.anulado_en && <span>sin voucher (anotado antes)</span>}
                  {/* Lo anota el sistema o Tesorería desde la OC: el pago es de la boleta, y ahí se ve. */}
                  {deLaBoleta && !p.anulado_en && p.ordenCompraDeLaBoleta && (
                    <a href={`#compra-${p.ordenCompraDeLaBoleta}`} className="inline-flex min-h-11 items-center text-acento hover:underline sm:min-h-0">
                      {p.referencia?.startsWith('Descontado de lo pagado de más')
                        ? `Lo pagado de más de la ${nombresOc.get(p.ordenCompraDeLaBoleta) ?? 'OC con boleta'}`
                        : 'Lo pagó su OC con boleta'}
                    </a>
                  )}
                  {pasa && aMano && !p.anulado_en && p.ordenCompraDeLaBoleta && ultimaAMano.get(p.ordenCompraDeLaBoleta) === p.id && c.id && (
                    <SoltarToma
                      ordenCompraId={p.ordenCompraDeLaBoleta}
                      facturaId={c.id}
                      factura={c.numero_documento ?? 'esta'}
                      oc={nombresOc.get(p.ordenCompraDeLaBoleta) ?? 'OC'}
                      monto={moneda(aManoDe(p.ordenCompraDeLaBoleta), m)}
                    />
                  )}
                  {paga && !p.anulado_en && !deLaBoleta && <AnularPagoFactura pagoId={p.id} />}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </article>
  )
}

/**
 * Una OC con boleta: el PDF de la OC, la boleta que adjuntó Logística (o que
 * todavía falta), las cuentas del proveedor, lo pagado con cada voucher y lo
 * que cada factura tomó de él, lo que el proveedor devolvió con su constancia,
 * y los botones de pagar, registrar la devolución y pasar lo pagado a una factura.
 */
function CompraConBoletaFila({
  compra: b,
  paga,
  pasa,
  verOc,
  verCuentas,
  hoy,
  cuentasCaja,
  cajas,
  cajasDevolucion,
  descontables,
  cambios,
}: {
  compra: CompraConBoleta
  paga: boolean
  pasa: boolean
  verOc: boolean
  verCuentas: boolean
  hoy: string
  cuentasCaja: CuentaParaPagar[]
  cajas: Map<string, CajaDelPago> | undefined
  cajasDevolucion: Map<string, CajaDelPago> | undefined
  /** Las otras facturas del proveedor con saldo; solo se leen con algo pagado de más. */
  descontables: FacturaParaDescontar[] | undefined
  /** El cambio de venta de cada día, para proponerlo al pasar lo pagado a la factura en otra moneda. */
  cambios: Map<string, number | null>
}) {
  if (!b.id) return null
  const m = codigoMoneda(b.moneda)
  const saldo = saldoDeLaBoleta(b)
  // `pagado` ya es lo neto: los pagos vigentes menos lo que el proveedor devolvió.
  const neto = Number(b.pagado ?? 0)
  const devuelto = Number(b.devuelto ?? 0)
  const nombre = nombreDeLaOc(b)
  const documentos: DocumentoParaPagar[] = [
    ...(verOc ? [{ clave: 'oc', etiqueta: `PDF de la ${nombre}`, url: pdfDeLaOc(b.id), descarga: true }] : []),
    ...b.comprobantes.map((d) => ({ clave: d.id, etiqueta: etiquetaDelComprobante(d), url: d.url })),
  ]
  const sinBoleta = !b.comprobantes.some((d) => d.tipo === 'COMPROBANTE')
  // El proveedor entregó su comprobante, o Contabilidad ya registró su factura: se paga por ella, no aquí.
  const enCamino = Boolean(b.comprobante_en_camino)
  const conFactura = Boolean(b.factura)
  const vigentes = b.pagos.filter((p) => !p.anulado_en)
  const devolucionesVigentes = b.devoluciones.filter((d) => !d.anulado_en).length
  const aviso = avisoDelPago(b, vigentes.length, paga, m)
  const cobra = saldo > 0 && !enCamino && !conFactura
  const deMas = Number(b.de_mas ?? 0)
  const falta = Number(b.factura_saldo ?? 0)
  const aOtras = Number(b.a_otras ?? 0)
  const otraSaldo = Number(b.otra_saldo ?? 0)
  // Sus facturas la cubren en parte y les falta la otra: lo que tomaron no llega al total.
  const esperaOtra = conFactura && !b.entera && porFacturarDe(b) >= 1
  const boleta = boletaParaLaCuenta(b)
  // Lo que el proveedor puede devolver: lo neto, menos lo que una factura tomó a mano.
  const puedeDevolver = paga && topeDeLaDevolucion(boleta) > 0
  // La factura que tomó a mano lo pagado: se deshace ahí antes de registrar una devolución.
  const tomaAMano = b.pagos.filter((p) => !p.anulado_en).flatMap((p) => p.tomas.filter((t) => t.aMano))[0]
  const tomadoAMano = tomaAMano ? { facturaId: tomaAMano.facturaId, factura: tomaAMano.factura } : null
  const diaDelCambio = diaDelUltimoPago(b)
  const otraFactura =
    pasa && b.otra_moneda && b.otra_factura_id && b.otra_factura
      ? { id: b.otra_factura_id, numero: b.otra_factura, moneda: laOtra(m), saldo: otraSaldo }
      : null
  // Solo uno de sus pagos la canceló, el que dice la base; con su comprobante o su factura, la cancela la factura.
  const cancela = b.cancelada && !enCamino && !conFactura ? b.pago_que_cancela : null
  const condicion = b.condicion_pago === 'CREDITO' ? `crédito a ${b.dias_credito ?? 0} días` : 'contado'
  const devuelta = devueltaEntera(b)
  const insignia: { tono: 'exito' | 'aviso' | 'peligro' | 'neutro'; texto: string } | null = anexoPorRevisar(b)
    ? { tono: 'aviso', texto: 'Anexo por revisar' }
    : deMas > 0
      ? { tono: 'peligro', texto: 'Pagada de más' }
      : b.otra_moneda
        ? { tono: 'aviso', texto: 'Factura en otra moneda' }
        : conFactura
          ? falta > 0 || otraSaldo > 0
            ? { tono: 'aviso', texto: 'Se paga por su factura' }
            : esperaOtra
              ? { tono: 'aviso', texto: 'Espera otra factura' }
              : { tono: 'exito', texto: 'Pagada por su factura' }
          : enCamino
            ? { tono: 'aviso', texto: b.comprobante_en_camino_origen === 'LOGISTICA' ? 'Llegó factura' : 'En Contabilidad' }
            : b.cancelada
              ? { tono: 'exito', texto: 'Pagada' }
              : devuelta
                ? { tono: 'neutro', texto: 'Devuelta' }
                : neto > 0
                ? { tono: 'aviso', texto: 'Pagada en parte' }
                : null
  const enLaFactura = anexoPorRevisar(b) ? (
    'No se paga hasta revisar el anexo'
  ) : !conFactura ? (
    'Se paga por su comprobante'
  ) : b.otra_moneda ? (
    <>
      Quedan <span className="whitespace-nowrap">{moneda(Number(b.sin_tomar ?? 0), m)}</span> por pasar a su factura
    </>
  ) : falta > 0 ? (
    <>
      A su factura le faltan <span className="whitespace-nowrap">{moneda(falta, m)}</span>
    </>
  ) : otraSaldo > 0 ? (
    <>
      A su factura le faltan <span className="whitespace-nowrap">{moneda(otraSaldo, laOtra(m))}</span>
    </>
  ) : esperaOtra ? (
    'Espera la factura que falta'
  ) : (
    'Pagada por su factura'
  )
  return (
    <article
      id={`compra-${b.id}`}
      data-devuelta={devuelta || undefined}
      className="scroll-mt-20 rounded-[var(--radius-base)] border border-borde p-3 target:border-acento"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 sm:flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-texto">
              {b.proveedor} · <span className="tabular whitespace-nowrap">{nombre}</span>
            </span>
            {insignia && <Insignia tono={insignia.tono}>{insignia.texto}</Insignia>}
            {b.sin_precio && <Insignia tono="aviso">Líneas sin precio</Insignia>}
          </p>
          <p className="text-xs text-texto-suave">
            {enCamino || conFactura ? 'Iba con boleta' : 'Boleta'} · {condicion}
            {b.codigo_interno && ` · ${b.codigo_interno}`}
            {!enCamino &&
              !conFactura &&
              (b.cancelada ? (
                ` · Pagada el ${fecha(b.ultimo_pago)}`
              ) : devuelta ? (
                ` · Devuelta el ${fecha(b.devoluciones.filter((d) => !d.anulado_en).at(-1)?.fecha)}`
              ) : (
                <>
                  {' '}
                  · <Vencimiento dia={b.vence} saldo={saldo} />
                </>
              ))}
          </p>
          {aviso ? (
            <p className={`text-xs ${deMas > 0 ? 'text-peligro' : 'text-aviso'}`}>{aviso}</p>
          ) : (
            sinBoleta &&
            !b.cancelada && <p className="text-xs text-texto-suave">Falta la boleta: Logística la adjunta en la OC cuando el proveedor la entregue.</p>
          )}
          {aOtras > 0 && b.a_otras_facturas && (
            <p className="text-xs text-texto-suave">
              <span className="whitespace-nowrap">{moneda(aOtras, m)}</span> de lo pagado de más se descontaron de la factura {b.a_otras_facturas}, en
              «Facturas por pagar».
            </p>
          )}
          {b.estuvo_en_factura && (
            <p className="text-xs text-aviso">
              Estuvo en la factura {b.estuvo_en_factura}, que ya tiene un pago, hasta que una corrección la sacó: mira ese pago antes de pagarla aquí.
            </p>
          )}
          {b.sin_precio && <p className="text-xs text-aviso">Logística tiene que completar los precios antes del pago.</p>}
        </div>
        {/* La que espera su comprobante o ya tiene su factura no debe aquí: se paga por ella, con su IGV, en las facturas. */}
        <div className="sm:text-right">
          {enCamino || conFactura ? (
            <>
              <p className="tabular text-sm font-semibold text-texto">
                Total <span className="whitespace-nowrap">{moneda(b.total ?? 0, m)}</span>
              </p>
              <p className="tabular text-xs text-texto-suave">
                {enLaFactura}
                {neto + devuelto > 0 && (
                  <>
                    {' · pagado por la boleta '}
                    <span className="whitespace-nowrap">{moneda(redondear(neto + devuelto), m)}</span>
                  </>
                )}
                {devuelto > 0 && (
                  <>
                    {' · devuelto '}
                    <span className="whitespace-nowrap">{moneda(devuelto, m)}</span>
                  </>
                )}
              </p>
              {deMas > 0 && (
                <p className="tabular text-xs font-medium text-peligro">
                  Pagado de más <span className="whitespace-nowrap">{moneda(deMas, m)}</span>
                </p>
              )}
            </>
          ) : devuelta ? (
            // No se le debe: sin «Saldo», que la hacía parecer una deuda.
            <>
              <p className="tabular text-sm font-semibold text-texto">
                Total <span className="whitespace-nowrap">{moneda(b.total ?? 0, m)}</span>
              </p>
              <p className="tabular text-xs text-texto-suave">
                Pagado <span className="whitespace-nowrap">{moneda(redondear(neto + devuelto), m)}</span>
                {' · devuelto '}
                <span className="whitespace-nowrap">{moneda(devuelto, m)}</span>
              </p>
            </>
          ) : (
            <>
              <p className="tabular text-sm font-semibold text-texto">
                {saldo > 0 && 'Saldo '}
                <span className="whitespace-nowrap">{moneda(saldo > 0 ? saldo : (b.total ?? 0), m)}</span>
              </p>
              <p className="tabular text-xs text-texto-suave">
                Total <span className="whitespace-nowrap">{moneda(b.total ?? 0, m)}</span>
                {neto > 0 && saldo > 0 && (
                  <>
                    {' · pagado '}
                    <span className="whitespace-nowrap">{moneda(neto, m)}</span>
                  </>
                )}
                {devuelto > 0 && (
                  <>
                    {' · devuelto '}
                    <span className="whitespace-nowrap">{moneda(devuelto, m)}</span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        <ParaPagar
          documentos={documentos}
          cuentas={cobra ? b.cuentasProveedor : []}
          monedaDocumento={m}
          sinCuentas={cobra ? sinCuentas(verCuentas, true) : null}
        />
        {(paga && cobra && !b.sin_precio) || puedeDevolver || otraFactura || (pasa && deMas > 0) ? (
          <div className="flex flex-wrap items-center gap-2">
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
                principal={!devuelta}
              />
            )}
            {otraFactura && (
              <TomarAlCambio
                ordenCompraId={b.id}
                numero={nombre}
                proveedor={b.proveedor ?? ''}
                factura={otraFactura}
                sinTomar={Number(b.sin_tomar ?? 0)}
                monedaOc={m}
                cambio={diaDelCambio ? (cambios.get(diaDelCambio) ?? null) : null}
                diaDelCambio={diaDelCambio}
              />
            )}
            {puedeDevolver && (
              <RegistrarDevolucion
                ordenCompraId={b.id}
                numero={nombre}
                proveedor={b.proveedor ?? ''}
                hoy={hoy}
                desde={vigentes[0]?.fecha_pago ?? null}
                boleta={boleta}
                codigoMoneda={m}
                cuentas={cuentasCaja}
                principal={deMas > 0}
              />
            )}
            {pasa && deMas > 0 && (
              <DescontarDeOtraFactura ordenCompraId={b.id} numero={nombre} proveedor={b.proveedor ?? ''} deMas={deMas} monedaOc={m} facturas={descontables ?? []} />
            )}
          </div>
        ) : null}
      </div>
      {(b.pagos.length > 0 || b.devoluciones.length > 0) && (
        <ol className="mt-2 space-y-1.5 border-t border-borde pt-2">
          {b.pagos.map((p) => (
            <li key={p.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="text-texto-suave">
                <span className={p.anulado_en ? 'line-through' : undefined}>
                  Pago del {fecha(p.fecha_pago)} · <span className="tabular text-texto">{moneda(p.monto, m)}</span>
                  {p.operacion && ` · op. ${p.operacion}`}
                  {p.comprobante_proveedor && ` · boleta ${p.comprobante_proveedor}`}
                  {/* El que la canceló, y solo ese: con dos que «cancelan», uno llegó primero. */}
                  {p.id === cancela && ' · cancela la OC'}
                </span>
                {/* Fuera del tachado: que su egreso también se anuló es lo que se tiene que leer. */}
                <CajaDeLaLinea cajas={cajas} id={p.id} tipo="pago" monedaDocumento={m} />
                {/* Qué factura tomó este pago, y cuánto: sola, al cambio o descontado en otra. */}
                {!p.anulado_en && p.tomas.length > 0 && <span className="block">{p.tomas.map((t) => textoDeLaToma(t, m)).join(' · ')}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {p.anulado_en && <span className="text-peligro">Anulado: {p.motivo_anulacion}</span>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0">
                    <FileText aria-hidden className="size-3.5" />
                    Voucher
                  </a>
                )}
                {/* Con una devolución vigente, la base no deja anular el pago: lo que salió y volvió se anula en ese orden. */}
                {paga && !p.anulado_en && devolucionesVigentes > 0 && <span>Para anularlo, anula antes la devolución.</span>}
                {paga && !p.anulado_en && devolucionesVigentes === 0 && (
                  <AnularPagoCompra
                    pagoId={p.id}
                    compraId={b.id!}
                    etiqueta={`el pago del ${fecha(p.fecha_pago)} por ${moneda(p.monto, m)}`}
                    queQueda={queQuedaAlAnular(b, p.id, m)}
                    puedeDevolver={puedeDevolver}
                    alCambio={otraFactura ? { factura: otraFactura.numero, moneda: nombreMoneda(otraFactura.moneda) } : null}
                    tomadoAMano={tomadoAMano}
                  />
                )}
              </span>
            </li>
          ))}
          {b.devoluciones.map((d) => (
            <li key={d.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between" data-devolucion={d.id}>
              <span className="text-texto-suave">
                <span className={d.anulado_en ? 'line-through' : undefined}>
                  Devolución del {fecha(d.fecha)} · <span className="tabular text-texto">{moneda(d.monto, m)}</span>
                  {d.operacion && ` · op. ${d.operacion}`}
                  {/* Lo que Tesorería dijo al registrarla: con lo que quedaba, la OC quedó pagada. */}
                  {d.deja_pagada && ' · con lo que quedaba, la OC quedó pagada'}
                </span>
                {/* Fuera del tachado, como en el pago: que su ingreso también se anuló es lo que se lee. */}
                <CajaDeLaLinea cajas={cajasDevolucion} id={d.id} tipo="devolucion" monedaDocumento={m} />
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {d.anulado_en && <span className="text-peligro">Anulada: {d.motivo_anulacion}</span>}
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-acento hover:underline sm:min-h-0">
                    <FileText aria-hidden className="size-3.5" />
                    Constancia
                  </a>
                )}
                {paga && !d.anulado_en && (
                  <AnularDevolucion
                    devolucionId={d.id}
                    etiqueta={`la devolución del ${fecha(d.fecha)} por ${moneda(d.monto, m)}`}
                    queQueda={queQuedaTrasLaDevolucion({ ...boleta, sinCompletar: sinCompletarAlAnular(b, d.id) }, Number(d.monto), m)}
                    noSeAnula={noSeAnulaLaDevolucion(b, Number(d.monto), m)}
                  />
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

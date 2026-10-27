import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { CajaDeLaLinea } from '@/components/finanzas/caja-del-pago'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cajaDeLosPagos, cuentasParaPagar, type CajaDelPago } from '@/lib/datos/caja'
import { recibosParaTesoreria, type ReciboParaPagar } from '@/lib/datos/subcontratos'
import type { CuentaParaPagar } from '@/lib/dominio/caja'
import { resumenPorMoneda } from '@/lib/dominio/finanzas'
import { fecha, fechaHora, hoyLima, moneda, porcentajeCorto } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { EnlaceArchivo } from '../../subcontratos/enlace-archivo'
import { AnularPago, PagarRecibo } from './controles'

export const metadata = { title: 'Recibos por honorarios' }

/**
 * La bandeja de Tesorería: los recibos por honorarios que Administración subió
 * contra sus subcontratos. Tesorería paga el neto a la cuenta del
 * subcontratista y adjunta el voucher; Gerencia y Contabilidad lo consultan.
 */
export default async function PaginaRecibosPorHonorarios({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const perfil = await exigirPermiso(['subcontratos.pagar', 'subcontratos.ver', 'subcontratos.gestionar'])
  // Paga quien lleva la caja: el pago sale de una de sus cuentas (la base pide los dos permisos).
  const paga = puede(perfil, 'subcontratos.pagar') && puede(perfil, 'tesoreria.caja')
  const params = await searchParams
  const ver = params.ver === 'pagados' ? 'pagados' : 'por-pagar'

  const [recibos, cuentasCaja] = await Promise.all([
    recibosParaTesoreria(),
    // La cuenta de la que sale cada pago: la caja diaria se mueve sola (20261019100000).
    paga ? cuentasParaPagar() : Promise.resolve([]),
  ])
  // Para quien lleva la caja, de qué cuenta salió cada pago.
  const cajas = puede(perfil, 'tesoreria.caja')
    ? await cajaDeLosPagos('PAGO_RECIBO_HONORARIOS', recibos.flatMap((r) => r.pagos.map((p) => p.id)))
    : undefined
  const pagoDe = (r: ReciboParaPagar) => r.pagos.find((p) => !p.anulado_en) ?? null
  // Los por pagar, del más viejo, el más atrasado, al más nuevo.
  const porPagar = recibos
    .filter((r) => !pagoDe(r))
    .sort((a, b) => a.fecha_emision.localeCompare(b.fecha_emision) || a.creado_en.localeCompare(b.creado_en))
  // Los pagados, del pago más reciente al más viejo.
  const pagados = recibos
    .filter((r) => pagoDe(r))
    .sort((a, b) => (pagoDe(b)?.fecha_pago ?? '').localeCompare(pagoDe(a)?.fecha_pago ?? '') || b.creado_en.localeCompare(a.creado_en))
  const resumen = resumenPorMoneda(porPagar.map((r) => ({ moneda: r.moneda, monto: r.monto_neto })), ['recibo', 'recibos'])
  const lista = ver === 'pagados' ? pagados : porPagar
  const hoy = hoyLima()

  return (
    <AvisoDeLaCaja>
      <EncabezadoPagina
        titulo="Recibos por honorarios"
        // Una línea, como en las otras bandejas de Tesorería: el recuadro amarillo
        // que había aquí repetía la cuenta de la pestaña y se leía como alarma.
        descripcion={resumen && <span data-total-por-pagar>Por pagar: {resumen}, por su neto.</span>}
        ayuda={
          paga
            ? 'Los recibos de los subcontratos que sube Administración. Paga el neto —el bruto menos la retención, si la lleva— a la cuenta del subcontratista y adjunta el voucher: Administración lo ve en el subcontrato.'
            : 'Los recibos de los subcontratos, con su retención y lo que Tesorería pagó.'
        }
        migas={[{ titulo: 'Tesorería' }, { titulo: 'Recibos por honorarios' }]}
      />

      <PastillaFiltro
        ruta="/tesoreria/recibos-por-honorarios"
        clave="ver"
        etiqueta="Qué ver"
        opciones={[
          { valor: null, etiqueta: `Por pagar (${porPagar.length})` },
          { valor: 'pagados', etiqueta: `Pagados (${pagados.length})` },
        ]}
        params={params}
        activo={ver === 'pagados' ? 'pagados' : null}
        className="mb-4"
      />

      <Tarjeta className="overflow-hidden">
        {lista.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="font-medium text-texto">{ver === 'pagados' ? 'Todavía no hay recibos pagados' : 'No hay recibos por pagar'}</p>
            <p className="mt-1 text-sm text-texto-suave">
              {ver === 'pagados'
                ? 'Cuando registres un pago con su voucher, aparece aquí.'
                : 'Cuando Administración suba un recibo por honorarios, llega el aviso y aparece aquí.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-borde">
            {lista.map((r) => (
              <Fila key={r.id} r={r} paga={paga} hoy={hoy} cuentasCaja={cuentasCaja} cajas={cajas} />
            ))}
          </ul>
        )}
      </Tarjeta>
    </AvisoDeLaCaja>
  )
}

function Fila({
  r,
  paga,
  hoy,
  cuentasCaja,
  cajas,
}: {
  r: ReciboParaPagar
  paga: boolean
  hoy: string
  cuentasCaja: CuentaParaPagar[]
  cajas: Map<string, CajaDelPago> | undefined
}) {
  const pago = r.pagos.find((p) => !p.anulado_en) ?? null
  const sub = r.subcontratista
  const sc = r.subcontrato
  return (
    <li className="space-y-2 px-4 py-3" data-recibo={r.numero}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-texto">{sub?.nombre ?? 'Subcontratista'}</p>
          <p className="text-xs text-texto-suave">
            Recibo <span className="tabular text-texto">{r.numero}</span> del {fecha(r.fecha_emision)}
            {sub && <span className="tabular"> · RUC {sub.ruc}</span>}
          </p>
          {sc && (
            <p className="text-xs text-texto-suave">
              <Link href={`/subcontratos/${sc.id}`} className="tabular text-acento hover:underline">
                {sc.numero}
              </Link>{' '}
              · <span className="tabular font-medium text-texto" data-codigo>{sc.codigo_interno}</span>
              {r.concepto && ` · ${r.concepto}`}
            </p>
          )}
          <p className="mt-1 text-xs text-texto" data-cuenta>
            {sub?.numero_cuenta || sub?.cci ? (
              <>
                {sub.banco}
                {sub.numero_cuenta && (
                  <>
                    {' · '}
                    <span className="tabular">{sub.numero_cuenta}</span>
                  </>
                )}
                {sub.cci && <span className="tabular text-texto-suave"> · CCI {sub.cci}</span>}
              </>
            ) : (
              <span className="text-aviso">Sin cuenta registrada: pídela a Administración</span>
            )}
          </p>
        </div>
        {/* En el teléfono baja bajo el subcontratista, alineada a la izquierda como el resto. */}
        <div className="sm:text-right">
          <p className="tabular text-base font-semibold text-texto">{moneda(r.monto_neto, r.moneda)}</p>
          <p className="text-[11px] text-texto-suave">
            bruto <span className="tabular">{moneda(r.monto_bruto, r.moneda)}</span>
            {r.retencion_porcentaje > 0 ? (
              <>
                {' '}
                − retención del {porcentajeCorto(r.retencion_porcentaje)} <span className="tabular">{moneda(r.retencion_monto, r.moneda)}</span>
              </>
            ) : (
              ' · sin retención'
            )}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {pago ? <Insignia tono="exito">Pagado el {fecha(pago.fecha_pago)}</Insignia> : <Insignia tono="aviso">Por pagar</Insignia>}
        <EnlaceArchivo enlace={r.enlace} texto="Recibo" />
        {pago && (
          <>
            <EnlaceArchivo enlace={pago.enlace} texto="Voucher" />
            {pago.operacion && <span className="tabular text-texto-suave">Op. {pago.operacion}</span>}
            {cajas && (
              <span className="text-texto-suave">
                <CajaDeLaLinea cajas={cajas} id={pago.id} tipo="pago" monedaDocumento={r.moneda === 'USD' ? 'USD' : 'PEN'} sola />
              </span>
            )}
          </>
        )}
        {paga && !pago && (
          <PagarRecibo
            hoy={hoy}
            cuentas={cuentasCaja}
            recibo={{
              id: r.id,
              numero: r.numero,
              subcontratoId: sc?.id ?? '',
              subcontratista: sub?.nombre ?? 'Subcontratista',
              fechaEmision: r.fecha_emision,
              neto: r.monto_neto,
              moneda: r.moneda,
            }}
          />
        )}
        {paga && pago && sc && <AnularPago pagoId={pago.id} subcontratoId={sc.id} numero={r.numero} />}
      </div>
      {r.pagos
        .filter((p) => p.anulado_en)
        .map((p) => (
          <p key={p.id} className="text-xs text-texto-suave">
            Pago del {fecha(p.fecha_pago)} anulado el {fechaHora(p.anulado_en)}: {p.motivo_anulacion}
            <CajaDeLaLinea cajas={cajas} id={p.id} tipo="pago" monedaDocumento={r.moneda === 'USD' ? 'USD' : 'PEN'} />
          </p>
        ))}
    </li>
  )
}

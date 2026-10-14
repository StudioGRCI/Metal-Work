import { FileText, HandCoins } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { solicitudesPendientesTesoreria } from '@/lib/datos/costos-ot'
import { cuentasPorCobrar, type CuentaPorCobrar } from '@/lib/datos/facturacion'
import { fecha, hoyLima, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { Movimiento } from '../formularios'
import { SolicitudesOT } from '../solicitudes-ot'
import { codigoMoneda, Vencimiento } from '../vencimiento'

export const metadata = { title: 'Cuentas por cobrar' }

/**
 * Las facturas que Contabilidad envió a Tesorería (migración 20261015120000):
 * cada una nace aquí con su cliente, su OT, su cotización y el PDF. Tesorería
 * registra lo que entra hasta dejar el saldo en cero. Las que se anotaron a
 * mano antes de este circuito siguen aquí, sin PDF.
 */
export default async function PaginaPorCobrar() {
  const perfil = await exigirPermiso('tesoreria.ver_documentos')
  const cobra = puede(perfil, 'tesoreria.registrar_cobros')
  const responde = puede(perfil, 'tesoreria.liberar')
  const [cuentas, solicitudes] = await Promise.all([
    cuentasPorCobrar(),
    responde ? solicitudesPendientesTesoreria() : Promise.resolve([]),
  ])
  const hoy = hoyLima()
  const pendientes = cuentas.filter((c) => Number(c.saldo) > 0)
  const cobradas = cuentas.filter((c) => Number(c.saldo) <= 0)
  const saldoPor = (m: 'PEN' | 'USD') => pendientes.filter((c) => codigoMoneda(c.moneda) === m).reduce((n, c) => n + Number(c.saldo), 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Cuentas por cobrar"
        descripcion="Las facturas que te envió Contabilidad, de la que vence antes a la que vence después. Registra cada cobro con su referencia bancaria."
      />

      {pendientes.length > 0 && (
        <p className="mb-4 text-sm text-texto-suave">
          Por cobrar:{' '}
          {(['PEN', 'USD'] as const)
            .filter((m) => saldoPor(m) > 0)
            .map((m) => moneda(saldoPor(m), m))
            .join(' y ')}{' '}
          en {pendientes.length} {pendientes.length === 1 ? 'factura' : 'facturas'}.
        </p>
      )}

      {solicitudes.length > 0 && <SolicitudesOT solicitudes={solicitudes} />}

      <Tarjeta>
        <TarjetaCabecera titulo="Por cobrar" descripcion="Cada factura con su saldo; lo vencido sale en rojo." />
        <TarjetaCuerpo className="space-y-3">
          {pendientes.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="rounded-full bg-acento-suave p-3 text-acento">
                <HandCoins aria-hidden className="size-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-texto">No hay facturas por cobrar</p>
              <p className="mt-1 max-w-lg text-sm text-texto-suave">
                Contabilidad te las envía desde Facturación cuando emite la factura de una OT. Te llega un aviso con cada una.
              </p>
            </div>
          ) : (
            pendientes.map((c) => <Cuenta key={c.id} cuenta={c} cobra={cobra} hoy={hoy} />)
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {cobradas.length > 0 && (
        <details className="mt-5 rounded-[var(--radius-base)] border border-borde bg-superficie">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-texto">
            Cobradas ({cobradas.length})
          </summary>
          <div className="space-y-3 border-t border-borde p-4">
            {cobradas.map((c) => (
              <Cuenta key={c.id} cuenta={c} cobra={false} hoy={hoy} />
            ))}
          </div>
        </details>
      )}
    </>
  )
}

function Cuenta({ cuenta: c, cobra, hoy }: { cuenta: CuentaPorCobrar; cobra: boolean; hoy: string }) {
  const m = codigoMoneda(c.moneda)
  const saldo = Number(c.saldo)
  return (
    // Con `id`: el aviso de la campana aterriza en esta factura (`#id`).
    <article
      id={c.factura_venta_id ?? c.id ?? undefined}
      className="scroll-mt-20 rounded-[var(--radius-base)] border border-borde p-3 target:border-acento"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-medium text-texto">
          <span className="tabular">Factura {c.numero_documento}</span>
          {c.cliente && <span className="font-normal"> · {c.cliente}</span>}
        </p>
        <p className="tabular text-sm font-semibold text-texto">{saldo > 0 ? `Saldo ${moneda(saldo, m)}` : 'Cobrada'}</p>
      </div>
      <p className="mt-0.5 text-xs text-texto-suave">
        {c.orden_id ? (
          <Link href={`/ordenes/${c.orden_id}`} className="text-acento hover:underline">
            OT {c.numero_ot}
          </Link>
        ) : (
          'Sin OT'
        )}
        {c.cotizacion_numero && ` · cotización ${c.cotizacion_numero}`}
        {c.concepto && ` · ${c.concepto}`}
      </p>
      <p className="mt-0.5 text-xs text-texto-suave">
        <Vencimiento dia={c.fecha_vencimiento} saldo={saldo} /> · emitida el {fecha(c.fecha_emision)} · total{' '}
        <span className="tabular">{moneda(c.total, m)}</span>
        {Number(c.cobrado) > 0 && (
          <>
            {' '}
            · cobrado <span className="tabular">{moneda(c.cobrado, m)}</span>
          </>
        )}
      </p>
      {c.url && (
        <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0">
          <FileText aria-hidden className="size-4" />
          Abrir la factura
        </a>
      )}
      {c.cobros.length > 0 && (
        <ol className="mt-2 space-y-0.5 border-t border-borde pt-2 text-xs text-texto-suave">
          {c.cobros.map((b) => (
            <li key={b.id}>
              Cobro del {fecha(b.fecha)} · <span className="tabular text-texto">{moneda(b.monto, m)}</span> · {b.referencia}
            </li>
          ))}
        </ol>
      )}
      {cobra && saldo > 0 && c.id && <Movimiento id={c.id} tipo="cobro" saldo={saldo} hoy={hoy} />}
    </article>
  )
}

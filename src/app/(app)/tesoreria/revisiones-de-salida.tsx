'use client'

import Link from 'next/link'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { RevisionPendiente } from '@/lib/datos/vehiculos'
import { useEnvio } from '@/lib/envio'
import { nombreMoneda } from '@/lib/dominio/caja'
import { fechaHora, moneda, parteDe, porcentaje, type CodigoMoneda } from '@/lib/format'

import { responderRevisionSalida } from '../vehiculos/acciones-ficha'

/** Lo facturado y cobrado del código que sale: con eso se decide si puede salir. */
export type CobroDelCodigo = {
  total: number | null
  facturado: number
  cobrado: number
  moneda: CodigoMoneda
  /** Cuántas cotizaciones aprobadas suma el código. */
  cotizaciones: number
  /** El código tiene cotizaciones en monedas distintas: lo de arriba es solo de la primera moneda. */
  monedasDistintas: boolean
  /**
   * Lo facturado y cobrado en la otra moneda que la cotización (20261126960000): no se suma a lo
   * de arriba ni se compara con el total. Null si todas las facturas van en la moneda de la cotización.
   */
  otraMoneda: { facturado: number; cobrado: number } | null
}

/** Lo que falta cobrar de las facturas registradas del código, por moneda: lo ve quien no lee las cotizaciones. */
export type PorCobrarDelCodigo = {
  saldo: Record<CodigoMoneda, number>
  /** Las facturas registradas del código, sin las anuladas. */
  facturas: number
  /** Cuántas de ellas tienen saldo por cobrar. */
  conSaldo: number
}

/**
 * Los vehículos que Requerimientos quiere entregar y esperan la revisión de
 * Tesorería: cada pedido trae el código interno, lo que hay que revisar y el
 * escaneo firmado de la ficha de salida. Reemplaza, para los vehículos, la
 * revisión de salida que se pedía desde la OT (migración 20261016110000).
 */
export function RevisionesDeSalida({
  revisiones,
  paraTi,
  cobros,
  porCobrarDeFacturas,
  abreVehiculos,
}: {
  revisiones: RevisionPendiente[]
  paraTi: boolean
  /** Por código interno: lo facturado y lo cobrado de su cotización. Null para quien no lee las cotizaciones aprobadas. */
  cobros: Record<string, CobroDelCodigo> | null
  /** Para quien no lee las cotizaciones: lo que falta cobrar de las facturas de cada código con saldo. */
  porCobrarDeFacturas: Record<string, PorCobrarDelCodigo>
  /** Si quien mira puede abrir la ficha del vehículo; si no, el enlace terminaba en «No tienes acceso». */
  abreVehiculos: boolean
}) {
  return (
    <Tarjeta className="mb-5" id="salidas-por-revisar">
      <TarjetaCabecera
        titulo="Salidas de vehículos por revisar"
        ayuda={
          paraTi
            ? 'Requerimientos pide tu revisión antes de entregar un vehículo. Si queda revisada, puede salir; si la observas, Requerimientos ve tu respuesta y vuelve a pedirla.'
            : 'Requerimientos le pide a Tesorería la revisión antes de entregar un vehículo; el aviso le llega a Tesorería. Si queda revisada, puede salir; si se observa, Requerimientos ve la respuesta y vuelve a pedirla.'
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {revisiones.map((v) => (
          <RevisionPorResponder
            key={v.id}
            revision={v}
            cobro={v.codigo_interno && cobros ? cobros[v.codigo_interno] : undefined}
            veCobros={cobros !== null}
            porCobrar={v.codigo_interno ? porCobrarDeFacturas[v.codigo_interno] : undefined}
            abreVehiculos={abreVehiculos}
          />
        ))}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function RevisionPorResponder({
  revision: v,
  cobro,
  veCobros,
  porCobrar: deFacturas,
  abreVehiculos,
}: {
  revision: RevisionPendiente
  cobro?: CobroDelCodigo
  /** Si quien mira lee lo cobrado de los códigos; si no, no se le dice que el código no tiene cotización. */
  veCobros: boolean
  porCobrar?: PorCobrarDelCodigo
  abreVehiculos: boolean
}) {
  const { alEnviar, enviando, error, resultado } = useEnvio(responderRevisionSalida, undefined, { documento: v.id })
  // Con facturas en la otra moneda, lo que falta es solo de la moneda de la cotización, y así se dice.
  const porCobrar = cobro?.total === null || cobro === undefined ? null : Math.max(0, cobro.total - cobro.cobrado)
  const otra = cobro?.otraMoneda ?? null
  const mOtra: CodigoMoneda = cobro?.moneda === 'USD' ? 'PEN' : 'USD'
  return (
    <article className="rounded-[var(--radius-base)] border border-borde p-4" data-revision={v.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-texto">
            <span className="tabular">{v.vehiculo}</span>
            {v.codigo_interno && <span className="font-normal text-texto-suave"> · Código {v.codigo_interno}</span>}
          </p>
          <p className="text-xs text-texto-suave">
            {[v.unidad, v.empresa].filter(Boolean).join(' · ')}
            {v.ingreso_en && ` · entró ${fechaHora(v.ingreso_en)}`}
          </p>
        </div>
        <span className="flex flex-wrap gap-3 text-sm">
          {v.escaneo ? (
            <a href={v.escaneo} target="_blank" rel="noreferrer" className="text-acento hover:underline">
              Ver ficha firmada
            </a>
          ) : (
            <span className="text-texto-suave">La ficha firmada no se pudo abrir ahora</span>
          )}
          {abreVehiculos && (
            <Link href={`/vehiculos/${v.registro_id}#revision-salida`} className="text-acento hover:underline">
              Abrir el vehículo
            </Link>
          )}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-texto">{v.concepto}</p>
      {/* Lo que hay que mirar para decidir, sin ir a otra pantalla: la auditoría del 27/10/2026 halló que la tarjeta pedía revisar el saldo y no lo traía. */}
      {cobro && (
        <p className="mt-1 tabular text-xs text-texto-suave" data-cobro-del-codigo>
          {cobro.total === null ? (
            'La cotización del código no tiene total registrado.'
          ) : cobro.facturado === 0 && !otra ? (
            <>
              Cotización de <span className="text-texto">{moneda(cobro.total, cobro.moneda)}</span>: Contabilidad todavía no la factura y no hay nada cobrado.
            </>
          ) : cobro.facturado === 0 && otra ? (
            // Facturada solo en la otra moneda: decir «no la factura» era falso, y la tarjeta decide si el vehículo sale.
            <>
              {cobro.cotizaciones > 1 ? `Las ${cobro.cotizaciones} cotizaciones, que suman` : 'Cotización de'}{' '}
              <span className="text-texto">{moneda(cobro.total, cobro.moneda)}</span>
              {cobro.monedasDistintas && ' sin las de otra moneda'}, {cobro.cotizaciones > 1 ? 'facturadas' : 'facturada'} en{' '}
              <span data-otra-moneda>
                {nombreMoneda(mOtra)}: <span className="font-medium text-texto">{moneda(otra.facturado, mOtra)}</span> · cobrado{' '}
                <span className="font-medium text-texto">{moneda(otra.cobrado, mOtra)}</span>
              </span>
              . Para ver si está cancelada, cuéntalo con el tipo de cambio.
            </>
          ) : (
            <>
              Cobrado <span className="font-medium text-texto">{moneda(cobro.cobrado, cobro.moneda)}</span>
              {parteDe(cobro.cobrado, cobro.total) !== null && ` · ${porcentaje(parteDe(cobro.cobrado, cobro.total))}`}
              {cobro.cotizaciones > 1 ? ` de las ${cobro.cotizaciones} cotizaciones, que suman` : ' de la cotización de'}{' '}
              {moneda(cobro.total, cobro.moneda)}
              {cobro.monedasDistintas && ' (las de otra moneda no se suman aquí)'}
              {porCobrar !== null && porCobrar > 0.005 && (
                <>
                  {' '}
                  · falta <span className="text-aviso">{moneda(porCobrar, cobro.moneda)}</span>
                  {otra && ` sin contar lo de ${nombreMoneda(mOtra)}`}
                </>
              )}
              {otra && (
                <span data-otra-moneda>
                  {' '}
                  · y en {nombreMoneda(mOtra)}: facturado <span className="font-medium text-texto">{moneda(otra.facturado, mOtra)}</span> · cobrado{' '}
                  <span className="font-medium text-texto">{moneda(otra.cobrado, mOtra)}</span>. Para ver si está cancelada, cuéntalo con el tipo de cambio.
                </span>
              )}
            </>
          )}
        </p>
      )}
      {!cobro && veCobros && v.codigo_interno && (
        <p className="mt-1 text-xs text-texto-suave" data-cobro-del-codigo>
          Este código no tiene cotización aprobada: no hay cobro que revisar aquí.
        </p>
      )}
      {/* Sin leer la cotización no se sabe cuánto falta facturar, pero sí lo que falta cobrar de lo facturado: con la tarjeta muda se liberaba a ciegas. */}
      {!veCobros && v.codigo_interno && (
        <p className="mt-1 tabular text-xs text-texto-suave" data-por-cobrar-de-facturas>
          {!deFacturas || deFacturas.facturas === 0 ? (
            // Sin facturas no hay nada cobrado: decir «no tienen saldo» se leía como cobrado.
            'Este código no tiene facturas registradas: pregúntale a Tesorería si falta facturar.'
          ) : deFacturas.conSaldo > 0 ? (
            <>
              Por cobrar en {deFacturas.conSaldo === 1 ? '1 factura' : `${deFacturas.conSaldo} facturas`}:{' '}
              {(['PEN', 'USD'] as const)
                .filter((m) => deFacturas.saldo[m] > 0)
                .map((m, i) => (
                  <span key={m}>
                    {i > 0 && ' y '}
                    <span className="whitespace-nowrap font-medium text-aviso">{moneda(deFacturas.saldo[m], m)}</span>
                  </span>
                ))}
              . Lo que falta facturar de la cotización lo ve Tesorería.
            </>
          ) : (
            `${deFacturas.facturas === 1 ? 'Su factura registrada ya está cobrada' : `Sus ${deFacturas.facturas} facturas registradas ya están cobradas`}. Lo que falta facturar de la cotización lo ve Tesorería.`
          )}
        </p>
      )}
      <p className="mt-1 text-xs text-texto-suave">
        {fechaHora(v.creado_en)} · {v.solicitante ?? 'Requerimientos'}
      </p>
      <form onSubmit={alEnviar} className="mt-3 grid gap-3 border-t border-borde pt-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
        <input type="hidden" name="id" value={v.id} />
        <Campo etiqueta="Resultado" htmlFor={`salida-estado-${v.id}`} requerido>
          {/* Sin opción marcada: venía en «puede salir» y un toque sin leer dejaba salir el vehículo (27/10/2026). */}
          <Seleccion id={`salida-estado-${v.id}`} name="estado" defaultValue="" required>
            <option value="" disabled>
              Elige el resultado…
            </option>
            <option value="ATENDIDA">Revisada: puede salir</option>
            <option value="OBSERVADA">Observada</option>
          </Seleccion>
        </Campo>
        <Campo etiqueta="Respuesta a Requerimientos" htmlFor={`salida-respuesta-${v.id}`} requerido>
          <AreaTexto
            id={`salida-respuesta-${v.id}`}
            name="respuesta"
            rows={2}
            minLength={3}
            maxLength={2000}
            required
            placeholder="Indica el comprobante o lo que falta"
          />
        </Campo>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Responder
        </Boton>
        {error && (
          <p role="alert" className="text-sm text-peligro sm:col-span-3">
            {error}
          </p>
        )}
        {resultado?.ok && (
          <p role="status" className="text-sm text-exito sm:col-span-3">
            {resultado.mensaje}
          </p>
        )}
      </form>
    </article>
  )
}

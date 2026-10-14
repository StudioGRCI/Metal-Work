'use client'

import { Ban, Wallet } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import { BUCKET_PAGOS_FACTURAS, BUCKET_PAGOS_SERVICIO, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import { useEnvio } from '@/lib/envio'
import { moneda, type CodigoMoneda } from '@/lib/format'

import { anularPagoFactura, anularPagoServicio, registrarCobro, registrarPagoFactura, registrarPagoServicio } from './acciones'

/**
 * Un cobro de una factura de venta: fecha, importe y referencia bancaria. Los
 * pagos de las facturas de compra van con su voucher, en `PagarFactura`.
 */
export function Movimiento({ id, tipo, saldo, hoy }: { id: string; tipo: 'cobro'; saldo: number; hoy: string }) {
  const { alEnviar, enviando, error, resultado } = useEnvio(registrarCobro)
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-acento sm:min-h-0">Registrar {tipo}</summary>
      <form onSubmit={alEnviar} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <input type="hidden" name="id" value={id} />
        <Campo etiqueta="Fecha" htmlFor={`${tipo}-fecha-${id}`} requerido>
          <Entrada id={`${tipo}-fecha-${id}`} type="date" name="fecha" required defaultValue={hoy} max={hoy} />
        </Campo>
        <Campo etiqueta="Importe" htmlFor={`${tipo}-monto-${id}`} requerido>
          <Entrada id={`${tipo}-monto-${id}`} type="number" inputMode="decimal" min="0.01" max={saldo} step="0.01" name="monto" required className="tabular" />
        </Campo>
        <Campo etiqueta="Referencia bancaria" htmlFor={`${tipo}-ref-${id}`} requerido>
          <Entrada id={`${tipo}-ref-${id}`} name="referencia" minLength={3} maxLength={120} required autoComplete="off" />
        </Campo>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Guardar {tipo}
        </Boton>
        {error && (
          <p role="alert" className="text-xs text-peligro sm:col-span-4">
            {error}
          </p>
        )}
        {resultado?.ok && (
          <p role="status" className="text-xs text-exito sm:col-span-4">
            {resultado.mensaje}
          </p>
        )}
      </form>
    </details>
  )
}

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/**
 * Tesorería paga una orden de servicio: el día, lo pagado, si cancela la orden
 * o es a cuenta, el número de operación, el comprobante del proveedor y el
 * voucher. El voucher sube primero a Storage y, si el pago no entra, se retira.
 * El id del pago se decide al abrir la ventana: un reintento no registra otro.
 */
export function PagarServicio({
  ordenServicioId,
  numero,
  proveedor,
  hoy,
  saldo,
  codigoMoneda,
}: {
  ordenServicioId: string
  numero: string
  proveedor: string
  hoy: string
  saldo: number
  codigoMoneda: CodigoMoneda
}) {
  const [pagoId, setPagoId] = useState<string | null>(null)

  async function pagar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el comprobante del pago.' }
    if (!pagoId) return { ok: false, error: 'Vuelve a abrir el formulario del pago.' }
    return subirArchivoFinanzas(BUCKET_PAGOS_SERVICIO, ordenServicioId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarPagoServicio(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(pagar, () => setPagoId(null))
  const campo = (nombre: string) => `${nombre}-${ordenServicioId}`

  return (
    <>
      <Boton type="button" tamano="sm" onClick={() => setPagoId(crypto.randomUUID())} data-pagar-servicio={numero}>
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={pagoId !== null}
        alCerrar={() => setPagoId(null)}
        titulo={`Pago de la ${numero}`}
        descripcion={`${proveedor}. Falta pagar ${moneda(saldo, codigoMoneda)} del monto aprobado.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId ?? ''} />
          <input type="hidden" name="orden_servicio_id" value={ordenServicioId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del pago" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha_pago" type="date" required defaultValue={hoy} max={hoy} />
            </Campo>
            <Campo etiqueta={`Importe pagado (${codigoMoneda === 'USD' ? 'dólares' : 'soles'})`} htmlFor={campo('monto')} requerido>
              <Entrada
                id={campo('monto')}
                name="monto"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                defaultValue={saldo > 0 ? saldo.toFixed(2) : undefined}
                className="tabular"
              />
            </Campo>
            <Campo etiqueta="¿Cancela la orden de servicio?" htmlFor={campo('cancela')} requerido ayuda="«A cuenta» si todavía falta pagarle al proveedor.">
              <Seleccion id={campo('cancela')} name="cancela" defaultValue="si">
                <option value="si">Sí, queda pagada</option>
                <option value="no">No, es a cuenta</option>
              </Seleccion>
            </Campo>
            <Campo etiqueta="N.º de operación" htmlFor={campo('operacion')} ayuda="El que da el banco, si lo hay.">
              <Entrada id={campo('operacion')} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
            </Campo>
            <Campo etiqueta="Factura o recibo del proveedor" htmlFor={campo('comprobante')} ayuda="Su número, si ya lo entregó: E001-45.">
              <Entrada id={campo('comprobante')} name="comprobante" maxLength={30} autoComplete="off" className="tabular uppercase" />
            </Campo>
          </div>
          <Campo etiqueta="Voucher o constancia del pago" htmlFor={campo('archivo')} requerido ayuda={`PDF o foto, hasta ${MAXIMO_MB_FINANZAS} MB.`}>
            <Entrada id={campo('archivo')} name="archivo" type="file" accept={ACEPTA} required />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setPagoId(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Registrar el pago
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Anular con su motivo un pago de servicio mal registrado: la orden vuelve a quedar por pagar. */
export function AnularPagoServicio({ pagoId }: { pagoId: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularPagoServicio, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setAbierta(true)} data-anular-pago-servicio={pagoId}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular el pago"
        descripcion="Queda en el historial con su motivo y su voucher; la orden de servicio vuelve a quedar por pagar."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-pago-servicio-${pagoId}`} requerido>
            <AreaTexto id={`anular-pago-servicio-${pagoId}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/**
 * Tesorería paga una factura de compra con su voucher: el día, lo pagado y el
 * número de operación. El voucher sube primero a Storage y, si el pago no entra,
 * se retira. El id del pago se decide al abrir la ventana: un reintento no
 * registra otro.
 */
export function PagarFactura({
  adquisicionId,
  numero,
  proveedor,
  hoy,
  saldo,
  codigoMoneda,
}: {
  adquisicionId: string
  numero: string
  proveedor: string
  hoy: string
  saldo: number
  codigoMoneda: CodigoMoneda
}) {
  const [pagoId, setPagoId] = useState<string | null>(null)

  async function pagar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el voucher del pago.' }
    if (!pagoId) return { ok: false, error: 'Vuelve a abrir el formulario del pago.' }
    return subirArchivoFinanzas(BUCKET_PAGOS_FACTURAS, adquisicionId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarPagoFactura(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(pagar, () => setPagoId(null))
  const campo = (nombre: string) => `${nombre}-${adquisicionId}`

  return (
    <>
      <Boton type="button" tamano="sm" onClick={() => setPagoId(crypto.randomUUID())} data-pagar-factura={numero}>
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={pagoId !== null}
        alCerrar={() => setPagoId(null)}
        titulo={`Pago de la factura ${numero}`}
        descripcion={`${proveedor}. Falta pagar ${moneda(saldo, codigoMoneda)}.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId ?? ''} />
          <input type="hidden" name="adquisicion_id" value={adquisicionId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del pago" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha" type="date" required defaultValue={hoy} max={hoy} />
            </Campo>
            <Campo etiqueta={`Importe pagado (${codigoMoneda === 'USD' ? 'dólares' : 'soles'})`} htmlFor={campo('monto')} requerido>
              <Entrada
                id={campo('monto')}
                name="monto"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={saldo > 0 ? saldo.toFixed(2) : undefined}
                step="0.01"
                required
                defaultValue={saldo > 0 ? saldo.toFixed(2) : undefined}
                className="tabular"
              />
            </Campo>
            <Campo etiqueta="N.º de operación" htmlFor={campo('referencia')} requerido ayuda="El que da el banco en la constancia.">
              <Entrada id={campo('referencia')} name="referencia" minLength={3} maxLength={120} required autoComplete="off" className="tabular" />
            </Campo>
          </div>
          <Campo etiqueta="Voucher o constancia del pago" htmlFor={campo('archivo')} requerido ayuda={`PDF o foto, hasta ${MAXIMO_MB_FINANZAS} MB.`}>
            <Entrada id={campo('archivo')} name="archivo" type="file" accept={ACEPTA} required />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setPagoId(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Registrar el pago
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Anular con su motivo un pago de factura mal registrado: la factura vuelve a su saldo. */
export function AnularPagoFactura({ pagoId }: { pagoId: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularPagoFactura, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setAbierta(true)} data-anular-pago-factura={pagoId}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular el pago"
        descripcion="Queda en el historial con su motivo y su voucher; la factura vuelve a su saldo."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-pago-factura-${pagoId}`} requerido>
            <AreaTexto id={`anular-pago-factura-${pagoId}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

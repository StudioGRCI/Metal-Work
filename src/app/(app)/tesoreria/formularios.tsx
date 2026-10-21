'use client'

import { ArrowLeftRight, Ban, HandCoins, Undo2, Wallet } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useAvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { CuentaDeLaCaja, SinCuentasEnLaCaja } from '@/components/finanzas/cuenta-de-la-caja'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import type { CuentaParaPagar } from '@/lib/dominio/caja'
import { BUCKET_COBROS_VENTA, BUCKET_PAGOS_COMPRAS, BUCKET_PAGOS_FACTURAS, BUCKET_PAGOS_SERVICIO, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import { useEnvio } from '@/lib/envio'
import { moneda, type CodigoMoneda } from '@/lib/format'

import {
  anularCobroFactura,
  anularPagoCompra,
  anularPagoFactura,
  anularPagoServicio,
  pasarCompraATesoreria,
  registrarCobroFactura,
  registrarPagoCompra,
  registrarPagoFactura,
  registrarPagoServicio,
} from './acciones'
import { abrirVentanaDeLaBoleta } from './formularios-boleta'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/** El proveedor como frase: «S.A.C.» ya trae su punto y no lleva otro. */
function conPunto(proveedor: string) {
  const texto = proveedor.trim()
  return texto.endsWith('.') ? texto : `${texto}.`
}

/** El monto en una sola línea: el espacio después de «S/» no se parte en el teléfono. */
function montoEntero(valor: number, codigoMoneda: CodigoMoneda) {
  return moneda(valor, codigoMoneda).replace(' ', '\u00a0')
}

/**
 * Tesorería registra un cobro de una factura de venta: el día, lo cobrado, si
 * con él la factura queda cancelada, el número de operación, la cuenta de la
 * caja a la que entró —la caja diaria se mueve sola— y el voucher. El voucher
 * sube primero a Storage, en la carpeta de la factura, y si el cobro no entra
 * se retira. El id del cobro se decide al abrir la ventana: un
 * reintento no registra otro.
 */
export function CobrarFactura({
  facturaId,
  numero,
  cliente,
  hoy,
  saldo,
  codigoMoneda,
  cuentas,
}: {
  facturaId: string
  numero: string
  cliente: string
  hoy: string
  saldo: number
  codigoMoneda: CodigoMoneda
  cuentas: CuentaParaPagar[]
}) {
  const [cobroId, setCobroId] = useState<string | null>(null)
  // El día escrito decide qué se dice de la cuenta (antes de su inicio, o cerrada).
  const [dia, setDia] = useState(hoy)
  // A qué cuenta entró, o por qué la caja no se movió: lo dice la página, porque este botón desaparece si la factura queda cobrada.
  const avisar = useAvisoDeLaCaja()

  async function cobrar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el voucher del cobro.' }
    if (!cobroId) return { ok: false, error: 'Vuelve a abrir el formulario del cobro.' }
    return subirArchivoFinanzas(BUCKET_COBROS_VENTA, facturaId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarCobroFactura(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(cobrar, (r) => {
    setCobroId(null)
    avisar(r.mensaje ?? null)
  })
  const campo = (nombre: string) => `${nombre}-cobro-${facturaId}`

  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          avisar(null)
          setDia(hoy)
          setCobroId(crypto.randomUUID())
        }}
        data-cobrar-factura={numero}
      >
        <HandCoins aria-hidden className="size-4" />
        Registrar cobro
      </Boton>
      <Ventana
        abierta={cobroId !== null}
        alCerrar={() => setCobroId(null)}
        titulo={`Cobro de la factura ${numero}`}
        descripcion={`${cliente}. Le quedan ${moneda(saldo, codigoMoneda)} por cobrar.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <SinCuentasEnLaCaja cuentas={cuentas} tipo="cobro" />
          <input type="hidden" name="id" value={cobroId ?? ''} />
          <input type="hidden" name="factura_id" value={facturaId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del cobro" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha" type="date" required value={dia} onChange={(e) => setDia(e.target.value)} max={hoy} />
            </Campo>
            <Campo etiqueta={`Importe cobrado (${codigoMoneda === 'USD' ? 'dólares' : 'soles'})`} htmlFor={campo('monto')} requerido>
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
            <Campo
              etiqueta="¿Con este cobro queda cancelada?"
              htmlFor={campo('cancela')}
              requerido
              ayuda="«Sí» aunque falte la detracción o la retención; si llega al total, se cancela sola."
            >
              <Seleccion id={campo('cancela')} name="cancela" defaultValue="no">
                <option value="no">No, es a cuenta</option>
                <option value="si">Sí, queda cobrada</option>
              </Seleccion>
            </Campo>
            <Campo etiqueta="N.º de operación" htmlFor={campo('operacion')} ayuda="El que da el banco, si lo hay.">
              <Entrada id={campo('operacion')} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
            </Campo>
            <CuentaDeLaCaja cuentas={cuentas} monedaDocumento={codigoMoneda} tipo="cobro" dia={dia} prefijo={`cobro-${facturaId}`} />
          </div>
          <Campo etiqueta="Voucher o constancia del depósito" htmlFor={campo('archivo')} requerido ayuda={`PDF o foto, hasta ${MAXIMO_MB_FINANZAS} MB.`}>
            <Entrada id={campo('archivo')} name="archivo" type="file" accept={ACEPTA} required />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setCobroId(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando} disabled={cuentas.length === 0}>
              Registrar el cobro
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Anular con su motivo un cobro mal registrado: la factura vuelve a su saldo. */
export function AnularCobro({ cobroId }: { cobroId: string }) {
  const [abierta, setAbierta] = useState(false)
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error } = useEnvio(anularCobroFactura, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setAbierta(true)} data-anular-cobro={cobroId}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular el cobro"
        descripcion="Queda en el historial con su motivo y su voucher. La factura vuelve a su saldo y la caja diaria anula su ingreso."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={cobroId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-cobro-${cobroId}`} requerido>
            <AreaTexto id={`anular-cobro-${cobroId}`} name="motivo" required minLength={10} maxLength={500} />
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
 * Tesorería paga una orden de servicio: el día, lo pagado, si cancela la orden
 * o es a cuenta, el número de operación, el comprobante del proveedor, la cuenta
 * de la caja de la que salió —la caja diaria se mueve sola— y el voucher. El
 * voucher sube primero a Storage y, si el pago no entra, se retira.
 * El id del pago se decide al abrir la ventana: un reintento no registra otro.
 */
export function PagarServicio({
  ordenServicioId,
  numero,
  proveedor,
  hoy,
  saldo,
  codigoMoneda,
  cuentas,
  paraPagar,
}: {
  ordenServicioId: string
  numero: string
  proveedor: string
  hoy: string
  saldo: number
  codigoMoneda: CodigoMoneda
  cuentas: CuentaParaPagar[]
  /** Los documentos de la OS y las cuentas del proveedor, a la vista mientras se paga. */
  paraPagar?: ReactNode
}) {
  const [pagoId, setPagoId] = useState<string | null>(null)
  // El día escrito decide qué se dice de la cuenta (antes de su inicio, o cerrada).
  const [dia, setDia] = useState(hoy)
  // De qué cuenta salió, o por qué la caja no se movió: lo dice la página, porque este botón desaparece si el pago cancela el documento.
  const avisar = useAvisoDeLaCaja()

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
  const { alEnviar, enviando, error } = useEnvio(pagar, (r) => {
    setPagoId(null)
    avisar(r.mensaje ?? null)
  })
  const campo = (nombre: string) => `${nombre}-${ordenServicioId}`

  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          avisar(null)
          setDia(hoy)
          setPagoId(crypto.randomUUID())
        }}
        data-pagar-servicio={numero}
      >
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={pagoId !== null}
        alCerrar={() => setPagoId(null)}
        titulo={`Pago de la ${numero}`}
        descripcion={`${conPunto(proveedor)} Falta pagar ${montoEntero(saldo, codigoMoneda)} del monto aprobado.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <SinCuentasEnLaCaja cuentas={cuentas} tipo="pago" />
          {paraPagar}
          <input type="hidden" name="id" value={pagoId ?? ''} />
          <input type="hidden" name="orden_servicio_id" value={ordenServicioId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del pago" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha_pago" type="date" required value={dia} onChange={(e) => setDia(e.target.value)} max={hoy} />
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
            <CuentaDeLaCaja cuentas={cuentas} monedaDocumento={codigoMoneda} tipo="pago" dia={dia} prefijo={`servicio-${ordenServicioId}`} />
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
            <Boton type="submit" cargando={enviando} disabled={cuentas.length === 0}>
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
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error } = useEnvio(anularPagoServicio, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
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
        descripcion="Queda en el historial con su motivo y su voucher. La orden de servicio vuelve a quedar por pagar y la caja diaria anula su egreso."
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
 * Tesorería paga una factura de compra con su voucher: el día, lo pagado, el
 * número de operación y la cuenta de la caja de la que salió —la caja diaria se
 * mueve sola—. El voucher sube primero a Storage y, si el pago no entra,
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
  cuentas,
  paraPagar,
}: {
  adquisicionId: string
  numero: string
  proveedor: string
  hoy: string
  saldo: number
  codigoMoneda: CodigoMoneda
  cuentas: CuentaParaPagar[]
  /** La factura, sus OC y las cuentas del proveedor, a la vista mientras se paga. */
  paraPagar?: ReactNode
}) {
  const [pagoId, setPagoId] = useState<string | null>(null)
  // El día escrito decide qué se dice de la cuenta (antes de su inicio, o cerrada).
  const [dia, setDia] = useState(hoy)
  // De qué cuenta salió, o por qué la caja no se movió: lo dice la página, porque este botón desaparece si el pago cancela el documento.
  const avisar = useAvisoDeLaCaja()

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
  const { alEnviar, enviando, error } = useEnvio(pagar, (r) => {
    setPagoId(null)
    avisar(r.mensaje ?? null)
  })
  const campo = (nombre: string) => `${nombre}-${adquisicionId}`

  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          avisar(null)
          setDia(hoy)
          setPagoId(crypto.randomUUID())
        }}
        data-pagar-factura={numero}
      >
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={pagoId !== null}
        alCerrar={() => setPagoId(null)}
        titulo={`Pago de la factura ${numero}`}
        descripcion={`${conPunto(proveedor)} Falta pagar ${montoEntero(saldo, codigoMoneda)}.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <SinCuentasEnLaCaja cuentas={cuentas} tipo="pago" />
          {paraPagar}
          <input type="hidden" name="id" value={pagoId ?? ''} />
          <input type="hidden" name="adquisicion_id" value={adquisicionId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del pago" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha" type="date" required value={dia} onChange={(e) => setDia(e.target.value)} max={hoy} />
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
            <CuentaDeLaCaja cuentas={cuentas} monedaDocumento={codigoMoneda} tipo="pago" dia={dia} prefijo={`factura-${adquisicionId}`} />
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
            <Boton type="submit" cargando={enviando} disabled={cuentas.length === 0}>
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
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error } = useEnvio(anularPagoFactura, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
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
        descripcion="Queda en el historial con su motivo y su voucher. La factura vuelve a su saldo y la caja diaria anula su egreso."
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

/**
 * Tesorería paga una OC con boleta directo, como una OS (migración
 * 20261020210000): el día, lo pagado, si la cancela o es a cuenta, el número de
 * operación, el de la boleta si ya la entregaron, la cuenta de la caja de la que
 * salió y el voucher. El voucher sube primero a `pagos-compras/{oc}/…`.
 * El id del pago se decide al abrir la ventana: un reintento no registra otro.
 */
export function PagarCompra({
  ordenCompraId,
  numero,
  proveedor,
  hoy,
  saldo,
  codigoMoneda,
  cuentas,
  paraPagar,
}: {
  ordenCompraId: string
  numero: string
  proveedor: string
  hoy: string
  saldo: number
  codigoMoneda: CodigoMoneda
  cuentas: CuentaParaPagar[]
  /** El PDF de la OC, su boleta y las cuentas del proveedor, a la vista mientras se paga. */
  paraPagar?: ReactNode
}) {
  const [pagoId, setPagoId] = useState<string | null>(null)
  // El día escrito decide qué se dice de la cuenta (antes de su inicio, o cerrada).
  const [dia, setDia] = useState(hoy)
  // De qué cuenta salió, o por qué la caja no se movió: lo dice la página, porque este botón desaparece si el pago cancela la OC.
  const avisar = useAvisoDeLaCaja()

  async function pagar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el voucher del pago.' }
    if (!pagoId) return { ok: false, error: 'Vuelve a abrir el formulario del pago.' }
    return subirArchivoFinanzas(BUCKET_PAGOS_COMPRAS, ordenCompraId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarPagoCompra(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(pagar, (r) => {
    setPagoId(null)
    avisar(r.mensaje ?? null)
  })
  const campo = (nombre: string) => `${nombre}-compra-${ordenCompraId}`

  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          avisar(null)
          setDia(hoy)
          setPagoId(crypto.randomUUID())
        }}
        data-pagar-compra={numero}
      >
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={pagoId !== null}
        alCerrar={() => setPagoId(null)}
        titulo={`Pago de la ${numero}`}
        descripcion={`${conPunto(proveedor)} Falta pagar ${montoEntero(saldo, codigoMoneda)}; va con boleta, sin IGV.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <SinCuentasEnLaCaja cuentas={cuentas} tipo="pago" />
          {paraPagar}
          <input type="hidden" name="id" value={pagoId ?? ''} />
          <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del pago" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha_pago" type="date" required value={dia} onChange={(e) => setDia(e.target.value)} max={hoy} />
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
            <Campo etiqueta="¿Cancela la OC?" htmlFor={campo('cancela')} requerido ayuda="«A cuenta» si todavía falta pagarle al proveedor; si llega al total, se cancela sola.">
              <Seleccion id={campo('cancela')} name="cancela" defaultValue="si">
                <option value="si">Sí, queda pagada</option>
                <option value="no">No, es a cuenta</option>
              </Seleccion>
            </Campo>
            <Campo etiqueta="N.º de operación" htmlFor={campo('operacion')} ayuda="El que da el banco, si lo hay.">
              <Entrada id={campo('operacion')} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
            </Campo>
            <Campo etiqueta="Boleta, nota de venta o recibo" htmlFor={campo('comprobante')} ayuda="Su número, si ya la entregaron: B001-45.">
              <Entrada id={campo('comprobante')} name="comprobante" minLength={3} maxLength={30} autoComplete="off" className="tabular uppercase" />
            </Campo>
            <CuentaDeLaCaja cuentas={cuentas} monedaDocumento={codigoMoneda} tipo="pago" dia={dia} prefijo={`compra-${ordenCompraId}`} />
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
            <Boton type="submit" cargando={enviando} disabled={cuentas.length === 0}>
              Registrar el pago
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/**
 * Anular con su motivo un pago de OC con boleta mal registrado. La ventana dice
 * qué pasa con la OC: si le llegó su comprobante, ya no se paga aquí, sino por
 * él; y si le queda otro pago directo vigente, ese también se anula antes.
 *
 * `queQueda` lo arma la página con los pagos que se ven: lo mismo que dirá el aviso de después.
 * `etiqueta` dice cuál pago anula: con dos, el lector de pantalla leía «Anular» dos veces.
 *
 * Primero pregunta qué pasó (undécima vuelta): un pago bien hecho no se anula.
 * Si el proveedor lo devolvió, se registra la devolución; si lo tomó a cuenta
 * de su factura en otra moneda, se pasa al cambio. Solo «no salió» deja anular.
 */
export function AnularPagoCompra({
  pagoId,
  compraId,
  etiqueta,
  queQueda,
  puedeDevolver,
  alCambio,
}: {
  pagoId: string
  compraId: string
  etiqueta: string
  queQueda: string
  /** Quien mira lleva la caja y a la OC le queda algo que el proveedor pueda devolver. */
  puedeDevolver: boolean
  /** Lo pagado por la boleta espera a su factura en otra moneda. */
  alCambio: { factura: string; moneda: string } | null
}) {
  const [abierta, setAbierta] = useState(false)
  const [quePaso, setQuePaso] = useState<'no_salio' | 'devolvio' | 'al_cambio' | null>(null)
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error } = useEnvio(anularPagoCompra, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
  const opciones = [
    { valor: 'no_salio' as const, texto: 'No salió, o salió de otra cuenta o por otro monto: lo anulo y, si hace falta, lo registro bien.' },
    { valor: 'devolvio' as const, texto: 'El proveedor me lo devolvió, todo o en parte.' },
    ...(alCambio ? [{ valor: 'al_cambio' as const, texto: `El proveedor lo tomó a cuenta de su factura en ${alCambio.moneda}.` }] : []),
  ]
  // Cierra esta y abre la ventana de la OC que corresponde: la devolución o el cambio no se anotan anulando.
  const irA = (ventana: 'devolucion' | 'al-cambio') => {
    setAbierta(false)
    abrirVentanaDeLaBoleta(ventana, compraId)
  }
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        tamano="sm"
        onClick={() => {
          setQuePaso(null)
          setAbierta(true)
        }}
        data-anular-pago-compra={pagoId}
        aria-label={`Anular ${etiqueta}`}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo="Anular el pago" ancho="md">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId} />
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-texto">¿Qué pasó con este pago?</legend>
            {opciones.map((o) => (
              <label
                key={o.valor}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave"
              >
                <input
                  type="radio"
                  name="que_paso"
                  value={o.valor}
                  required
                  checked={quePaso === o.valor}
                  onChange={() => setQuePaso(o.valor)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--acento)]"
                />
                <span>{o.texto}</span>
              </label>
            ))}
          </fieldset>
          {quePaso === 'no_salio' && (
            <>
              <p className="text-sm text-texto-suave">Queda en el historial con su motivo y su voucher, y la caja diaria anula su egreso. {queQueda}</p>
              <Campo etiqueta="Motivo" htmlFor={`anular-pago-compra-${pagoId}`} requerido>
                <AreaTexto id={`anular-pago-compra-${pagoId}`} name="motivo" required minLength={10} maxLength={500} />
              </Campo>
            </>
          )}
          {quePaso === 'devolvio' && (
            <p role="status" className="text-sm text-texto">
              No se anula: lo que salió, salió.{' '}
              {puedeDevolver
                ? 'Registra lo que entró con «Registrar devolución»; la OC y su factura se rehacen solas.'
                : 'Lo que entró se registra con «Registrar devolución», y lo hace quien lleva la caja; la OC y su factura se rehacen solas.'}
            </p>
          )}
          {quePaso === 'al_cambio' && alCambio && (
            <p role="status" className="text-sm text-texto">
              No se anula: usa «La factura lo toma al cambio», y la factura {alCambio.factura} lo toma.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            {quePaso === 'devolvio' && puedeDevolver && (
              <Boton type="button" onClick={() => irA('devolucion')} data-ir-a-devolucion={pagoId}>
                <HandCoins aria-hidden className="size-4" />
                Registrar devolución
              </Boton>
            )}
            {quePaso === 'al_cambio' && alCambio && (
              <Boton type="button" onClick={() => irA('al-cambio')} data-ir-al-cambio={pagoId}>
                <ArrowLeftRight aria-hidden className="size-4" />
                La factura lo toma al cambio
              </Boton>
            )}
            {quePaso === 'no_salio' && (
              <Boton type="submit" variante="peligro" cargando={enviando}>
                Anular
              </Boton>
            )}
          </div>
        </form>
      </Ventana>
    </>
  )
}

/**
 * La OC con boleta de antes de que Tesorería registrara esos pagos se dio por
 * pagada fuera del sistema. Si no se pagó, Tesorería la pasa a Cuentas por
 * pagar desde Adquisiciones (migración 20261020210000); no vuelve atrás.
 *
 * Va en toda OC con boleta que Tesorería paga y solo muestra el botón mientras
 * está «fuera del sistema»: al refrescar, el botón se va y el componente se
 * queda, con lo que dijo la acción y el foco en ese aviso.
 */
export function PasarCompraATesoreria({ compraId, numero, fueraDelSistema }: { compraId: string; numero: string; fueraDelSistema: boolean }) {
  const [abierta, setAbierta] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const aviso = useRef<HTMLParagraphElement>(null)
  const { alEnviar, enviando, error } = useEnvio(pasarCompraATesoreria, (r) => {
    setAbierta(false)
    setMensaje(r.mensaje ?? `La ${numero} pasó a Cuentas por pagar.`)
  })
  useEffect(() => {
    if (mensaje && !fueraDelSistema) aviso.current?.focus()
  }, [mensaje, fueraDelSistema])
  if (!fueraDelSistema) {
    return mensaje ? (
      <p ref={aviso} tabIndex={-1} role="status" className="text-texto outline-none">
        {mensaje}
      </p>
    ) : null
  }
  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)} data-pasar-compra={compraId}>
        <Undo2 aria-hidden className="size-4" />
        No se pagó
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`La ${numero} no se pagó`}
        descripcion="Es de antes de que Tesorería registrara el pago de las OC con boleta y se dio por pagada fuera del sistema. Si no se pagó, pasa a Cuentas por pagar y ahí la pagas con su voucher. No vuelve atrás."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={compraId} />
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Pasar a Cuentas por pagar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

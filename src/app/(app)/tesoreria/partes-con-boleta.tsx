'use client'

import { Ban, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useAvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { CuentaDeLaCaja, SinCuentasEnLaCaja } from '@/components/finanzas/cuenta-de-la-caja'
import { ImportePropuesto } from '@/components/finanzas/importe-propuesto'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import type { CuentaParaPagar } from '@/lib/dominio/caja'
import { BUCKET_PAGOS_COMPRAS, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'
import { moneda, type CodigoMoneda } from '@/lib/format'

import { anularPagoParte, registrarPagoParte } from './acciones-partes'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/**
 * Tesorería paga la boleta de una parte de la OC que llega en partes (migración
 * 20261022200000): el día, lo pagado (hasta lo que le queda), el número de
 * operación, la cuenta de la caja y el voucher, que sube primero a
 * `pagos-compras/{oc}/…`. Como los demás pagos de Tesorería, el id vive fuera
 * de la ventana (`useIdDelEnvio`): un reintento no registra otro, y con el saldo
 * ya al día el siguiente lleva otro. El aviso y los botones van en
 * `PieDeVentana`, y el importe propone el saldo sin pisar lo escrito.
 */
export function PagarParte({
  documentoId,
  ordenCompraId,
  boleta,
  numero,
  proveedor,
  hoy,
  saldo,
  codigoMoneda,
  cuentas,
  paraPagar,
}: {
  documentoId: string
  ordenCompraId: string
  boleta: string
  numero: string
  proveedor: string
  hoy: string
  saldo: number
  codigoMoneda: CodigoMoneda
  cuentas: CuentaParaPagar[]
  /** El PDF de la OC, la boleta y las cuentas del proveedor, a la vista mientras se paga. */
  paraPagar?: ReactNode
}) {
  const pago = useIdDelEnvio(saldo)
  const [abierta, setAbierta] = useState(false)
  const [dia, setDia] = useState(hoy)
  const avisar = useAvisoDeLaCaja()

  async function pagar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el voucher del pago.' }
    if (!pago.id) return { ok: false, error: 'Vuelve a abrir el formulario del pago.' }
    pago.salio()
    return subirArchivoFinanzas(BUCKET_PAGOS_COMPRAS, ordenCompraId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarPagoParte(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(
    pagar,
    (r) => {
      setAbierta(false)
      pago.otro()
      avisar(r.mensaje ?? null)
    },
    { alYaEntrar: pago.otro },
  )
  const campo = (nombre: string) => `${nombre}-parte-${documentoId}`

  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          avisar(null)
          setDia(hoy)
          pago.abrir()
          setAbierta(true)
        }}
        aria-label={`Registrar pago de la boleta ${boleta}`}
        data-pagar-parte={boleta}
      >
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Pago de la boleta ${boleta}`}
        descripcion={`${proveedor.trim().replace(/\.$/, '')} · ${numero}. Le quedan ${moneda(saldo, codigoMoneda)}.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <SinCuentasEnLaCaja cuentas={cuentas} tipo="pago" />
          {paraPagar}
          <input type="hidden" name="id" value={pago.id ?? ''} />
          <input type="hidden" name="documento_id" value={documentoId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del pago" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha_pago" type="date" required value={dia} onChange={(e) => setDia(e.target.value)} max={hoy} />
            </Campo>
            <Campo etiqueta={`Importe pagado (${codigoMoneda === 'USD' ? 'dólares' : 'soles'})`} htmlFor={campo('monto')} requerido>
              <ImportePropuesto
                saldo={saldo}
                id={campo('monto')}
                name="monto"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={saldo > 0 ? saldo.toFixed(2) : undefined}
                step="0.01"
                required
                className="tabular"
              />
            </Campo>
            <Campo etiqueta="N.º de operación" htmlFor={campo('operacion')} ayuda="El que da el banco, si lo hay.">
              <Entrada id={campo('operacion')} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
            </Campo>
            <CuentaDeLaCaja cuentas={cuentas} monedaDocumento={codigoMoneda} tipo="pago" dia={dia} prefijo={`parte-${documentoId}`} />
          </div>
          <Campo etiqueta="Voucher o constancia del pago" htmlFor={campo('archivo')} requerido>
            <ElegirArchivo id={campo('archivo')} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_FINANZAS} required />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Registrar el pago" disabled={cuentas.length === 0} />
        </form>
      </Ventana>
    </>
  )
}

/** Anular con su motivo un pago de la boleta de una parte mal registrado: la boleta vuelve a deberlo y la caja anula su egreso. */
export function AnularPagoParte({ pagoId, etiqueta }: { pagoId: string; etiqueta: string }) {
  const [abierta, setAbierta] = useState(false)
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error } = useEnvio(anularPagoParte, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        tamano="sm"
        onClick={() => setAbierta(true)}
        aria-label={`Anular ${etiqueta}`}
        data-anular-pago-parte={pagoId}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular el pago"
        descripcion={`Anulas ${etiqueta}. Queda en el historial con su motivo y su voucher; la boleta vuelve a deberlo y la caja diaria anula su egreso.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-pago-parte-${pagoId}`} requerido>
            <AreaTexto id={`anular-pago-parte-${pagoId}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

'use client'

import { ArrowLeftRight, Ban, HandCoins } from 'lucide-react'
import { useState } from 'react'

import { useAvisoDeLaCaja } from '@/components/finanzas/aviso-de-la-caja'
import { CuentaDeLaCaja, SinCuentasEnLaCaja } from '@/components/finanzas/cuenta-de-la-caja'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import { nombreMoneda, type CuentaParaPagar } from '@/lib/dominio/caja'
import { BUCKET_NOTAS_CREDITO, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import { useEnvio } from '@/lib/envio'
import { fecha, moneda, type CodigoMoneda } from '@/lib/format'

import {
  anularReembolsoNotaCredito,
  descontarNotaCredito,
  quitarDescuentoNotaCredito,
  registrarReembolsoNotaCredito,
} from './acciones-nota-credito'

/*
 * Lo que queda a favor de una nota de crédito del proveedor (decisiones de DKS
 * del 22/10, migración 20261022190000): Tesorería lo descuenta de otra factura
 * suya o registra que el proveedor lo devolvió. Los montos se proponen con lo
 * que queda; la base vuelve a contar.
 */

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/** El proveedor como frase: «S.A.C.» ya trae su punto y no lleva otro. */
function conPunto(proveedor: string) {
  const texto = proveedor.trim()
  return texto.endsWith('.') ? texto : `${texto}.`
}

/** La nota, como la ve cada ventana. */
export type NotaParaUsar = { id: string; numero: string; proveedor: string; moneda: CodigoMoneda; fecha: string; aFavor: number }
export type FacturaDeLaNota = { id: string; numero: string; fecha: string | null; saldo: number }

/** Descuenta parte de lo que queda a favor de otra factura del mismo proveedor que todavía debe. */
export function DescontarNota({ nota, facturas }: { nota: NotaParaUsar; facturas: FacturaDeLaNota[] }) {
  const [abierta, setAbierta] = useState(false)
  const [factura, setFactura] = useState('')
  const [monto, setMonto] = useState('')
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error, limpiar } = useEnvio(descontarNotaCredito, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
  const elegida = facturas.find((f) => f.id === factura)
  function abrir() {
    avisar(null)
    limpiar()
    const primera = facturas.length === 1 ? facturas[0] : null
    setFactura(primera?.id ?? '')
    setMonto(primera ? Math.min(primera.saldo, nota.aFavor).toFixed(2) : '')
    setAbierta(true)
  }
  const campo = (n: string) => `${n}-descontar-${nota.id}`
  return (
    <>
      <Boton type="button" tamano="sm" variante="primario" onClick={abrir} disabled={facturas.length === 0} data-descontar-nota={nota.numero}
        aria-label={`Descontar la nota ${nota.numero} de otra factura`}
      >
        <ArrowLeftRight aria-hidden className="size-4" />
        Descontar de otra factura
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Descontar la nota ${nota.numero}`}
        descripcion={`${conPunto(nota.proveedor)} Le quedan ${moneda(nota.aFavor, nota.moneda)} a favor. La factura que elijas debe eso menos; la caja no se mueve porque no sale dinero.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="nota" value={nota.id} />
          <Campo etiqueta="De qué factura" htmlFor={campo('factura')} requerido>
            <Seleccion
              id={campo('factura')}
              name="factura"
              required
              value={factura}
              onChange={(e) => {
                setFactura(e.target.value)
                const f = facturas.find((x) => x.id === e.target.value)
                if (f) setMonto(Math.min(f.saldo, nota.aFavor).toFixed(2))
              }}
            >
              <option value="" disabled>
                Elige una
              </option>
              {facturas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.numero}
                  {f.fecha ? ` del ${fecha(f.fecha)}` : ''}: debe {moneda(f.saldo, nota.moneda)}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Campo etiqueta={`Importe (${nombreMoneda(nota.moneda)})`} htmlFor={campo('monto')} requerido>
            <Entrada
              id={campo('monto')}
              name="monto"
              type="number"
              inputMode="decimal"
              min="0.01"
              max={Math.min(nota.aFavor, elegida?.saldo ?? nota.aFavor).toFixed(2)}
              step="0.01"
              required
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="tabular"
            />
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
            <Boton type="submit" cargando={enviando}>
              Descontar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/**
 * El proveedor devolvió el dinero de la nota: el día que entró, cuánto, la
 * operación, la cuenta de la caja a la que entró —la caja diaria se mueve
 * sola— y la constancia, que sube primero a `notas-credito/{nota}/…`. El id se
 * decide al abrir la ventana: un reintento del mismo envío no registra otra.
 */
export function DevolvioLaNota({ nota, hoy, cuentas }: { nota: NotaParaUsar; hoy: string; cuentas: CuentaParaPagar[] }) {
  const [id, setId] = useState<string | null>(null)
  // El id se conserva hasta saber cómo terminó el envío: tras «No llegó la
  // respuesta», cancelar y volver a abrir lleva el mismo, y lo repetido dice
  // que ya quedó en vez de entrar dos veces (decimocuarta pasada).
  const [abierta, setAbierta] = useState(false)
  const [dia, setDia] = useState(hoy)
  const [monto, setMonto] = useState('')
  // Si la ventana se abrió antes de que la pantalla se pusiera al día, lo que queda a favor cambia el propuesto.
  const [aFavorVisto, setAFavorVisto] = useState(nota.aFavor)
  if (aFavorVisto !== nota.aFavor) {
    setAFavorVisto(nota.aFavor)
    setMonto(nota.aFavor.toFixed(2))
  }
  const avisar = useAvisoDeLaCaja()

  async function registrar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta la constancia de la devolución.' }
    if (!id) return { ok: false, error: 'Vuelve a abrir el formulario de la devolución.' }
    return subirArchivoFinanzas(BUCKET_NOTAS_CREDITO, nota.id, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarReembolsoNotaCredito(null, datos)
    })
  }
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    registrar,
    (r) => {
      setAbierta(false)
      setId(null)
      avisar(r.mensaje ?? null)
    },
    { alYaEntrar: () => setId(null) },
  )
  function abrir() {
    avisar(null)
    limpiar()
    setDia(hoy)
    setMonto(nota.aFavor.toFixed(2))
    setId((actual) => actual ?? crypto.randomUUID())
    setAbierta(true)
  }
  const campo = (n: string) => `${n}-reembolso-${nota.id}`
  return (
    <>
      <Boton type="button" tamano="sm" variante="contorno" onClick={abrir} data-devolvio-nota={nota.numero}
        aria-label={`El proveedor devolvió lo de la nota ${nota.numero}`}
      >
        <HandCoins aria-hidden className="size-4" />
        El proveedor lo devolvió
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Devolución de la nota ${nota.numero}`}
        descripcion={`${conPunto(nota.proveedor)} Lo que el proveedor te devolvió de lo que la nota tiene a favor: entra a la cuenta que elijas en la caja diaria. Como mucho, ${moneda(nota.aFavor, nota.moneda)}.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <SinCuentasEnLaCaja cuentas={cuentas} tipo="devolucion" />
          <input type="hidden" name="id" value={id ?? ''} />
          <input type="hidden" name="nota" value={nota.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día en que entró" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha" type="date" required value={dia} onChange={(e) => setDia(e.target.value)} min={nota.fecha} max={hoy} />
            </Campo>
            <Campo etiqueta={`Importe devuelto (${nombreMoneda(nota.moneda)})`} htmlFor={campo('monto')} requerido>
              <Entrada
                id={campo('monto')}
                name="monto"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={nota.aFavor.toFixed(2)}
                step="0.01"
                required
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="tabular"
              />
            </Campo>
            <Campo etiqueta="N.º de operación" htmlFor={campo('operacion')} ayuda="El del abono en el estado de cuenta; si te lo devolvieron en efectivo, déjalo vacío.">
              <Entrada id={campo('operacion')} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
            </Campo>
            <CuentaDeLaCaja cuentas={cuentas} monedaDocumento={nota.moneda} tipo="devolucion" dia={dia} prefijo={`reembolso-${nota.id}`} />
          </div>
          <Campo etiqueta="Constancia de la devolución" htmlFor={campo('archivo')} requerido ayuda="La transferencia, el voucher del depósito o la foto del recibo firmado.">
            <ElegirArchivo id={campo('archivo')} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_FINANZAS} required />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Registrar la devolución"
            disabled={cuentas.length === 0} />
        </form>
      </Ventana>
    </>
  )
}

/** Deshace un uso de la nota con su motivo: el descuento de otra factura, o la devolución, que sale de la caja. */
export function DeshacerUsoDeLaNota({
  uso,
  etiqueta,
}: {
  uso: { id: string; que: 'DESCUENTO' | 'DEVOLUCION' }
  /** Cuál es, para el lector de pantalla: con dos, se leía «Quitar» dos veces. */
  etiqueta: string
}) {
  const [abierta, setAbierta] = useState(false)
  const avisar = useAvisoDeLaCaja()
  const esDevolucion = uso.que === 'DEVOLUCION'
  const { alEnviar, enviando, error, limpiar } = useEnvio(esDevolucion ? anularReembolsoNotaCredito : quitarDescuentoNotaCredito, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        tamano="sm"
        onClick={() => {
          limpiar()
          setAbierta(true)
        }}
        aria-label={`${esDevolucion ? 'Anular' : 'Quitar'} ${etiqueta}`}
        data-deshacer-uso={uso.id}
      >
        <Ban aria-hidden className="size-4" />
        {esDevolucion ? 'Anular' : 'Quitar'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={esDevolucion ? 'Anular la devolución' : 'Quitar el descuento'}
        descripcion={
          esDevolucion
            ? 'Queda en el historial con su motivo y su constancia, y la caja diaria anula su ingreso; si su día ya está cerrado, hoy sale de esa cuenta lo que entró. La nota vuelve a tenerlo a favor.'
            : 'La factura vuelve a deberlo y la nota vuelve a tenerlo a favor. La caja no se mueve.'
        }
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={uso.id} />
          <Campo etiqueta="Motivo" htmlFor={`deshacer-${uso.id}`} requerido>
            <AreaTexto id={`deshacer-${uso.id}`} name="motivo" required minLength={10} maxLength={500} />
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
              {esDevolucion ? 'Anular' : 'Quitar'}
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

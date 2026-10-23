'use client'

import { ArrowLeftRight, Ban, HandCoins, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useState } from 'react'

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
import { BUCKET_PAGOS_COMPRAS, BUCKET_PAGOS_FACTURAS, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import {
  facturaSegunElRechazo,
  preguntaSiQuedaPagada,
  queQuedaTrasLaDevolucion,
  topeDeLaDevolucion,
  type BoletaParaDevolver,
} from '@/lib/dominio/pago-de-boleta'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'
import { fecha, moneda, type CodigoMoneda } from '@/lib/format'

import { anularDevolucionCompra, registrarDevolucionCompra, soltarPagoDeLaBoleta, tomarPagoDeLaBoleta } from './acciones'

/*
 * Lo que Tesorería hace con lo pagado por la boleta de una OC cuando el
 * proveedor entrega factura después y no cuadra (undécima vuelta, migración
 * 20261020210000): registrar lo que el proveedor devolvió, pasarlo al cambio a
 * su factura en otra moneda, descontarlo de otra factura suya o deshacer esa
 * toma. Nada de eso anula un pago bien hecho: el dinero salió una vez.
 */

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'
const ABRIR = 'metalwork:abrir-ventana-de-la-boleta'
type VentanaDeLaBoleta = 'devolucion' | 'al-cambio'

/**
 * La ventana «Anular el pago» no anula lo que el proveedor devolvió: cierra y
 * abre la de la devolución (o la del cambio) de la misma OC, que vive en otra
 * parte de la tarjeta.
 */
export function abrirVentanaDeLaBoleta(ventana: VentanaDeLaBoleta, compraId: string) {
  window.dispatchEvent(new CustomEvent(ABRIR, { detail: { ventana, compraId } }))
}

function useAbrirDesdeOtraVentana(ventana: VentanaDeLaBoleta, compraId: string, abrir: () => void) {
  const alPedirlo = useEffectEvent((e: Event) => {
    const pedido = (e as CustomEvent<{ ventana: string; compraId: string }>).detail
    if (pedido?.ventana === ventana && pedido.compraId === compraId) abrir()
  })
  useEffect(() => {
    window.addEventListener(ABRIR, alPedirlo)
    return () => window.removeEventListener(ABRIR, alPedirlo)
  }, [])
}

/** El proveedor como frase: «S.A.C.» ya trae su punto y no lleva otro. */
function conPunto(proveedor: string) {
  const texto = proveedor.trim()
  return texto.endsWith('.') ? texto : `${texto}.`
}

const leerMonto = (texto: string) => {
  const n = Number(texto.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/**
 * Tesorería registra lo que el proveedor devolvió de lo pagado por la boleta:
 * el día que entró, cuánto, la operación, la cuenta de la caja a la que entró
 * —la caja diaria se mueve sola— y la constancia, que sube primero a
 * `pagos-compras/{oc}/…`. Mientras se escribe el monto dice cómo queda la OC.
 * Sin factura, si queda algo pagado sin llegar al total, pregunta si con eso
 * la OC queda pagada: el proveedor cobró de más o entregó menos, aunque el
 * material ya esté en el almacén. El id vive fuera de la ventana
 * (`useIdDelEnvio`): un reintento no registra otra.
 */
export function RegistrarDevolucion({
  ordenCompraId,
  numero,
  proveedor,
  hoy,
  desde,
  boleta,
  codigoMoneda,
  cuentas,
  principal,
}: {
  ordenCompraId: string
  numero: string
  proveedor: string
  hoy: string
  /** El día del primer pago vigente: la devolución no entra antes. */
  desde: string | null
  boleta: BoletaParaDevolver
  codigoMoneda: CodigoMoneda
  cuentas: CuentaParaPagar[]
  /** Con algo pagado de más es lo que la tarjeta le pide a Tesorería: va como botón principal. */
  principal: boolean
}) {
  const devolucion = useIdDelEnvio(boleta.neto)
  const [abierta, setAbierta] = useState(false)
  const [dia, setDia] = useState(hoy)
  const [monto, setMonto] = useState('')
  const [deja, setDeja] = useState('')
  const avisar = useAvisoDeLaCaja()
  const router = useRouter()
  // La OC cambió con la ventana abierta (Logística anexó o anuló su factura) y la base pide la respuesta, o la
  // rechaza: la ventana se corrige con lo que dijo la base. Repintar la página la cerraba con todo lo escrito,
  // porque la tarjeta pasa a otra lista. Vale hasta que la página traiga otra `boleta`. Si la factura no cambió,
  // cambió lo pagado (otro pago u otra devolución): la ventana no sabe cuánto, y pide abrirla de nuevo.
  const [rechazo, setRechazo] = useState<{ para: BoletaParaDevolver; enCamino: boolean; otro: boolean } | null>(null)
  const vigente: BoletaParaDevolver =
    rechazo?.para === boleta && !rechazo.otro
      ? { ...boleta, enCamino: rechazo.enCamino, factura: rechazo.enCamino ? boleta.factura : null }
      : boleta
  const tope = topeDeLaDevolucion(boleta)
  const sugerido = boleta.deMas > 0 ? Math.min(boleta.deMas, tope).toFixed(2) : ''

  async function registrar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta la constancia de la devolución.' }
    if (!devolucion.id) return { ok: false, error: 'Vuelve a abrir el formulario de la devolución.' }
    devolucion.salio()
    const r = await subirArchivoFinanzas(BUCKET_PAGOS_COMPRAS, ordenCompraId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarDevolucionCompra(null, datos)
    })
    if (!r.ok) {
      const enCamino = facturaSegunElRechazo(r.error)
      // Contra lo que la ventana mostraba al mandar (`vigente`): la factura pudo llegar y después irse con ella abierta.
      if (enCamino !== null) setRechazo({ para: boleta, enCamino, otro: enCamino === (vigente.enCamino || Boolean(vigente.factura)) })
    }
    return r
  }
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    registrar,
    (r) => {
      setAbierta(false)
      devolucion.otro()
      avisar(r.mensaje ?? null)
    },
    { alYaEntrar: devolucion.otro },
  )

  function abrir() {
    avisar(null)
    limpiar()
    setDia(hoy)
    setMonto(sugerido)
    setDeja('')
    devolucion.abrir()
    setAbierta(true)
  }
  // Cerrada sin registrar después de corregirse, la tarjeta de atrás todavía dice lo de antes: se repinta ahora,
  // que la ventana ya no se pierde si la tarjeta cambia de lista.
  function cerrar() {
    setAbierta(false)
    if (rechazo?.para === boleta) router.refresh()
  }
  useAbrirDesdeOtraVentana('devolucion', ordenCompraId, abrir)

  // Lo que dijo la base ya está en la ventana (la pregunta, o sin ella): no es un error, es la OC que cambió.
  const corregida =
    rechazo?.para === boleta && error !== null && facturaSegunElRechazo(error) !== null
      ? rechazo.otro
        ? 'otro'
        : rechazo.enCamino
          ? 'llego'
          : 'se-fue'
      : null
  const campo = (nombre: string) => `${nombre}-devolucion-${ordenCompraId}`
  const escrito = leerMonto(monto) ?? 0
  const valido = escrito > 0 && escrito <= tope
  const pregunta = valido && preguntaSiQuedaPagada(vigente, escrito)
  const queda = Math.round((boleta.neto - escrito) * 100) / 100
  const enVivo = valido ? queQuedaTrasLaDevolucion(vigente, -escrito, codigoMoneda, deja === '' ? undefined : deja === 'si') : null

  return (
    <>
      <Boton type="button" tamano="sm" variante={principal ? 'primario' : 'contorno'} onClick={abrir} data-registrar-devolucion={numero}>
        <HandCoins aria-hidden className="size-4" />
        Registrar devolución
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo={`Devolución de la ${numero}`}
        descripcion={`${conPunto(proveedor)} Lo que el proveedor te devolvió de lo pagado por la boleta: entra a la cuenta que elijas en la caja diaria. Como mucho, ${moneda(tope, codigoMoneda)}.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <SinCuentasEnLaCaja cuentas={cuentas} tipo="devolucion" />
          <p className="text-sm text-texto-suave">
            Regístrala aquí el día que entra, no en Caja diaria: la caja la toma sola. Si ya la anotaste a mano, anula antes ese movimiento.
          </p>
          <input type="hidden" name="id" value={devolucion.id ?? ''} />
          <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día en que entró" htmlFor={campo('fecha')} requerido>
              <Entrada
                id={campo('fecha')}
                name="fecha"
                type="date"
                required
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                min={desde ?? undefined}
                max={hoy}
              />
            </Campo>
            <Campo etiqueta={`Importe devuelto (${nombreMoneda(codigoMoneda)})`} htmlFor={campo('monto')} requerido>
              <Entrada
                id={campo('monto')}
                name="monto"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={tope.toFixed(2)}
                step="0.01"
                required
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="tabular"
              />
            </Campo>
            <Campo
              etiqueta="N.º de operación"
              htmlFor={campo('operacion')}
              ayuda="El del abono en el estado de cuenta; si te la devolvieron en efectivo, déjalo vacío."
            >
              <Entrada id={campo('operacion')} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
            </Campo>
            <CuentaDeLaCaja cuentas={cuentas} monedaDocumento={codigoMoneda} tipo="devolucion" dia={dia} prefijo={`devolucion-${ordenCompraId}`} />
          </div>
          {pregunta && (
            <Campo
              etiqueta="¿Con lo que queda, la OC queda pagada?"
              htmlFor={campo('deja')}
              requerido
              ayuda="«Sí» si el proveedor cobró de más o entregó menos y lo que queda pagado es lo que vale la compra, aunque el material ya esté en el almacén. «No» si todavía se le debe el resto."
            >
              <Seleccion id={campo('deja')} name="deja" required value={deja} onChange={(e) => setDeja(e.target.value)}>
                <option value="" disabled>
                  Elige una
                </option>
                <option value="si">Sí, queda pagada con {moneda(queda, codigoMoneda)}</option>
                <option value="no">No, queda debiendo {moneda(Math.round((boleta.total - queda) * 100) / 100, codigoMoneda)}</option>
              </Seleccion>
            </Campo>
          )}
          <Campo
            etiqueta="Constancia de la devolución"
            htmlFor={campo('archivo')}
            requerido
            ayuda="La transferencia, la captura de Yape o Plin, el voucher del depósito o la foto del recibo firmado."
          >
            <ElegirArchivo id={campo('archivo')} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_FINANZAS} required />
          </Campo>
          <p role="status" aria-live="polite" className="text-sm text-texto">
            {enVivo}
          </p>
          <PieDeVentana
            error={error}
            enviando={enviando}
            alCancelar={cerrar}
            texto="Registrar la devolución"
            disabled={cuentas.length === 0 || corregida === 'otro'}
            enLugarDelError={
              corregida !== null && (
                <p role="status" data-ventana-corregida className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-texto">
                  {corregida === 'llego'
                    ? 'Mientras escribías, le llegó su factura a la OC: cuánto se le paga lo dice la factura, así que ya no se pregunta si queda pagada. Revisa lo escrito y registra la devolución.'
                    : corregida === 'se-fue'
                      ? 'Mientras escribías, la OC se quedó sin su factura y se paga por su boleta: di si con lo que queda pagado queda pagada y registra la devolución.'
                      : 'Mientras escribías, cambió lo pagado de la OC: cierra esta ventana para verla al día y vuelve a registrar la devolución.'}
                </p>
              )
            }
          />
        </form>
      </Ventana>
    </>
  )
}

/**
 * Anular con su motivo una devolución mal registrada. `queQueda` lo arma la
 * página con la misma cuenta que la ventana de registrarla, con el monto de
 * vuelta. `etiqueta` dice cuál: con dos, el lector de pantalla leía «Anular» dos veces.
 * `noSeAnula` es por qué la base no la dejaría anular: la ventana lo dice en vez
 * de prometer cómo queda la OC.
 */
export function AnularDevolucion({
  devolucionId,
  etiqueta,
  queQueda,
  noSeAnula,
}: {
  devolucionId: string
  etiqueta: string
  queQueda: string
  noSeAnula: string | null
}) {
  const [abierta, setAbierta] = useState(false)
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error } = useEnvio(anularDevolucionCompra, (r) => {
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
        data-anular-devolucion={devolucionId}
        aria-label={`Anular ${etiqueta}`}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular la devolución"
        descripcion={
          noSeAnula ??
          `Queda en el historial con su motivo y su constancia, y la caja diaria anula su ingreso; si su día ya está cerrado, hoy sale de esa cuenta lo que entró. ${queQueda}`
        }
        ancho="md"
      >
        {noSeAnula ? (
          <div className="flex justify-end">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cerrar
            </Boton>
          </div>
        ) : (
          <form onSubmit={alEnviar} className="space-y-4">
            <input type="hidden" name="id" value={devolucionId} />
            <Campo etiqueta="Motivo" htmlFor={`anular-devolucion-${devolucionId}`} requerido>
              <AreaTexto id={`anular-devolucion-${devolucionId}`} name="motivo" required minLength={10} maxLength={500} />
            </Campo>
            <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
          </form>
        )}
      </Ventana>
    </>
  )
}

/** Soles por dólar con los dos montos: la boleta en una moneda y la factura en la otra. */
function solesPorDolar(deLaBoleta: number, enLaFactura: number, monedaFactura: CodigoMoneda) {
  return monedaFactura === 'USD' ? deLaBoleta / enLaFactura : enLaFactura / deLaBoleta
}

/**
 * La factura en otra moneda no toma sola lo pagado por la boleta: el sistema no
 * convierte. Si el proveedor lo tomó a cuenta de ella, Tesorería escribe los dos
 * montos que él reconoce y la factura los toma, sin mover la caja. Propone el
 * cambio de venta del día del último pago; sin él, pide los dos montos.
 */
export function TomarAlCambio({
  ordenCompraId,
  numero,
  proveedor,
  factura,
  sinTomar,
  monedaOc,
  cambio,
  diaDelCambio,
}: {
  ordenCompraId: string
  numero: string
  proveedor: string
  factura: { id: string; numero: string; moneda: CodigoMoneda; saldo: number }
  /** Lo pagado por la boleta que no tomó ninguna factura, en la moneda de la OC. */
  sinTomar: number
  monedaOc: CodigoMoneda
  /** El cambio de venta del día del último pago; null si no está cargado. */
  cambio: number | null
  diaDelCambio: string | null
}) {
  const toma = useIdDelEnvio(sinTomar)
  const [abierta, setAbierta] = useState(false)
  const sugeridoFactura = (() => {
    if (!cambio) return ''
    const enFactura = factura.moneda === 'USD' ? sinTomar / cambio : sinTomar * cambio
    return Math.min(Math.round(enFactura * 100) / 100, factura.saldo).toFixed(2)
  })()
  const [deLaBoleta, setDeLaBoleta] = useState(sinTomar.toFixed(2))
  const [enLaFactura, setEnLaFactura] = useState(sugeridoFactura)
  const avisar = useAvisoDeLaCaja()

  function abrir() {
    avisar(null)
    setDeLaBoleta(sinTomar.toFixed(2))
    setEnLaFactura(sugeridoFactura)
    toma.abrir()
    setAbierta(true)
  }
  useAbrirDesdeOtraVentana('al-cambio', ordenCompraId, abrir)

  const { alEnviar, enviando, error } = useEnvio(
    (previo: unknown, datos: FormData) => {
      toma.salio()
      return tomarPagoDeLaBoleta(previo, datos)
    },
    (r) => {
      setAbierta(false)
      toma.otro()
      avisar(r.mensaje ?? null)
    },
    { alYaEntrar: toma.otro },
  )
  const campo = (nombre: string) => `${nombre}-al-cambio-${ordenCompraId}`
  const boleta = leerMonto(deLaBoleta)
  const enFactura = leerMonto(enLaFactura)
  const tipo = boleta && enFactura ? solesPorDolar(boleta, enFactura, factura.moneda) : null
  const fueraDeRango = tipo !== null && (tipo < 2 || tipo > 6)
  const faltaElCambio = !cambio && diaDelCambio !== null
  const ejemplo = `Escribe lo que el proveedor te reconoce en la factura: si te dice «los ${
    monedaOc === 'USD' ? 'US$ 97.70 son S/ 361.50' : 'S/ 361.50 son US$ 97.70'
  }», escribe esos dos montos.`

  return (
    <>
      <Boton type="button" tamano="sm" onClick={abrir} data-tomar-al-cambio={numero}>
        <ArrowLeftRight aria-hidden className="size-4" />
        La factura lo toma al cambio
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`La factura ${factura.numero} toma lo pagado por la boleta`}
        descripcion={`${conPunto(proveedor)} Lo que el proveedor tomó de lo pagado por la boleta de la ${numero}, a su cambio, a cuenta de la factura ${factura.numero} en ${nombreMoneda(factura.moneda)}. No mueve la caja: el dinero ya salió con el pago de la boleta.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={toma.id ?? ''} />
          <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
          <input type="hidden" name="factura_id" value={factura.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta={`De lo pagado por la boleta (${nombreMoneda(monedaOc)})`} htmlFor={campo('boleta')} requerido>
              <Entrada
                id={campo('boleta')}
                name="monto_boleta"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={sinTomar.toFixed(2)}
                step="0.01"
                required
                value={deLaBoleta}
                onChange={(e) => setDeLaBoleta(e.target.value)}
                className="tabular"
              />
            </Campo>
            <Campo
              etiqueta={`En la factura (${nombreMoneda(factura.moneda)})`}
              htmlFor={campo('factura')}
              requerido
              ayuda={faltaElCambio && diaDelCambio ? `Falta el tipo de cambio del ${fecha(diaDelCambio).slice(0, 5)}: escribe el que te dio el proveedor.` : ejemplo}
              ayudaEnIcono={faltaElCambio ? false : undefined}
            >
              <Entrada
                id={campo('factura')}
                name="monto_factura"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={factura.saldo.toFixed(2)}
                step="0.01"
                required
                value={enLaFactura}
                onChange={(e) => setEnLaFactura(e.target.value)}
                className="tabular"
              />
            </Campo>
          </div>
          <p role="status" aria-live="polite" className={`text-sm ${fueraDeRango ? 'text-aviso' : 'text-texto'}`}>
            {tipo !== null &&
              enFactura !== null &&
              (fueraDeRango
                ? `Con esos montos el dólar sale a S/ ${tipo.toFixed(3)}: revisa los dos montos.`
                : `Sale a S/ ${tipo.toFixed(3)} por dólar. La factura queda debiendo ${moneda(Math.max(factura.saldo - enFactura, 0), factura.moneda)}.`)}
          </p>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Pasar a la factura" />
        </form>
      </Ventana>
    </>
  )
}

/** Una factura del proveedor con saldo, para descontar en ella lo pagado de más. */
export type FacturaParaDescontar = { id: string; numero: string; moneda: CodigoMoneda; fecha: string | null; saldo: number }

/**
 * El proveedor no devuelve lo pagado de más: lo descuenta de otra factura suya.
 * Tesorería elige esa factura y la factura lo toma como pagado, sin mover la
 * caja. En otra moneda pide también lo que toma la factura; en la misma, es lo
 * mismo. Con la nota de crédito o el documento donde el proveedor lo rebajó (DKS,
 * 2026-10-21), que sube primero a `pagos-facturas/{factura}/…`.
 */
export function DescontarDeOtraFactura({
  ordenCompraId,
  numero,
  proveedor,
  deMas,
  monedaOc,
  facturas,
}: {
  ordenCompraId: string
  numero: string
  proveedor: string
  deMas: number
  monedaOc: CodigoMoneda
  facturas: FacturaParaDescontar[]
}) {
  const toma = useIdDelEnvio(deMas)
  const [abierta, setAbierta] = useState(false)
  const [elegida, setElegida] = useState(facturas.length === 1 ? facturas[0].id : '')
  const [deLaBoleta, setDeLaBoleta] = useState(deMas.toFixed(2))
  const avisar = useAvisoDeLaCaja()

  async function descontar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    const facturaId = datos.get('factura_id')
    if (typeof facturaId !== 'string' || !facturaId) return { ok: false, error: 'Elige la factura.' }
    if (!(archivo instanceof File) || archivo.size === 0) {
      return { ok: false, error: 'Adjunta la nota de crédito o el documento donde el proveedor descontó lo pagado de más.' }
    }
    toma.salio()
    return subirArchivoFinanzas(BUCKET_PAGOS_FACTURAS, facturaId, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return tomarPagoDeLaBoleta(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(
    descontar,
    (r) => {
      setAbierta(false)
      toma.otro()
      avisar(r.mensaje ?? null)
    },
    { alYaEntrar: toma.otro },
  )
  const factura = facturas.find((f) => f.id === elegida)
  const otraMoneda = !!factura && factura.moneda !== monedaOc
  const campo = (nombre: string) => `${nombre}-descontar-${ordenCompraId}`

  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        variante="contorno"
        onClick={() => {
          avisar(null)
          setDeLaBoleta(deMas.toFixed(2))
          toma.abrir()
          setAbierta(true)
        }}
        data-descontar-de-otra={numero}
      >
        <Undo2 aria-hidden className="size-4" />
        Lo descuenta de otra factura
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Lo pagado de más de la ${numero}, a otra factura`}
        descripcion={`${conPunto(proveedor)} El proveedor no devuelve los ${moneda(deMas, monedaOc)}: los descuenta de otra factura suya. Esa factura los toma como pagados, sin mover la caja.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={toma.id ?? ''} />
          <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
          {facturas.length === 0 ? (
            <p role="status" className="text-sm text-aviso">
              El proveedor no tiene otra factura registrada con saldo: cuando Contabilidad la registre, vuelve aquí.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Factura" htmlFor={campo('factura')} requerido className="sm:col-span-2">
                <Seleccion id={campo('factura')} name="factura_id" value={elegida} onChange={(e) => setElegida(e.target.value)} required>
                  <option value="" disabled>
                    Elige la factura…
                  </option>
                  {facturas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.numero}
                      {f.fecha ? ` · ${fecha(f.fecha)}` : ''} · saldo {moneda(f.saldo, f.moneda)}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
              <Campo etiqueta={`De lo pagado de más (${nombreMoneda(monedaOc)})`} htmlFor={campo('boleta')} requerido>
                <Entrada
                  id={campo('boleta')}
                  name="monto_boleta"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max={deMas.toFixed(2)}
                  step="0.01"
                  required
                  value={deLaBoleta}
                  onChange={(e) => setDeLaBoleta(e.target.value)}
                  className="tabular"
                />
              </Campo>
              {otraMoneda && factura ? (
                <Campo etiqueta={`En la factura (${nombreMoneda(factura.moneda)})`} htmlFor={campo('factura-monto')} requerido>
                  <Entrada
                    id={campo('factura-monto')}
                    name="monto_factura"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max={factura.saldo.toFixed(2)}
                    step="0.01"
                    required
                    className="tabular"
                  />
                </Campo>
              ) : (
                // En la misma moneda, lo que toma la factura es lo mismo que sale de lo pagado de más.
                <input type="hidden" name="monto_factura" value={deLaBoleta} />
              )}
              <Campo
                etiqueta="Nota de crédito o documento del descuento"
                htmlFor={campo('archivo')}
                requerido
                className="sm:col-span-2"
                ayuda="La nota de crédito del proveedor, o la factura o el estado de cuenta donde descontó lo pagado de más."
              >
                <ElegirArchivo id={campo('archivo')} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_FINANZAS} required />
              </Campo>
            </div>
          )}
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Descontar" disabled={facturas.length === 0} />
        </form>
      </Ventana>
    </>
  )
}

/**
 * Deshacer lo que Tesorería pasó a mano a una factura de lo pagado por la
 * boleta (al cambio, o descontado): la factura vuelve a deberlo y lo pagado por
 * la boleta queda sin pasar a ninguna. Con su motivo, como toda corrección.
 */
export function SoltarToma({
  ordenCompraId,
  facturaId,
  factura,
  oc,
  monto,
}: {
  ordenCompraId: string
  facturaId: string
  factura: string
  oc: string
  /** Lo que la factura tomó a mano, ya escrito con su moneda. */
  monto: string
}) {
  const [abierta, setAbierta] = useState(false)
  const avisar = useAvisoDeLaCaja()
  const { alEnviar, enviando, error } = useEnvio(soltarPagoDeLaBoleta, (r) => {
    setAbierta(false)
    avisar(r.mensaje ?? null)
  })
  const id = `soltar-${facturaId}-${ordenCompraId}`
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        tamano="sm"
        onClick={() => setAbierta(true)}
        data-soltar-toma={`${factura}|${oc}`}
        aria-label={`Deshacer lo que la factura ${factura} tomó de la boleta de la ${oc}`}
      >
        <Undo2 aria-hidden className="size-4" />
        Deshacer
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Deshacer la toma"
        descripcion={`La factura ${factura} deja de tomar ${monto} de lo pagado por la boleta de la ${oc} y vuelve a deberlos. Lo pagado por la boleta vuelve a quedar sin pasar a ninguna factura. No mueve la caja.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
          <input type="hidden" name="factura_id" value={facturaId} />
          <Campo etiqueta="Motivo" htmlFor={id} requerido>
            <AreaTexto id={id} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Deshacer" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

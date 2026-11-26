'use client'

import { Ban, FilePlus2 } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import { BUCKET_FACTURAS_VENTA, MAXIMO_MB_FINANZAS } from '@/lib/dominio/finanzas'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'

import { anularFactura, registrarFactura } from './acciones'

/** El archivo del campo, o `null` si no eligieron ninguno. Se saca del FormData: a la acción viaja solo su ruta. */
function sacarArchivo(datos: FormData): File | null {
  const archivo = datos.get('archivo')
  datos.delete('archivo')
  // Uno vacío también cuenta como elegido: lo rechaza la subida diciendo que está vacío.
  return archivo instanceof File && archivo.name !== '' ? archivo : null
}

/** Una unidad de la cotización de varias, como la ofrece el formulario de la factura. */
export type UnidadPorFacturar = {
  numero: number
  /** El código interno de su OT; nulo mientras no la tenga. */
  codigo: string | null
  /** Lo que le toca del total con IGV, si se sabe. */
  parte: number | null
  /** Lo ya facturado de esta unidad en la moneda de la cotización. */
  facturado: number
}

/** El valor de «toda la cotización» en el campo de la unidad: así lo espera `registrar_factura_venta_de_unidad`. */
const TODA = '0'

/**
 * Contabilidad registra la factura que emitió en SUNAT. El PDF sube primero a
 * Storage, en la carpeta de la factura, y si la factura no entra se retira.
 * El id de la factura vive fuera de la ventana (`useIdDelEnvio`): un reintento
 * no registra otra, y si aquella entró, la ventana lo dice al volver a abrirse y
 * la siguiente lleva otro. Si con ella lo facturado pasa del total de la
 * cotización, avisa sin impedirlo (pedido de Gerencia del 2026-10-14).
 *
 * Con `unidades`, la cotización es de varias (migración 20261126998000): la
 * factura dice de cuál es, o que es por toda la cotización, y entonces la base
 * la reparte en partes iguales. La unidad sin OT no se puede elegir, y «toda la
 * cotización» tampoco mientras falte alguna OT: la base rechaza las dos.
 */
export function RegistrarFactura({
  cotizacionId,
  numeroCotizacion,
  codigoInterno,
  hoy,
  monedaCotizacion,
  totalCotizacion,
  facturado,
  unidades,
}: {
  cotizacionId: string
  numeroCotizacion: string
  codigoInterno: string
  hoy: string
  monedaCotizacion: 'PEN' | 'USD'
  /** El total de la cotización con IGV, si se sabe. */
  totalCotizacion: number | null
  /** Lo ya facturado en la moneda de la cotización, sin las anuladas. */
  facturado: number
  /** Solo si la cotización es de varias unidades. */
  unidades?: UnidadPorFacturar[]
}) {
  const factura = useIdDelEnvio('factura_venta', undefined, cotizacionId)
  const [abierta, setAbierta] = useState(false)
  const [total, setTotal] = useState('')
  const [monedaFactura, setMonedaFactura] = useState<'PEN' | 'USD'>(monedaCotizacion)
  const conOt = (unidades ?? []).filter((u) => u.codigo)
  const todasConOt = unidades !== undefined && conOt.length === unidades.length
  // Con una sola unidad que ya tiene su OT no hay qué elegir: va esa.
  const unidadInicial = conOt.length === 1 && !todasConOt ? String(conOt[0]?.numero ?? '') : ''
  const [unidad, setUnidad] = useState(unidadInicial)
  const elegida = unidades?.find((u) => String(u.numero) === unidad) ?? null
  // Contra qué se compara el total: lo que le toca a la unidad elegida, o la cotización entera.
  const tope = elegida ? elegida.parte : totalCotizacion
  const yaFacturado = elegida ? elegida.facturado : facturado
  const conEsta = yaFacturado + (Number(total) || 0)
  const pasa = tope !== null && monedaFactura === monedaCotizacion && conEsta > tope + 0.005

  function abrir() {
    setTotal('')
    setMonedaFactura(monedaCotizacion)
    setUnidad(unidadInicial)
    factura.abrir()
    setAbierta(true)
  }

  async function registrar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Adjunta el PDF de la factura.' }
    if (!factura.id) return { ok: false, error: 'Vuelve a abrir el formulario de la factura.' }
    factura.salio()
    return subirArchivoFinanzas(BUCKET_FACTURAS_VENTA, factura.id, archivo, { 'application/pdf': 'pdf' }, (ruta) => {
      datos.set('ruta', ruta)
      datos.set('nombre_archivo', archivo.name)
      return registrarFactura(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(
    registrar,
    () => {
      setAbierta(false)
      factura.otro()
    },
    { alYaEntrar: factura.otro },
  )
  const campo = (nombre: string) => `${nombre}-${cotizacionId}`

  return (
    <>
      <Boton type="button" tamano="sm" onClick={abrir} data-registrar-factura={cotizacionId}>
        <FilePlus2 aria-hidden className="size-4" />
        Registrar factura
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={unidades ? `Factura de la cotización ${numeroCotizacion}` : `Factura del código ${codigoInterno}`}
        descripcion={
          unidades
            ? `La cotización es de ${unidades.length} unidades: di de cuál es la factura, o si es por toda la cotización. Los datos como salen en la factura que emitiste en SUNAT, con su PDF; entra sola a las cuentas por cobrar de Tesorería. Cada unidad puede llevar varias: la inicial y el saldo.`
            : `Por la cotización ${numeroCotizacion}. Los datos como salen en la factura que emitiste en SUNAT, con su PDF; entra sola a las cuentas por cobrar de Tesorería. Una cotización puede llevar varias: la inicial y el saldo.`
        }
        ancho="md"
      >
        <EnvioAnterior texto={factura.anterior} />
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={factura.id ?? ''} />
          <input type="hidden" name="cotizacion_id" value={cotizacionId} />
          {unidades && (
            <Campo
              etiqueta="De qué unidad es"
              htmlFor={campo('unidad')}
              requerido
              ayuda={
                todasConOt
                  ? 'La factura por toda la cotización (un adelanto, por ejemplo) se reparte en partes iguales entre sus unidades.'
                  : 'Se elige la unidad que ya tiene su OT. La factura por toda la cotización se registra cuando Administración cargue todas las OT.'
              }
              ayudaEnIcono={false}
            >
              <Seleccion id={campo('unidad')} name="unidad" required value={unidad} onChange={(e) => setUnidad(e.target.value)}>
                <option value="" disabled>
                  Elige la unidad…
                </option>
                {unidades.map((u) => (
                  <option key={u.numero} value={u.numero} disabled={!u.codigo}>
                    {u.codigo ? `Unidad ${u.numero} · código ${u.codigo}` : `Unidad ${u.numero} · falta su OT`}
                  </option>
                ))}
                <option value={TODA} disabled={!todasConOt}>
                  {todasConOt
                    ? `Toda la cotización · ${unidades.length} unidades, en partes iguales`
                    : 'Toda la cotización · cuando estén todas las OT'}
                </option>
              </Seleccion>
            </Campo>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Número de factura" htmlFor={campo('numero')} requerido ayuda="La serie, un guion y el número: E001-626.">
              <Entrada id={campo('numero')} name="numero" required maxLength={20} autoComplete="off" placeholder="E001-626" className="tabular uppercase" />
            </Campo>
            <Campo etiqueta="Concepto" htmlFor={campo('concepto')} ayuda="Opcional: «Inicial 50 %», «Saldo».">
              <Entrada id={campo('concepto')} name="concepto" maxLength={200} autoComplete="off" />
            </Campo>
            <Campo etiqueta="Fecha de emisión" htmlFor={campo('emision')} requerido>
              <Entrada id={campo('emision')} name="fecha_emision" type="date" required defaultValue={hoy} max={hoy} />
            </Campo>
            <Campo etiqueta="Vencimiento" htmlFor={campo('vencimiento')} requerido ayuda="Al contado, la misma fecha de emisión.">
              <Entrada id={campo('vencimiento')} name="fecha_vencimiento" type="date" required defaultValue={hoy} />
            </Campo>
            <Campo etiqueta="Moneda" htmlFor={campo('moneda')} requerido>
              <Seleccion
                id={campo('moneda')}
                name="moneda"
                value={monedaFactura}
                onChange={(e) => setMonedaFactura(e.target.value === 'USD' ? 'USD' : 'PEN')}
              >
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </Seleccion>
            </Campo>
            <Campo
              etiqueta="Total con IGV"
              htmlFor={campo('total')}
              requerido
              ayuda={
                elegida && elegida.parte !== null
                  ? `A la unidad ${elegida.numero} le tocan ${moneda(elegida.parte, monedaCotizacion)}${elegida.facturado > 0 ? `; ya se le facturó ${moneda(elegida.facturado, monedaCotizacion)}` : ''}.`
                  : totalCotizacion !== null
                    ? `La cotización es por ${moneda(totalCotizacion, monedaCotizacion)}${facturado > 0 ? `; ya se facturó ${moneda(facturado, monedaCotizacion)}` : ''}.`
                    : undefined
              }
            >
              <Entrada
                id={campo('total')}
                name="total"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="tabular"
              />
            </Campo>
          </div>
          {pasa && tope !== null && (
            <p role="status" className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
              {elegida
                ? `Con esta factura lo facturado de la unidad ${elegida.numero} llega a ${moneda(conEsta, monedaCotizacion)} y le tocan ${moneda(tope, monedaCotizacion)}.`
                : `Con esta factura lo facturado llega a ${moneda(conEsta, monedaCotizacion)} y la cotización es por ${moneda(tope, monedaCotizacion)}.`}{' '}
              Revisa el total; si está bien, regístrala igual.
            </p>
          )}
          <Campo etiqueta="PDF de la factura" htmlFor={campo('archivo')} requerido ayuda="El que descargaste de SUNAT.">
            <ElegirArchivo id={campo('archivo')} name="archivo" accept="application/pdf,.pdf" hastaMb={MAXIMO_MB_FINANZAS} required />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Registrar la factura" />
        </form>
      </Ventana>
    </>
  )
}

/** Anular con su motivo una factura mal registrada, mientras Tesorería no tenga un cobro vigente de ella. */
export function AnularFactura({ facturaId, numero }: { facturaId: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularFactura, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setAbierta(true)} data-anular-factura={numero}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular la factura ${numero}`}
        descripcion="Sale de las cuentas por cobrar de Tesorería, que recibe el aviso, y queda en el historial con su motivo. Si Tesorería ya registró un cobro, primero lo anula ella. El número queda libre para registrarla bien."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={facturaId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-factura-${facturaId}`} requerido>
            <AreaTexto id={`anular-factura-${facturaId}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

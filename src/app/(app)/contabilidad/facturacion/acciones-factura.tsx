'use client'

import { Ban, FilePlus2 } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
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

/**
 * Contabilidad registra la factura que emitió en SUNAT. El PDF sube primero a
 * Storage, en la carpeta de la factura, y si la factura no entra se retira.
 * El id de la factura vive fuera de la ventana (`useIdDelEnvio`): un reintento
 * no registra otra, y con lo facturado ya al día la siguiente lleva otro. Si con ella lo facturado pasa del total de
 * la cotización, avisa sin impedirlo (pedido de Gerencia del 2026-10-14).
 */
export function RegistrarFactura({
  cotizacionId,
  numeroCotizacion,
  codigoInterno,
  hoy,
  monedaCotizacion,
  totalCotizacion,
  facturado,
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
}) {
  const factura = useIdDelEnvio(facturado)
  const [abierta, setAbierta] = useState(false)
  const [total, setTotal] = useState('')
  const [monedaFactura, setMonedaFactura] = useState<'PEN' | 'USD'>(monedaCotizacion)
  const conEsta = facturado + (Number(total) || 0)
  const pasa = totalCotizacion !== null && monedaFactura === monedaCotizacion && conEsta > totalCotizacion + 0.005

  function abrir() {
    setTotal('')
    setMonedaFactura(monedaCotizacion)
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
        titulo={`Factura del código ${codigoInterno}`}
        descripcion={`Por la cotización ${numeroCotizacion}. Los datos como salen en la factura que emitiste en SUNAT, con su PDF; entra sola a las cuentas por cobrar de Tesorería. Una cotización puede llevar varias: la inicial y el saldo.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={factura.id ?? ''} />
          <input type="hidden" name="cotizacion_id" value={cotizacionId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Número de factura" htmlFor={campo('numero')} requerido ayuda="La serie, un guion y el número: E001-626.">
              <Entrada id={campo('numero')} name="numero" required maxLength={20} autoComplete="off" placeholder="E001-626" className="tabular uppercase" />
            </Campo>
            <Campo etiqueta="Concepto" htmlFor={campo('concepto')} ayuda="Opcional: «Inicial 50 %», «Saldo», «Unidad 2 de 3».">
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
                totalCotizacion !== null
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
          {pasa && totalCotizacion !== null && (
            <p role="status" className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
              Con esta factura lo facturado llega a {moneda(conEsta, monedaCotizacion)} y la cotización es por{' '}
              {moneda(totalCotizacion, monedaCotizacion)}. Revisa el total; si está bien, regístrala igual.
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

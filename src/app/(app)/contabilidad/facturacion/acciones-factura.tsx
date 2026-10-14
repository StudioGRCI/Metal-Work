'use client'

import { Ban, FilePlus2, Send } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import { BUCKET_FACTURAS_VENTA, MAXIMO_MB_FINANZAS } from '@/lib/dominio/finanzas'
import { useAccion, useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'

import { anexarFactura, anularFactura, enviarFacturaATesoreria } from './acciones'

/** El archivo del campo, o `null` si no eligieron ninguno. Se saca del FormData: a la acción viaja solo su ruta. */
function sacarArchivo(datos: FormData): File | null {
  const archivo = datos.get('archivo')
  datos.delete('archivo')
  return archivo instanceof File && archivo.size > 0 ? archivo : null
}

/**
 * Contabilidad anexa la factura que emitió en SUNAT. El PDF sube primero a
 * Storage, en la carpeta de la factura, y si la factura no entra se retira.
 * El id de la factura se decide al abrir la ventana: un reintento con la
 * ventana abierta no anexa otra.
 */
export function AnexarFactura({
  cotizacionId,
  numeroCotizacion,
  hoy,
  monedaCotizacion,
  totalCotizacion,
}: {
  cotizacionId: string
  numeroCotizacion: string
  hoy: string
  monedaCotizacion: 'PEN' | 'USD'
  totalCotizacion: number | null
}) {
  const [facturaId, setFacturaId] = useState<string | null>(null)

  async function anexar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Adjunta el PDF de la factura.' }
    if (!facturaId) return { ok: false, error: 'Vuelve a abrir el formulario de la factura.' }
    return subirArchivoFinanzas(BUCKET_FACTURAS_VENTA, facturaId, archivo, { 'application/pdf': 'pdf' }, (ruta) => {
      datos.set('ruta', ruta)
      datos.set('nombre_archivo', archivo.name)
      return anexarFactura(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(anexar, () => setFacturaId(null))
  const campo = (nombre: string) => `${nombre}-${cotizacionId}`

  return (
    <>
      <Boton type="button" tamano="sm" onClick={() => setFacturaId(crypto.randomUUID())} data-anexar-factura={cotizacionId}>
        <FilePlus2 aria-hidden className="size-4" />
        Anexar factura
      </Boton>
      <Ventana
        abierta={facturaId !== null}
        alCerrar={() => setFacturaId(null)}
        titulo={`Factura de la cotización ${numeroCotizacion}`}
        descripcion="Los datos como salen en la factura que emitiste en SUNAT, con su PDF. Una cotización puede llevar varias: la inicial y el saldo."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={facturaId ?? ''} />
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
              <Seleccion id={campo('moneda')} name="moneda" defaultValue={monedaCotizacion}>
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </Seleccion>
            </Campo>
            <Campo
              etiqueta="Total con IGV"
              htmlFor={campo('total')}
              requerido
              ayuda={totalCotizacion !== null ? `La cotización es por ${moneda(totalCotizacion, monedaCotizacion)}.` : undefined}
            >
              <Entrada id={campo('total')} name="total" type="number" inputMode="decimal" min="0.01" step="0.01" required className="tabular" />
            </Campo>
          </div>
          <Campo etiqueta="PDF de la factura" htmlFor={campo('archivo')} requerido ayuda={`El que descargaste de SUNAT, hasta ${MAXIMO_MB_FINANZAS} MB.`}>
            <Entrada id={campo('archivo')} name="archivo" type="file" accept="application/pdf,.pdf" required />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setFacturaId(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Anexar la factura
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** La factura anexada va a Tesorería: ahí nace su cuenta por cobrar. */
export function EnviarFactura({ facturaId, numero }: { facturaId: string; numero: string }) {
  const { ejecutar, enviando, error } = useAccion(enviarFacturaATesoreria)
  return (
    <div>
      <Boton
        type="button"
        tamano="sm"
        cargando={enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('id', facturaId)
          ejecutar(datos)
        }}
        data-enviar-factura={numero}
      >
        <Send aria-hidden className="size-4" />
        Enviar a Tesorería
      </Boton>
      {error && (
        <p role="alert" className="mt-1 text-xs text-peligro">
          {error}
        </p>
      )}
    </div>
  )
}

/** Anular con su motivo una factura mal anexada, mientras Tesorería no haya cobrado nada de ella. */
export function AnularFactura({ facturaId, numero, enTesoreria }: { facturaId: string; numero: string; enTesoreria: boolean }) {
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
        descripcion={
          enTesoreria
            ? 'Sale de las cuentas por cobrar de Tesorería, que recibe el aviso. Si Tesorería ya registró un cobro, no se anula. El número queda libre para anexarla bien.'
            : 'Queda en el historial con su motivo, y el número queda libre para anexarla bien.'
        }
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={facturaId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-factura-${facturaId}`} requerido>
            <AreaTexto id={`anular-factura-${facturaId}`} name="motivo" required minLength={10} maxLength={500} />
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

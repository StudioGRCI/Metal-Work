'use client'

import { Ban, ReceiptText } from 'lucide-react'
import { useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import { BUCKET_NOTAS_CREDITO, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import { useEnvio } from '@/lib/envio'
import { fecha, moneda } from '@/lib/format'

import { anularNotaCredito, registrarNotaCredito } from './acciones-nota-credito'
import { useAvisoDeLoAnotado } from './pago-de-boleta'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/** Lo que Almacén devolvió sin reposición de una OC de esta factura y espera su nota. */
export type DevolucionParaLaNota = { id: string; texto: string; importe: number }

/** Lo anotado, arriba de la lista si la hay (la fila puede irse de la vista); si no, a su lado. */
function useAvisar() {
  const arriba = useAvisoDeLoAnotado()
  const [aqui, setAqui] = useState<{ mensaje: string; n: number } | null>(null)
  const avisar = (mensaje: string) => (arriba ? arriba(mensaje) : setAqui((p) => ({ mensaje, n: (p?.n ?? 0) + 1 })))
  const aviso = aqui ? (
    <AvisoEnfocado key={aqui.n} className="mt-1 max-w-72 text-xs">
      {aqui.mensaje}
    </AvisoEnfocado>
  ) : null
  return { avisar, aviso }
}

/**
 * Contabilidad registra la nota de crédito del proveedor contra esta factura
 * (decisiones de DKS del 22/10, migración 20261022190000): por lo que Almacén
 * devolvió, ligada a esa devolución, o por un descuento. El PDF sube primero a
 * `notas-credito/{factura}/…`. La factura baja sola; lo que no cabe en ella
 * queda a favor y le llega a Tesorería. El id se decide al abrir la ventana: un
 * reintento del mismo envío no registra otra.
 */
export function RegistrarNotaCredito({
  factura,
  devoluciones,
  devolucionInicial,
  hoy,
  principal = false,
}: {
  factura: { id: string; numero: string; proveedor: string; moneda: string; fecha: string }
  devoluciones: DevolucionParaLaNota[]
  /** Desde «Esperan nota de crédito», la devolución de esa fila ya elegida. */
  devolucionInicial?: string
  hoy: string
  principal?: boolean
}) {
  const m = factura.moneda === 'USD' ? 'USD' : 'PEN'
  const [notaId, setNotaId] = useState<string | null>(null)
  const [tipo, setTipo] = useState<'DEVOLUCION' | 'DESCUENTO'>('DEVOLUCION')
  const [devolucion, setDevolucion] = useState('')
  const { avisar, aviso } = useAvisar()

  async function registrar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = datos.get('archivo')
    datos.delete('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta la nota de crédito.' }
    if (!notaId) return { ok: false, error: 'Vuelve a abrir el formulario de la nota.' }
    return subirArchivoFinanzas(BUCKET_NOTAS_CREDITO, factura.id, archivo, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      datos.set('ruta', ruta)
      return registrarNotaCredito(null, datos)
    })
  }
  const { alEnviar, enviando, error, limpiar } = useEnvio(registrar, (r) => {
    setNotaId(null)
    if (r.mensaje) avisar(r.mensaje)
  })

  function abrir() {
    limpiar()
    const inicial = devolucionInicial ?? (devoluciones.length === 1 ? devoluciones[0].id : '')
    setTipo(devolucionInicial || devoluciones.length > 0 ? 'DEVOLUCION' : 'DESCUENTO')
    setDevolucion(inicial)
    setNotaId(crypto.randomUUID())
  }
  const campo = (nombre: string) => `${nombre}-nota-${factura.id}${devolucionInicial ? `-${devolucionInicial}` : ''}`
  const elegida = devoluciones.find((d) => d.id === devolucion)

  return (
    <>
      {aviso}
      <Boton
        type="button"
        tamano="sm"
        variante={principal ? 'primario' : 'contorno'}
        onClick={abrir}
        data-registrar-nota={factura.numero}
        aria-label={`Registrar nota de crédito de la factura ${factura.numero}`}
      >
        <ReceiptText aria-hidden className="size-4" />
        Nota de crédito
      </Boton>
      <Ventana
        abierta={notaId !== null}
        alCerrar={() => setNotaId(null)}
        titulo={`Nota de crédito de la factura ${factura.numero}`}
        descripcion={`${factura.proveedor}. La factura baja sola por el total de la nota; si ya estaba pagada, lo que sobra queda a favor y Tesorería lo descuenta de otra factura o registra que el proveedor lo devolvió.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={notaId ?? ''} />
          <input type="hidden" name="factura" value={factura.id} />
          <Campo etiqueta="Es por" htmlFor={campo('tipo')} requerido>
            <Seleccion
              id={campo('tipo')}
              name="tipo"
              required
              value={tipo}
              onChange={(e) => {
                const t = e.target.value === 'DESCUENTO' ? 'DESCUENTO' : 'DEVOLUCION'
                setTipo(t)
                if (t === 'DESCUENTO') setDevolucion('')
              }}
            >
              <option value="DEVOLUCION">Lo que se devolvió al proveedor</option>
              <option value="DESCUENTO">Un descuento o un cobro de más</option>
            </Seleccion>
          </Campo>
          {tipo === 'DEVOLUCION' && (
            <Campo
              etiqueta="Qué devolución cubre"
              htmlFor={campo('devolucion')}
              ayuda="Lo que Almacén devolvió de una OC de esta factura y el proveedor no repone. Si la nota cubre algo que se repone, elige esa devolución: deja de esperarse la reposición y lo que falta vuelve a Logística."
            >
              <Seleccion id={campo('devolucion')} name="devolucion" value={devolucion} onChange={(e) => setDevolucion(e.target.value)}>
                <option value="">Ninguna en particular</option>
                {devoluciones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.texto}
                  </option>
                ))}
              </Seleccion>
              {elegida && (
                <p className="mt-1 text-xs text-texto-suave">Lo devuelto, al precio de la OC: {moneda(elegida.importe, m)} antes de IGV si la OC lo lleva aparte.</p>
              )}
            </Campo>
          )}
          {tipo === 'DESCUENTO' && <input type="hidden" name="devolucion" value="" />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Número de la nota" htmlFor={campo('numero')} requerido ayuda="Como viene en ella: la serie de cuatro y el número, por ejemplo FC01-123.">
              <Entrada id={campo('numero')} name="numero" required maxLength={20} autoComplete="off" className="tabular uppercase" placeholder="FC01-123" />
            </Campo>
            <Campo etiqueta="Fecha de la nota" htmlFor={campo('fecha')} requerido>
              <Entrada id={campo('fecha')} name="fecha" type="date" required defaultValue={hoy} min={factura.fecha} max={hoy} />
            </Campo>
            <Campo etiqueta={`Total de la nota (${m === 'USD' ? 'dólares' : 'soles'})`} htmlFor={campo('monto')} requerido ayuda="Con IGV, como dice la nota.">
              <Entrada id={campo('monto')} name="monto" type="number" inputMode="decimal" min="0.01" step="0.01" required className="tabular" />
            </Campo>
          </div>
          <Campo etiqueta="Qué corrige" htmlFor={campo('motivo')} requerido ayuda="Lo que dice la nota: qué se devolvió o por qué se descuenta.">
            <AreaTexto id={campo('motivo')} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          <Campo etiqueta="La nota de crédito" htmlFor={campo('archivo')} requerido ayuda="El PDF que envió el proveedor, o una foto legible.">
            <ElegirArchivo id={campo('archivo')} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_FINANZAS} required />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setNotaId(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Registrar la nota
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Anular con su motivo una nota mal registrada: su factura vuelve a deber lo que ella bajaba. */
export function AnularNotaCredito({ nota }: { nota: { id: string; numero: string; fecha: string } }) {
  const [abierta, setAbierta] = useState(false)
  const { avisar, aviso } = useAvisar()
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularNotaCredito, (r) => {
    setAbierta(false)
    if (r.mensaje) avisar(r.mensaje)
  })
  return (
    <>
      {aviso}
      <Boton
        type="button"
        variante="contornoPeligro"
        tamano="sm"
        onClick={() => {
          limpiar()
          setAbierta(true)
        }}
        data-anular-nota={nota.numero}
        aria-label={`Anular la nota de crédito ${nota.numero}`}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular la nota ${nota.numero}`}
        descripcion={`Del ${fecha(nota.fecha)}. Queda en el historial con su motivo y su PDF. La factura vuelve a deber lo que la nota bajaba, y lo que Tesorería descontó de otras facturas se quita. Si el proveedor ya devolvió dinero de ella, Tesorería anula antes esa devolución.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={nota.id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-nota-${nota.id}`} requerido>
            <AreaTexto id={`anular-nota-${nota.id}`} name="motivo" required minLength={10} maxLength={500} />
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

'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import type { CompraSinFactura } from '@/lib/datos/adquisiciones'
import { useEnvio } from '@/lib/envio'
import { moneda as dinero } from '@/lib/format'

import { completarAdquisicion, registrarAdquisicion } from './acciones'

type Props = {
  ordenes: { id: string; numero: string }[]
  compras: CompraSinFactura[]
  documentos: { id: string; nombre_archivo: string }[]
}

const mismoNombre = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
const codigo = (m: string) => (m === 'USD' ? 'USD' : 'PEN')

/**
 * Contabilidad registra una factura o un recibo. Una factura de compra cubre una
 * o varias OC del mismo proveedor y con la misma condición de pago; mientras se
 * llena, se ve si el total calza con el de las OC marcadas. Es solo un aviso: la
 * factura se registra igual.
 */
export function FormularioAdquisicion(props: Props) {
  // Al registrar, el formulario se vuelve a montar vacío y el aviso queda arriba.
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      {aviso && (
        <p role="status" className="mb-4 text-sm text-exito">
          {aviso}
        </p>
      )}
      <Formulario
        key={vuelta}
        {...props}
        alRegistrar={(mensaje) => {
          setAviso(mensaje)
          setVuelta((v) => v + 1)
        }}
        alEscribir={() => setAviso(null)}
      />
    </>
  )
}

function Formulario({
  ordenes,
  compras,
  documentos,
  alRegistrar,
  alEscribir,
}: Props & { alRegistrar: (mensaje: string) => void; alEscribir: () => void }) {
  const [marcadas, setMarcadas] = useState<string[]>([])
  const [proveedor, setProveedor] = useState('')
  const [condicion, setCondicion] = useState('CONTADO')
  const [monedaFactura, setMonedaFactura] = useState('PEN')
  const [total, setTotal] = useState('')
  const [ot, setOt] = useState('')
  const { alEnviar, enviando, error } = useEnvio(registrarAdquisicion, (r) => alRegistrar(r.mensaje ?? 'Comprobante registrado.'))

  const elegidas = compras.filter((c) => marcadas.includes(c.orden_compra_id))
  const base = elegidas[0]
  const encaja = (c: CompraSinFactura) => !base || (mismoNombre(c.proveedor, base.proveedor) && c.condicion_pago === base.condicion_pago)

  function marcar(c: CompraSinFactura, si: boolean) {
    alEscribir()
    if (!si) return setMarcadas((m) => m.filter((id) => id !== c.orden_compra_id))
    if (marcadas.length === 0) {
      if (!proveedor.trim()) setProveedor(c.proveedor)
      setCondicion(c.condicion_pago)
      setMonedaFactura(c.moneda)
      if (!ot && c.orden_id) setOt(c.orden_id)
    }
    setMarcadas((m) => [...m, c.orden_compra_id])
  }

  return (
    <form onSubmit={alEnviar} onChange={alEscribir} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Campo etiqueta="Tipo de comprobante" htmlFor="adq-tipo" requerido>
        <Seleccion id="adq-tipo" name="tipo" required>
          <option value="FACTURA_COMPRA">Factura de compra</option>
          <option value="RECIBO_HONORARIOS">Recibo por honorarios</option>
          <option value="FACTURA_VEHICULO">Factura de vehículo</option>
          <option value="FACTURA_TESORERIA">Factura de Tesorería</option>
          <option value="OTRO">Otro comprobante</option>
        </Seleccion>
      </Campo>
      <Campo etiqueta="Proveedor o emisor" htmlFor="adq-proveedor" requerido>
        <Entrada id="adq-proveedor" name="proveedor" minLength={2} maxLength={160} required value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
      </Campo>
      <Campo etiqueta="Número de comprobante" htmlFor="adq-numero" requerido>
        <Entrada id="adq-numero" name="numero_documento" minLength={3} maxLength={80} required autoComplete="off" className="tabular" />
      </Campo>

      <fieldset className="sm:col-span-2 xl:col-span-3">
        <legend className="text-sm font-medium text-texto">Órdenes de compra de esta factura</legend>
        <p className="mt-0.5 text-xs text-texto-suave">
          Marca una o varias, del mismo proveedor y con la misma condición de pago. Si es un recibo o un gasto sin OC, no marques ninguna.
        </p>
        {compras.length === 0 ? (
          <p className="mt-2 rounded-[var(--radius-base)] border border-dashed border-borde p-3 text-sm text-texto-suave">
            Ninguna OC espera su factura. Aparecen cuando Logística emite una OC con factura.
          </p>
        ) : (
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-[var(--radius-base)] border border-borde p-2">
            {compras.map((c) => {
              const marcada = marcadas.includes(c.orden_compra_id)
              const libre = marcada || encaja(c)
              return (
                <li key={c.orden_compra_id}>
                  <label
                    className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] px-2 py-1.5 text-sm sm:min-h-0 ${libre ? 'hover:bg-superficie-2' : 'cursor-not-allowed opacity-50'}`}
                  >
                    <input
                      type="checkbox"
                      name="ordenes_compra"
                      value={c.orden_compra_id}
                      checked={marcada}
                      disabled={!libre}
                      onChange={(e) => marcar(c, e.target.checked)}
                      className="mt-0.5 size-4 accent-[var(--acento)]"
                    />
                    <span className="flex-1">
                      <span className="tabular font-medium text-texto">{c.numero ?? c.referencia}</span>
                      <span className="text-texto"> · {c.proveedor}</span>
                      <span className="block text-xs text-texto-suave">
                        {c.numero_ot ? `OT ${c.numero_ot}` : 'Para almacén'} · {c.condicion_pago === 'CREDITO' ? 'crédito' : 'contado'}
                        {c.en_borrador && ' · ya está en un borrador'}
                      </span>
                    </span>
                    <span className="tabular text-sm text-texto">
                      {c.sin_precio ? <span className="text-aviso">Sin precio</span> : dinero(c.total, codigo(c.moneda))}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      <Campo etiqueta="OT relacionada" htmlFor="adq-ot" ayuda="Sale sola de la OC marcada, si tiene OT.">
        <Seleccion id="adq-ot" name="orden_id" value={ot} onChange={(e) => setOt(e.target.value)}>
          <option value="">Sin OT específica</option>
          {ordenes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.numero}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Moneda" htmlFor="adq-moneda">
        <Seleccion id="adq-moneda" name="moneda" value={monedaFactura} onChange={(e) => setMonedaFactura(e.target.value)}>
          <option value="PEN">Soles</option>
          <option value="USD">Dólares</option>
        </Seleccion>
      </Campo>
      <Campo etiqueta="Fecha de emisión" htmlFor="adq-emision" requerido>
        <Entrada id="adq-emision" name="fecha_emision" type="date" required />
      </Campo>
      <Campo etiqueta="Condición de pago" htmlFor="adq-condicion">
        <Seleccion id="adq-condicion" name="condicion_pago" value={condicion} onChange={(e) => setCondicion(e.target.value)}>
          <option value="CONTADO">Contado</option>
          <option value="CREDITO">Crédito</option>
        </Seleccion>
      </Campo>
      <Campo
        etiqueta="Vencimiento"
        htmlFor="adq-vencimiento"
        requerido
        ayuda={condicion === 'CONTADO' ? 'Debe ser igual a la emisión.' : 'Indica la fecha pactada con el proveedor.'}
      >
        <Entrada id="adq-vencimiento" name="fecha_vencimiento" type="date" required />
      </Campo>
      <Campo etiqueta="Total, con IGV" htmlFor="adq-total" requerido>
        <Entrada
          id="adq-total"
          name="total"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          required
          className="tabular"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </Campo>
      <AvisoDeMonto elegidas={elegidas} total={total} monedaFactura={monedaFactura} />

      <Campo etiqueta="Factura ya subida por Logística" htmlFor="adq-documento">
        <Seleccion id="adq-documento" name="documento_compra_id" defaultValue="">
          <option value="">Ninguna; subiré un PDF</option>
          {documentos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre_archivo}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="PDF del comprobante" htmlFor="adq-pdf" ayuda="Obligatorio si no eliges una factura de Logística.">
        <Entrada id="adq-pdf" name="pdf" type="file" accept="application/pdf,.pdf" />
      </Campo>
      <Campo etiqueta="Observación" htmlFor="adq-nota" className="sm:col-span-2 xl:col-span-3">
        <AreaTexto id="adq-nota" name="observacion" maxLength={1000} />
      </Campo>
      <div className="space-y-2 sm:col-span-2 xl:col-span-3">
        <Boton type="submit" cargando={enviando}>
          Registrar comprobante
        </Boton>
        {error && (
          <p role="alert" className="text-sm text-peligro">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}

/** Cuánto suman las OC marcadas frente al total de la factura. No frena nada. */
function AvisoDeMonto({ elegidas, total, monedaFactura }: { elegidas: CompraSinFactura[]; total: string; monedaFactura: string }) {
  if (elegidas.length === 0) return null
  const clase = 'self-end text-sm sm:col-span-2 xl:col-span-3'
  if (elegidas.some((c) => c.sin_precio || c.moneda !== monedaFactura)) {
    return (
      <p className={`${clase} text-texto-suave`}>
        Una de las OC marcadas no tiene precio o está en otra moneda: el monto no se puede comparar.
      </p>
    )
  }
  const m = codigo(monedaFactura)
  const suma = Math.round(elegidas.reduce((n, c) => n + Number(c.total), 0) * 100) / 100
  const escrito = Number(total)
  if (!total || !Number.isFinite(escrito) || escrito <= 0) {
    return <p className={`${clase} text-texto-suave`}>Las OC marcadas suman {dinero(suma, m)}, con IGV si van con factura.</p>
  }
  const diferencia = Math.round((escrito - suma) * 100) / 100
  if (Math.abs(diferencia) <= 1) {
    return <p className={`${clase} text-exito`}>Calza con las OC marcadas: suman {dinero(suma, m)}.</p>
  }
  return (
    <p role="status" className={`${clase} text-aviso`}>
      Las OC marcadas suman {dinero(suma, m)} y la factura dice {dinero(escrito, m)}: {diferencia > 0 ? 'sobran' : 'faltan'}{' '}
      {dinero(Math.abs(diferencia), m)}. Es solo un aviso: si la factura cubre otra cosa o falta una OC, puedes registrarla igual.
    </p>
  )
}

export function CompletarAdquisicion({ id }: { id: string }) {
  const { alEnviar, enviando, error, resultado } = useEnvio(completarAdquisicion)
  return (
    <form onSubmit={alEnviar} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="PDF pendiente" htmlFor={`pdf-${id}`} requerido>
        <Entrada id={`pdf-${id}`} name="pdf" type="file" accept="application/pdf,.pdf" required />
      </Campo>
      <Boton type="submit" tamano="sm" cargando={enviando}>
        Completar comprobante
      </Boton>
      {error && (
        <p role="alert" className="basis-full text-xs text-peligro">
          {error}
        </p>
      )}
      {resultado?.ok && (
        <p role="status" className="basis-full text-xs text-exito">
          {resultado.mensaje}
        </p>
      )}
    </form>
  )
}

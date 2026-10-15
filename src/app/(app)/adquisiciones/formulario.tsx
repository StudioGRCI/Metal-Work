'use client'

import { useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import type { CompraSinFactura } from '@/lib/datos/adquisiciones'
import { avisosDelDetector, numeroDeOc, textoDelAviso, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { useEnvio } from '@/lib/envio'
import { moneda as dinero } from '@/lib/format'
import { ACEPTA_XML_FACTURA, camposDeLectura, leerFactura, leerFacturaDeEnlace } from '@/lib/leer-factura'

import { completarAdquisicion, enlaceDeFacturaDeLogistica, registrarAdquisicion } from './acciones'

type Fuente = 'xml' | 'pdf' | 'logistica'

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
 *
 * El detector lee la factura apenas se adjunta (el XML de SUNAT, el PDF o la que
 * subió Logística): llena el total, el número, la fecha y las OC que menciona si
 * están vacíos, y avisa lo que no calza. Lo leído se guarda con el comprobante.
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
  const [numero, setNumero] = useState('')
  const [emision, setEmision] = useState('')
  // Lo que leyó el detector de cada fuente; manda el XML, después el PDF, después el de Logística.
  const [lecturas, setLecturas] = useState<Record<Fuente, LecturaFactura | null | undefined>>({ xml: undefined, pdf: undefined, logistica: undefined })
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const turno = useRef<Record<Fuente, number>>({ xml: 0, pdf: 0, logistica: 0 })
  const { alEnviar, enviando, error } = useEnvio(registrarAdquisicion, (r) => alRegistrar(r.mensaje ?? 'Comprobante registrado.'))

  const elegidas = compras.filter((c) => marcadas.includes(c.orden_compra_id))
  const base = elegidas[0]
  const encaja = (c: CompraSinFactura) => !base || (mismoNombre(c.proveedor, base.proveedor) && c.condicion_pago === base.condicion_pago)
  const lectura = lecturas.xml ?? lecturas.pdf ?? lecturas.logistica ?? null
  const sinLeer = (['xml', 'pdf', 'logistica'] as const).some((f) => lecturas[f] === null) && !lectura

  /**
   * Lee la factura sin pedir nada a nadie. Lo que está vacío se llena con lo leído;
   * lo que ya se escribió no se toca: si no calza, se avisa.
   */
  async function detectar(fuente: Fuente, leer: (() => Promise<LecturaFactura | null>) | null) {
    const vez = ++turno.current[fuente]
    if (!leer) return setLecturas((l) => ({ ...l, [fuente]: undefined }))
    const sinMarcar = marcadas.length === 0
    setLeyendo('Leyendo la factura…')
    const leida = await leer().catch(() => null)
    if (vez !== turno.current[fuente]) return
    setLeyendo(null)
    setLecturas((l) => ({ ...l, [fuente]: leida }))
    if (!leida) return
    if (leida.total !== null) setTotal((t) => t || leida.total!.toFixed(2))
    if (leida.numero) setNumero((n) => n || leida.numero!)
    if (leida.fecha_emision) setEmision((e) => e || leida.fecha_emision!)
    if (!sinMarcar) return
    // Las OC que nombra la factura y esperan la suya, del mismo proveedor y condición que la primera.
    const nombradas = compras.filter((c) => leida.ordenes.includes(numeroDeOc(c.numero) ?? ''))
    const primera = nombradas.at(0)
    if (primera) {
      const juntas = nombradas.filter((c) => mismoNombre(c.proveedor, primera.proveedor) && c.condicion_pago === primera.condicion_pago)
      setMarcadas((m) => (m.length > 0 ? m : juntas.map((c) => c.orden_compra_id)))
      setProveedor((p) => p.trim() || primera.proveedor)
      setCondicion(primera.condicion_pago)
      setMonedaFactura(primera.moneda)
      if (primera.orden_id) setOt((o) => o || primera.orden_id!)
    } else if (leida.moneda) setMonedaFactura(leida.moneda)
  }

  const avisos = lectura
    ? avisosDelDetector({
        lectura,
        total: Number(total) > 0 ? Number(total) : null,
        moneda: monedaFactura,
        numero,
        marcadas: elegidas,
        disponibles: compras,
      })
    : []

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
        <Entrada
          id="adq-numero"
          name="numero_documento"
          minLength={3}
          maxLength={80}
          required
          autoComplete="off"
          className="tabular"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
        />
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
        <Entrada id="adq-emision" name="fecha_emision" type="date" required value={emision} onChange={(e) => setEmision(e.target.value)} />
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
      <DetectorDeFactura
        lectura={lectura}
        leyendo={leyendo}
        sinLeer={sinLeer}
        avisos={avisos.map((a) => ({
          texto: textoDelAviso(a, (monto, m) => dinero(monto, m)),
          marcar: a.tipo === 'OC_NO_MARCADA' && a.espera ? compras.find((c) => (c.numero ?? c.referencia) === a.oc && encaja(c)) : undefined,
        }))}
        alMarcar={(c) => marcar(c, true)}
      />
      {Object.entries(camposDeLectura(lectura)).map(([nombre, valor]) => (
        <input key={nombre} type="hidden" name={nombre} value={valor} />
      ))}

      <Campo etiqueta="Factura ya subida por Logística" htmlFor="adq-documento">
        <Seleccion
          id="adq-documento"
          name="documento_compra_id"
          defaultValue=""
          onChange={(e) => {
            const id = e.target.value
            void detectar(
              'logistica',
              id
                ? async () => {
                    const url = await enlaceDeFacturaDeLogistica(id)
                    return url ? leerFacturaDeEnlace(url, setLeyendo) : null
                  }
                : null,
            )
          }}
        >
          <option value="">Ninguna; subiré un PDF</option>
          {documentos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre_archivo}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="PDF del comprobante" htmlFor="adq-pdf" ayuda="Obligatorio si no eliges una factura de Logística.">
        <Entrada
          id="adq-pdf"
          name="pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => {
            const archivo = e.target.files?.[0]
            void detectar('pdf', archivo ? () => leerFactura(archivo, setLeyendo) : null)
          }}
        />
      </Campo>
      <Campo
        etiqueta="XML de SUNAT (opcional)"
        htmlFor="adq-xml"
        ayuda="Si el proveedor lo mandó, el detector lo lee primero: es el documento legal. Solo se lee, no se guarda."
      >
        <Entrada
          id="adq-xml"
          type="file"
          accept={ACEPTA_XML_FACTURA}
          onChange={(e) => {
            const archivo = e.target.files?.[0]
            void detectar('xml', archivo ? () => leerFactura(archivo, setLeyendo) : null)
          }}
        />
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

const FUENTE: Record<LecturaFactura['fuente'], string> = { XML: 'el XML de SUNAT', PDF: 'el PDF', OCR: 'el escaneo' }

/**
 * Lo que leyó el detector y lo que no calza. Callado mientras no hay factura;
 * si la factura no se pudo leer, lo dice en una línea y nada más.
 */
function DetectorDeFactura({
  lectura,
  leyendo,
  sinLeer,
  avisos,
  alMarcar,
}: {
  lectura: LecturaFactura | null
  leyendo: string | null
  sinLeer: boolean
  avisos: { texto: string; marcar?: CompraSinFactura }[]
  alMarcar: (c: CompraSinFactura) => void
}) {
  const clase = 'text-sm sm:col-span-2 xl:col-span-3'
  if (leyendo) {
    return (
      <p role="status" className={`${clase} text-texto-suave`}>
        {leyendo}
      </p>
    )
  }
  if (!lectura) {
    return sinLeer ? (
      <p className={`${clase} text-texto-suave`}>No se pudo leer la factura: revisa a mano el total y las OC.</p>
    ) : null
  }
  const m = lectura.moneda ?? 'PEN'
  const leido = [
    lectura.total !== null ? `total ${dinero(lectura.total, m)}` : null,
    lectura.numero,
    lectura.ordenes.length > 0 ? `menciona ${lectura.ordenes.map((n) => `OC ${n}`).join(', ')}` : 'no menciona OC',
  ].filter(Boolean)
  return (
    <div className={`${clase} space-y-1`}>
      <p className="text-xs text-texto-suave">
        Leído de {FUENTE[lectura.fuente]}: {leido.join(' · ')}.
      </p>
      {avisos.length > 0 && (
        <ul role="status" className="space-y-1 text-aviso">
          {avisos.map((a) => (
            <li key={a.texto} className="flex flex-wrap items-center gap-2">
              <span>{a.texto}</span>
              {a.marcar && (
                <Boton type="button" variante="contorno" tamano="sm" onClick={() => alMarcar(a.marcar!)}>
                  Marcarla
                </Boton>
              )}
            </li>
          ))}
          <li className="text-xs text-texto-suave">Es solo un aviso: puedes registrarla igual.</li>
        </ul>
      )}
    </div>
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
  // El detector también lee el PDF pendiente; el aviso sale en la lista al registrarlo.
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const turno = useRef(0)
  return (
    <form onSubmit={alEnviar} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      {Object.entries(camposDeLectura(lectura)).map(([nombre, valor]) => (
        <input key={nombre} type="hidden" name={nombre} value={valor} />
      ))}
      <Campo etiqueta="PDF pendiente" htmlFor={`pdf-${id}`} requerido>
        <Entrada
          id={`pdf-${id}`}
          name="pdf"
          type="file"
          accept="application/pdf,.pdf"
          required
          onChange={async (e) => {
            const archivo = e.target.files?.[0]
            const vez = ++turno.current
            setLectura(null)
            if (!archivo) return
            setLeyendo(true)
            const leida = await leerFactura(archivo)
            if (vez !== turno.current) return
            setLeyendo(false)
            setLectura(leida)
          }}
        />
      </Campo>
      <Boton type="submit" tamano="sm" cargando={enviando || leyendo}>
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

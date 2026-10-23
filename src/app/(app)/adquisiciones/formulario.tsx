'use client'

import { useId, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import type { CompraSinFactura, FacturaDeLogistica } from '@/lib/datos/adquisiciones'
import { nombreDeOc, ocParaDetector } from '@/lib/dominio/adquisiciones'
import { nombreMoneda } from '@/lib/dominio/caja'
import { avisosDelDetector, numeroDeOc, textoDelAviso, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { useEnvio } from '@/lib/envio'
import { fecha as dia, moneda as dinero } from '@/lib/format'
import { ACEPTA_XML_FACTURA, camposDeLectura, leerFactura, leerFacturaDeEnlace } from '@/lib/leer-factura'

import { completarAdquisicion, enlaceDeFacturaDeLogistica, registrarAdquisicion } from './acciones'

type Fuente = 'xml' | 'pdf' | 'logistica'

const ACEPTA_PDF = 'application/pdf,.pdf'

type Props = {
  ordenes: { id: string; numero: string }[]
  compras: CompraSinFactura[]
  /** Las facturas que Logística anexó a sus OC y todavía nadie registra. */
  documentos: FacturaDeLogistica[]
}

const mismoNombre = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
/** El mismo proveedor: por el RUC si las dos lo tienen; si no, por el nombre (como `public.mismo_emisor`). */
const mismoEmisor = (a: { ruc: string | null; proveedor: string }, b: { ruc: string | null; proveedor: string }) =>
  a.ruc && b.ruc ? a.ruc === b.ruc : mismoNombre(a.proveedor, b.proveedor)
const soloDigitos = (t: string) => t.replace(/\D/g, '')
const codigo = (m: string) => (m === 'USD' ? 'USD' : 'PEN')

/** Lo que falta facturar de una OC: su total menos lo que ya cubren otras facturas. */
const pendiente = (c: CompraSinFactura) => Math.max(Math.round((Number(c.total) - c.facturado) * 100) / 100, 0)

/**
 * Contabilidad registra una factura o un recibo. Una factura de compra cubre una
 * o varias OC del mismo proveedor y con la misma condición de pago, y una OC
 * puede ir en varias facturas: la que cubre solo una parte se marca como
 * parcial. Mientras se llena, se ve si el total calza con lo que falta facturar
 * de las OC marcadas. Es solo un aviso: la factura se registra igual.
 *
 * La factura que Logística anexó a la OC trae su número y su fecha: al elegirla
 * se llenan, y se marca su OC.
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
  const [parciales, setParciales] = useState<string[]>([])
  const [proveedor, setProveedor] = useState('')
  const [tipo, setTipo] = useState('FACTURA_COMPRA')
  // El RUC de quien emitió la factura: lo pone su OC o lo lee el detector; si no, lo escribe Contabilidad.
  const [ruc, setRuc] = useState('')
  // La factura que anexó Logística, si se eligió: su OC pone el proveedor.
  const [elegida, setElegida] = useState<FacturaDeLogistica | null>(null)
  const [condicion, setCondicion] = useState('CONTADO')
  const [monedaFactura, setMonedaFactura] = useState('PEN')
  const [total, setTotal] = useState('')
  const [ot, setOt] = useState('')
  const [numero, setNumero] = useState('')
  const [emision, setEmision] = useState('')
  // Lo que leyó el detector de cada fuente; manda el XML, después el PDF, después el de Logística.
  const [lecturas, setLecturas] = useState<Record<Fuente, LecturaFactura | null | undefined>>({ xml: undefined, pdf: undefined, logistica: undefined })
  // Lo que está leyendo cada fuente: el PDF y el XML lo dicen en su campo; la de Logística, abajo.
  const [leyendo, setLeyendo] = useState<Record<Fuente, string | null>>({ xml: null, pdf: null, logistica: null })
  // Por qué el PDF o el XML elegido no sirve: va en su campo, y no se lee.
  const [avisoArchivo, setAvisoArchivo] = useState<Record<'xml' | 'pdf', string | null>>({ xml: null, pdf: null })
  const turno = useRef<Record<Fuente, number>>({ xml: 0, pdf: 0, logistica: 0 })
  const { alEnviar, enviando, error } = useEnvio(registrarAdquisicion, (r) => alRegistrar(r.mensaje ?? 'Comprobante registrado.'))

  const elegidas = compras.filter((c) => marcadas.includes(c.orden_compra_id))
  const enParte = elegidas.filter((c) => parciales.includes(c.orden_compra_id))
  const base = elegidas[0]
  const encaja = (c: CompraSinFactura) => !base || (mismoEmisor(c, base) && c.condicion_pago === base.condicion_pago)
  // Con el RUC escrito, la OC de otro RUC no se liga (migración 20261022170000): se dice antes de registrar.
  const rucEscrito = soloDigitos(ruc)
  // La OC del anexo de Logística también: su RUC sale lleno, pero se puede corregir
  // si Logística anexó la factura de otra empresa, y entonces se avisa aquí.
  const conRuc = [
    ...(elegida?.ruc ? [{ nombre: elegida.oc, ruc: elegida.ruc }] : []),
    ...elegidas.map((c) => ({ nombre: nombreDeOc(c), ruc: c.ruc })),
  ]
  const deOtroRuc = rucEscrito.length === 11 ? conRuc.find((c) => c.ruc && c.ruc !== rucEscrito) : undefined
  const lectura = lecturas.xml ?? lecturas.pdf ?? lecturas.logistica ?? null
  const enCurso = Object.values(leyendo).some(Boolean)
  const sinLeer = (['xml', 'pdf', 'logistica'] as const).some((f) => lecturas[f] === null) && !lectura && !enCurso

  /**
   * Lee la factura sin pedir nada a nadie. Lo que está vacío se llena con lo leído;
   * lo que ya se escribió no se toca: si no calza, se avisa. Sin `leer`, deja sin
   * efecto lo que esa fuente había leído o estaba leyendo.
   */
  async function detectar(fuente: Fuente, leer: ((progreso: (texto: string) => void) => Promise<LecturaFactura | null>) | null) {
    const vez = ++turno.current[fuente]
    // Lo que diga una lectura que otra ya reemplazó no llega a la pantalla.
    const anotar = (texto: string | null) => {
      if (vez === turno.current[fuente]) setLeyendo((l) => ({ ...l, [fuente]: texto }))
    }
    // Lo leído del archivo anterior no se queda a la vista mientras se lee el nuevo.
    setLecturas((l) => ({ ...l, [fuente]: undefined }))
    anotar(leer ? 'Leyendo la factura…' : null)
    if (!leer) return
    const sinMarcar = marcadas.length === 0
    const leida = await leer(anotar).catch(() => null)
    if (vez !== turno.current[fuente]) return
    anotar(null)
    setLecturas((l) => ({ ...l, [fuente]: leida }))
    if (!leida) return
    if (leida.total !== null) setTotal((t) => t || leida.total!.toFixed(2))
    if (leida.numero) setNumero((n) => n || leida.numero!)
    if (leida.fecha_emision) setEmision((e) => e || leida.fecha_emision!)
    if (leida.ruc) setRuc((r) => r || leida.ruc!)
    if (!sinMarcar) return
    // Las OC que nombra la factura y esperan la suya, del mismo proveedor y condición que la primera.
    // La OC sin número, por su referencia: es lo que cita la factura del proveedor.
    const nombradas = compras.filter((c) => leida.ordenes.includes(numeroDeOc(ocParaDetector(c).numero) ?? ''))
    const primera = nombradas.at(0)
    if (primera) {
      const juntas = nombradas.filter((c) => mismoEmisor(c, primera) && c.condicion_pago === primera.condicion_pago)
      setMarcadas((m) => (m.length > 0 ? m : juntas.map((c) => c.orden_compra_id)))
      setProveedor((p) => p.trim() || primera.proveedor)
      if (primera.ruc) setRuc((r) => r || primera.ruc!)
      setCondicion(primera.condicion_pago)
      setMonedaFactura(primera.moneda)
      if (primera.orden_id) setOt((o) => o || primera.orden_id!)
    } else if (leida.moneda) setMonedaFactura(leida.moneda)
  }

  /**
   * El PDF o el XML que se eligió: antes de leerlo se mira que sea lo que dice. Un
   * Word con el nombre cambiado a «.pdf» queda en rojo en su campo y no se lee.
   */
  async function elegirArchivo(fuente: 'xml' | 'pdf', archivo: File | undefined, accept: string, hastaMb: number) {
    void detectar(fuente, null)
    setAvisoArchivo((a) => ({ ...a, [fuente]: null }))
    if (!archivo) return
    const vez = turno.current[fuente]
    const motivo = await revisarArchivo(archivo, accept, hastaMb)
    if (vez !== turno.current[fuente]) return
    if (motivo) return setAvisoArchivo((a) => ({ ...a, [fuente]: motivo }))
    void detectar(fuente, (progreso) => leerFactura(archivo, progreso))
  }

  const avisos = lectura
    ? avisosDelDetector({
        lectura,
        total: Number(total) > 0 ? Number(total) : null,
        moneda: monedaFactura,
        numero,
        ruc: rucEscrito,
        marcadas: elegidas.map(ocParaDetector),
        disponibles: compras.map(ocParaDetector),
      })
    : []

  function marcar(c: CompraSinFactura, si: boolean) {
    alEscribir()
    if (!si) {
      setParciales((p) => p.filter((id) => id !== c.orden_compra_id))
      return setMarcadas((m) => m.filter((id) => id !== c.orden_compra_id))
    }
    if (marcadas.length === 0) {
      if (!proveedor.trim()) setProveedor(c.proveedor)
      if (!ruc.trim() && c.ruc) setRuc(c.ruc)
      setCondicion(c.condicion_pago)
      setMonedaFactura(c.moneda)
      if (!ot && c.orden_id) setOt(c.orden_id)
    }
    setMarcadas((m) => (m.includes(c.orden_compra_id) ? m : [...m, c.orden_compra_id]))
  }

  /**
   * La factura de Logística trae su número, su fecha, su OC y el proveedor de su
   * OC: el número y la fecha se llenan si están vacíos; el proveedor es el de su
   * OC y no se cambia, porque con él la base reconoce la misma factura
   * (migración 20261020210000). La OC con boleta no está entre las que esperan
   * factura, así que el proveedor no llega marcándola.
   */
  function elegirDeLogistica(id: string) {
    const d = documentos.find((x) => x.id === id) ?? null
    setElegida(d)
    if (d?.numero) setNumero((n) => n || d.numero!)
    if (d?.fecha) setEmision((e) => e || d.fecha!)
    if (d?.proveedor) setProveedor(d.proveedor)
    if (d?.ruc) setRuc(d.ruc)
    const c = d && compras.find((x) => x.orden_compra_id === d.orden_compra_id)
    if (c && !marcadas.includes(c.orden_compra_id) && encaja(c)) marcar(c, true)
    void detectar(
      'logistica',
      id
        ? async (progreso) => {
            const url = await enlaceDeFacturaDeLogistica(id)
            return url ? leerFacturaDeEnlace(url, progreso) : null
          }
        : null,
    )
  }

  return (
    <form
      onSubmit={(e) => {
        // Con el RUC de otra OC, el aviso del campo ya dice por qué: no se envía para recibir el mismo rechazo.
        if (deOtroRuc) {
          e.preventDefault()
          return document.getElementById('adq-ruc')?.focus()
        }
        return alEnviar(e)
      }}
      onChange={alEscribir}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <Campo etiqueta="Tipo de comprobante" htmlFor="adq-tipo" requerido>
        <Seleccion id="adq-tipo" name="tipo" required value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="FACTURA_COMPRA">Factura de compra</option>
          <option value="RECIBO_HONORARIOS">Recibo por honorarios</option>
          <option value="FACTURA_VEHICULO">Factura de vehículo</option>
          <option value="FACTURA_TESORERIA">Factura de Tesorería</option>
          <option value="OTRO">Otro comprobante</option>
        </Seleccion>
      </Campo>
      <Campo
        etiqueta="Proveedor o emisor"
        htmlFor="adq-proveedor"
        requerido
        ayuda={elegida?.proveedor ? `El de la ${elegida.oc}, a la que Logística anexó la factura.` : undefined}
      >
        <Entrada
          id="adq-proveedor"
          name="proveedor"
          minLength={2}
          maxLength={160}
          required
          value={proveedor}
          readOnly={Boolean(elegida?.proveedor)}
          // Sale de la OC del anexo y no se escribe: que no parezca un campo abierto.
          className="read-only:cursor-default read-only:bg-superficie-2"
          onChange={(e) => setProveedor(e.target.value)}
        />
      </Campo>
      <Campo
        etiqueta="RUC del emisor"
        htmlFor="adq-ruc"
        requerido={tipo === 'FACTURA_COMPRA'}
        ayuda={
          elegida?.ruc
            ? `El del proveedor de la ${elegida.oc}: corrígelo si la factura es de otra empresa.`
            : 'El de quien emitió la factura, tal como sale en ella: la factura se liga solo a las OC de ese RUC.'
        }
      >
        <Entrada
          id="adq-ruc"
          name="ruc_proveedor"
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          pattern={'\\D*(\\d\\D*){11}'}
          title="Los 11 dígitos del RUC."
          required={tipo === 'FACTURA_COMPRA'}
          aria-invalid={deOtroRuc ? true : undefined}
          aria-describedby={deOtroRuc ? 'adq-ruc-otro' : undefined}
          className="tabular"
          value={ruc}
          onChange={(e) => setRuc(e.target.value)}
        />
        {deOtroRuc && (
          <p id="adq-ruc-otro" role="alert" className="text-xs text-peligro">
            La {deOtroRuc.nombre} es del RUC {deOtroRuc.ruc}: una factura se liga solo a las OC de su RUC.
          </p>
        )}
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
                      <span className="tabular font-medium text-texto">{c.numero ?? 'OC sin número'}</span>
                      <span className="text-texto"> · {c.proveedor}</span>
                      {/* La de antes de la serie no tiene número: su referencia es la cotización del proveedor. */}
                      {!c.numero && c.referencia && (
                        <span className="block text-xs text-texto-suave">
                          Ref. del proveedor: <span className="tabular whitespace-nowrap">{c.referencia}</span>
                        </span>
                      )}
                      <span className="block text-xs text-texto-suave">
                        {c.numero_ot ? `OT ${c.numero_ot}` : 'Para almacén'} · {c.condicion_pago === 'CREDITO' ? 'crédito' : 'contado'}
                        {c.en_borrador && ' · ya está en un borrador'}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-right tabular text-sm text-texto">
                      {c.sin_precio ? <span className="text-aviso">Sin precio</span> : dinero(c.total, codigo(c.moneda))}
                      {!c.sin_precio && c.facturado > 0 && (
                        <span className="block text-xs text-texto-suave">falta {dinero(pendiente(c), codigo(c.moneda))}</span>
                      )}
                    </span>
                  </label>
                  {c.facturas.length > 0 && (
                    <p className="ml-9 text-xs text-texto-suave">
                      Ya va en {c.facturas.join(', ')} por {dinero(c.facturado, codigo(c.moneda))}.
                    </p>
                  )}
                  {marcada && (
                    <label className="ml-9 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-texto sm:min-h-0">
                      <input
                        type="checkbox"
                        name="parciales"
                        value={c.orden_compra_id}
                        checked={parciales.includes(c.orden_compra_id)}
                        onChange={(e) =>
                          setParciales((p) => (e.target.checked ? [...p, c.orden_compra_id] : p.filter((id) => id !== c.orden_compra_id)))
                        }
                        className="size-4 accent-[var(--acento)]"
                      />
                      Esta factura cubre solo una parte de la OC: el resto va en otra factura
                    </label>
                  )}
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
      <AvisoDeMonto elegidas={elegidas} enParte={enParte} total={total} monedaFactura={monedaFactura} />
      <DetectorDeFactura
        lectura={lectura}
        leyendo={leyendo.logistica}
        sinLeer={sinLeer}
        avisos={avisos.map((a) => ({
          texto: textoDelAviso(a, (monto, m) => dinero(monto, m)),
          // El aviso la nombra como `nombreDeOc` (por `ocParaDetector`): se busca igual.
          marcar: a.tipo === 'OC_NO_MARCADA' && a.espera ? compras.find((c) => nombreDeOc(c) === a.oc && encaja(c)) : undefined,
        }))}
        alMarcar={(c) => marcar(c, true)}
      />
      {Object.entries(camposDeLectura(lectura)).map(([nombre, valor]) => (
        <input key={nombre} type="hidden" name={nombre} value={valor} />
      ))}

      <Campo
        etiqueta="Factura que anexó Logística"
        htmlFor="adq-documento"
        ayuda={documentos.length > 0 ? 'Al elegirla se llenan su número, su fecha y su OC.' : 'Ninguna espera su registro.'}
      >
        <Seleccion id="adq-documento" name="documento_compra_id" defaultValue="" onChange={(e) => elegirDeLogistica(e.target.value)}>
          <option value="">Ninguna; subiré un PDF</option>
          {documentos.map((d) => (
            <option key={d.id} value={d.id}>
              {[
                d.numero ?? d.nombre_archivo,
                d.fecha ? dia(d.fecha) : null,
                d.oc,
                d.proveedor,
                d.facturaDeLaOc ? `la OC ya tiene la ${d.facturaDeLaOc}` : null,
                d.pagadaDirecto ? 'la OC ya se pagó por su boleta' : null,
                d.mismoNumero ? `¿ya registrada de ${d.mismoNumero}?` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </option>
          ))}
        </Seleccion>
        {/* La clave no reconoce un proveedor escrito con otro nombre: que lo mire una persona. */}
        {/* La OC con boleta ya tiene su factura completa: la base no deja registrar otra. */}
        {elegida?.facturaDeLaOc && (
          <p className="text-xs text-aviso">
            La {elegida.oc} ya tiene registrada la factura {elegida.facturaDeLaOc}, y no se le registra otra. Si es la misma con el número mal escrito,
            corrige la {elegida.facturaDeLaOc}; si este anexo no es de esa OC, Logística lo anula.
          </p>
        )}
        {/* La OC con boleta ya pagada directo: registrada, la factura toma ese pago (migración 20261020210000); en otra moneda, no sola. */}
        {elegida?.pagadaDirecto && (
          <p className="text-xs text-texto-suave">
            {monedaFactura === elegida.monedaOc
              ? `Tesorería ya pagó la ${elegida.oc} por su boleta: al registrarla, la factura toma ese pago y Tesorería solo paga lo que falte. Si es por menos, el sistema le avisa lo pagado de más.`
              : `Tesorería ya pagó la ${elegida.oc} por su boleta en ${nombreMoneda(elegida.monedaOc)} y esta factura va en ${nombreMoneda(monedaFactura)}: no toma ese pago sola; Tesorería lo pasa al cambio antes de pagar lo que falte.`}
          </p>
        )}
        {elegida?.mismoNumero && (
          <p className="text-xs text-aviso">
            En Adquisiciones ya hay una factura {elegida.numero} de «{elegida.mismoNumero}». Si es la misma, no la registres otra vez.
          </p>
        )}
      </Campo>
      <Campo etiqueta="PDF del comprobante" htmlFor="adq-pdf" ayuda="Obligatorio si no eliges una factura de Logística.">
        <ElegirArchivo
          id="adq-pdf"
          name="pdf"
          accept={ACEPTA_PDF}
          hastaMb={10}
          aviso={avisoArchivo.pdf}
          estado={leyendo.pdf}
          onChange={(e) => void elegirArchivo('pdf', e.target.files?.[0], ACEPTA_PDF, 10)}
        />
      </Campo>
      <Campo
        etiqueta="XML de SUNAT (opcional)"
        htmlFor="adq-xml"
        ayuda="Si el proveedor lo mandó, el detector lo lee primero: es el documento legal. Solo se lee, no se guarda."
      >
        <ElegirArchivo
          id="adq-xml"
          accept={ACEPTA_XML_FACTURA}
          hastaMb={20}
          aviso={avisoArchivo.xml}
          estado={leyendo.xml}
          onChange={(e) => void elegirArchivo('xml', e.target.files?.[0], ACEPTA_XML_FACTURA, 20)}
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

const FUENTE: Record<LecturaFactura['fuente'], string> = { XML: 'del XML de SUNAT', PDF: 'del PDF', OCR: 'del escaneo' }

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
        Leído {FUENTE[lectura.fuente]}: {leido.join(' · ')}.
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

/**
 * Cuánto falta facturar de las OC marcadas frente al total de la factura: de
 * una OC que ya va en otra factura, solo lo que queda. No frena nada.
 */
function AvisoDeMonto({
  elegidas,
  enParte,
  total,
  monedaFactura,
}: {
  elegidas: CompraSinFactura[]
  /** Las marcadas que esta factura cubre solo en parte. */
  enParte: CompraSinFactura[]
  total: string
  monedaFactura: string
}) {
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
  const suma = Math.round(elegidas.reduce((n, c) => n + pendiente(c), 0) * 100) / 100
  const yaFacturado = elegidas.some((c) => c.facturado > 0)
  const queda = yaFacturado ? `De las OC marcadas falta facturar ${dinero(suma, m)}` : `Las OC marcadas suman ${dinero(suma, m)}`
  const escrito = Number(total)
  if (!total || !Number.isFinite(escrito) || escrito <= 0) {
    return <p className={`${clase} text-texto-suave`}>{queda}, con IGV si van con factura.</p>
  }
  const diferencia = Math.round((escrito - suma) * 100) / 100
  if (Math.abs(diferencia) <= 1) {
    return (
      <p className={`${clase} ${enParte.length > 0 ? 'text-aviso' : 'text-exito'}`}>
        Calza con lo que falta facturar de las OC marcadas: {dinero(suma, m)}.
        {enParte.length > 0 && ' La completa: no hace falta marcarla como parcial.'}
      </p>
    )
  }
  if (enParte.length > 0 && diferencia < 0) {
    return (
      <p className={`${clase} text-texto-suave`}>
        Factura parcial: {queda.charAt(0).toLowerCase() + queda.slice(1)} y esta cubre {dinero(escrito, m)}. Quedan{' '}
        {dinero(Math.abs(diferencia), m)} para otra factura.
      </p>
    )
  }
  return (
    <p role="status" className={`${clase} text-aviso`}>
      {queda} y la factura dice {dinero(escrito, m)}: {diferencia > 0 ? 'sobran' : 'faltan'} {dinero(Math.abs(diferencia), m)}. Es solo un aviso:
      {diferencia < 0 ? ' si la factura cubre solo una parte de la OC, márcala como parcial; si' : ' si'} cubre otra cosa o falta una OC, puedes
      registrarla igual.
    </p>
  )
}

/** `pideRuc`: la factura de compra que quedó en borrador sin RUC no se registra sin él. */
export function CompletarAdquisicion({ id, pideRuc = false }: { id: string; pideRuc?: boolean }) {
  const { alEnviar, enviando, error, resultado, limpiar } = useEnvio(completarAdquisicion)
  // El detector también lee el PDF pendiente; el aviso sale en la lista al registrarlo.
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [leyendo, setLeyendo] = useState<string | null>(null)
  // Por qué el PDF elegido no sirve: va en su campo, y no se lee.
  const [avisoPdf, setAvisoPdf] = useState<string | null>(null)
  const turno = useRef(0)
  // Con `useId` y no con el id de la factura: la página la dibuja dos veces —en la
  // tabla del monitor y en la tarjeta del teléfono— y la etiqueta apuntaba al campo oculto.
  const campo = `pdf-${useId()}`
  const campoRuc = `ruc-${useId()}`

  async function leerPdf(archivo: File | undefined) {
    const vez = ++turno.current
    // Lo que diga una lectura que otro PDF ya reemplazó no llega al campo.
    const anotar = (texto: string | null) => {
      if (vez === turno.current) setLeyendo(texto)
    }
    setLectura(null)
    setAvisoPdf(null)
    // El rechazo del envío anterior era de otro PDF.
    limpiar()
    anotar(null)
    if (!archivo) return
    // Un Word con el nombre cambiado a «.pdf» queda en rojo y no se lee.
    const motivo = await revisarArchivo(archivo, ACEPTA_PDF, 10)
    if (vez !== turno.current) return
    if (motivo) return setAvisoPdf(motivo)
    anotar('Leyendo la factura…')
    const leida = await leerFactura(archivo, anotar)
    if (vez !== turno.current) return
    anotar(null)
    setLectura(leida)
  }

  return (
    <form onSubmit={alEnviar} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      {Object.entries(camposDeLectura(lectura)).map(([nombre, valor]) => (
        <input key={nombre} type="hidden" name={nombre} value={valor} />
      ))}
      {pideRuc && (
        <Campo etiqueta="RUC del emisor" htmlFor={campoRuc} requerido>
          <Entrada
            id={campoRuc}
            name="ruc_proveedor"
            inputMode="numeric"
            autoComplete="off"
            maxLength={13}
            pattern={'\\D*(\\d\\D*){11}'}
            title="Los 11 dígitos del RUC."
            required
            className="tabular"
          />
        </Campo>
      )}
      <Campo etiqueta="PDF pendiente" htmlFor={campo} requerido>
        <ElegirArchivo
          id={campo}
          name="pdf"
          accept={ACEPTA_PDF}
          hastaMb={10}
          required
          aviso={avisoPdf}
          estado={leyendo}
          onChange={(e) => void leerPdf(e.target.files?.[0])}
        />
      </Campo>
      <Boton type="submit" tamano="sm" cargando={enviando || Boolean(leyendo)}>
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

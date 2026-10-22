'use client'

import { Pencil } from 'lucide-react'
import { useRef, useState } from 'react'

import { CamposDeCorreccion, useCorreccion } from '@/components/correcciones/justificante'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { Ventana } from '@/components/ui/ventana'
import type { CompraSinFactura, OrdenDeFactura } from '@/lib/datos/adquisiciones'
import { avisosDelDetector, lecturaUtil, textoDelAviso, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { useEnvio } from '@/lib/envio'
import { moneda as dinero } from '@/lib/format'
import { leerFactura } from '@/lib/leer-factura'
import { subirArchivoPrivado } from '@/lib/subida-privada'

import { corregirFactura } from './acciones'

export type FacturaParaCorregir = {
  id: string
  tipo: string
  proveedor: string
  ruc_proveedor: string | null
  numero_documento: string
  fecha_emision: string
  fecha_vencimiento: string
  moneda: string
  total: number
  condicion_pago: string
  observacion: string
  /** Lo que Tesorería ya pagó: el total no baja de aquí y, con pagos, la moneda no cambia. */
  pagado: number
}

/**
 * Una OC que se puede marcar en la corrección: las de la factura y las que
 * esperan la suya. `pendiente` es lo que falta facturar de ella sin contar esta.
 */
type OcElegible = {
  id: string
  numero: string
  proveedor: string | null
  total: number | null
  pendiente: number | null
  moneda: string
  condicion: string | null
}

const mismas = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

const mismoNombre = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
const codigo = (m: string) => (m === 'USD' ? 'USD' : 'PEN')

const ACEPTA_PDF = 'application/pdf,.pdf'

/**
 * Corregir un comprobante registrado, con su motivo y su justificante: sus datos,
 * las OC que cubre y, si hace falta, su PDF. El detector lee el PDF nuevo y avisa
 * lo que no calza, sin frenar. La OC que sale queda anotada como quitada.
 */
export function CorregirFactura({
  factura,
  ordenes,
  disponibles,
}: {
  factura: FacturaParaCorregir
  ordenes: OrdenDeFactura[]
  disponibles: CompraSinFactura[]
}) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)} aria-label={`Corregir el comprobante ${factura.numero_documento}`}>
        <Pencil aria-hidden className="size-4" />
        Corregir
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Corregir el comprobante ${factura.numero_documento}`}
        descripcion="Cambia solo lo que estaba mal. Queda en su historial con el motivo, quién, cuándo y el justificante."
        ancho="xl"
      >
        {abierta && <Formulario factura={factura} ordenes={ordenes} disponibles={disponibles} alTerminar={() => setAbierta(false)} />}
      </Ventana>
    </>
  )
}

function Formulario({
  factura: f,
  ordenes,
  disponibles,
  alTerminar,
}: {
  factura: FacturaParaCorregir
  ordenes: OrdenDeFactura[]
  disponibles: CompraSinFactura[]
  alTerminar: () => void
}) {
  const [proveedor, setProveedor] = useState(f.proveedor)
  const [ruc, setRuc] = useState(f.ruc_proveedor ?? '')
  const [numero, setNumero] = useState(f.numero_documento)
  const [emision, setEmision] = useState(f.fecha_emision)
  const [vencimiento, setVencimiento] = useState(f.fecha_vencimiento)
  const [monedaFactura, setMoneda] = useState(f.moneda)
  const [total, setTotal] = useState(String(f.total))
  const [condicion, setCondicion] = useState(f.condicion_pago)
  const [observacion, setObservacion] = useState(f.observacion)
  const [marcadas, setMarcadas] = useState<string[]>(() => ordenes.map((o) => o.id))
  const [parciales, setParciales] = useState<string[]>(() => ordenes.filter((o) => o.parcial).map((o) => o.id))
  const [pdf, setPdf] = useState<File | null>(null)
  const [pdfId] = useState(() => crypto.randomUUID())
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [leyendo, setLeyendo] = useState<string | null>(null)
  // Por qué el PDF elegido no sirve: va en su campo, y no se lee.
  const [avisoPdf, setAvisoPdf] = useState<string | null>(null)
  // Se leyó y no trajo nada: se revisa a mano.
  const [sinLeer, setSinLeer] = useState(false)
  const turno = useRef(0)
  const rutaPdf = `adquisiciones/${f.id}/correccion-${pdfId}.pdf`
  const { corregir, otra } = useCorreccion(f.id, corregirFactura)
  const { alEnviar, enviando, error } = useEnvio(
    async (_previo, datos) => {
      datos.delete('pdf')
      if (!pdf) return corregir(null, datos)
      if (pdf.type !== 'application/pdf' || pdf.size < 5 || pdf.size > 10 * 1024 * 1024 || (await pdf.slice(0, 5).text()) !== '%PDF-') {
        return { ok: false, error: 'El PDF nuevo de la factura tiene que ser un PDF de hasta 10 MB.' }
      }
      // El PDF nuevo sube primero; si la corrección no entra, se retira.
      return subirArchivoPrivado({
        bucket: 'comprobantes-financieros',
        ruta: rutaPdf,
        archivo: pdf,
        contentType: 'application/pdf',
        registrar: () => corregir(null, datos),
      })
    },
    () => {
      otra()
      alTerminar()
    },
  )
  const rucEscrito = ruc.replace(/\D/g, '')
  // Las OC que se pueden marcar: las de la factura y las que esperan su factura, del mismo proveedor.
  const elegibles: OcElegible[] = [
    ...ordenes.map((o) => ({
      id: o.id,
      numero: o.numero ?? o.referencia,
      proveedor: null,
      total: o.sin_precio ? null : o.total,
      pendiente: o.sin_precio ? null : Math.max(o.total - o.facturado_otras, 0),
      moneda: o.moneda,
      condicion: null,
    })),
    ...disponibles
      // Del mismo RUC si los dos lo tienen; si no, del mismo nombre (migración 20261022170000).
      .filter((c) => !ordenes.some((o) => o.id === c.orden_compra_id) && (rucEscrito.length === 11 && c.ruc ? c.ruc === rucEscrito : mismoNombre(c.proveedor, proveedor)))
      .map((c) => ({
        id: c.orden_compra_id,
        numero: c.numero ?? c.referencia,
        proveedor: c.proveedor,
        total: c.sin_precio ? null : c.total,
        pendiente: c.sin_precio ? null : Math.max(c.total - c.facturado, 0),
        moneda: c.moneda,
        condicion: c.condicion_pago,
      })),
  ]
  const conOc = f.tipo === 'FACTURA_COMPRA' || ordenes.length > 0

  // Solo viaja lo que cambió: la base anota antes y después.
  const cambios: Record<string, unknown> = {}
  if (proveedor.trim() !== f.proveedor) cambios.proveedor = proveedor.trim()
  if (rucEscrito !== (f.ruc_proveedor ?? '')) cambios.ruc_proveedor = rucEscrito
  if (numero.trim() !== f.numero_documento) cambios.numero_documento = numero.trim()
  if (emision !== f.fecha_emision) cambios.fecha_emision = emision
  if (condicion === 'CREDITO' && vencimiento !== f.fecha_vencimiento) cambios.fecha_vencimiento = vencimiento
  if (monedaFactura !== f.moneda) cambios.moneda = monedaFactura
  if (Number(total) !== f.total && Number(total) > 0) cambios.total = Math.round(Number(total) * 100) / 100
  if (condicion !== f.condicion_pago) cambios.condicion_pago = condicion
  if (observacion.trim() !== f.observacion.trim()) cambios.observacion = observacion.trim()
  const actuales = ordenes.map((o) => o.id)
  if (!mismas(marcadas, actuales)) cambios.ordenes = marcadas
  const enParte = parciales.filter((p) => marcadas.includes(p))
  if (!mismas(enParte, ordenes.filter((o) => o.parcial).map((o) => o.id))) cambios.parciales = enParte
  if (pdf) {
    cambios.pdf_ruta = rutaPdf
    if (lecturaUtil(lectura)) cambios.lectura = lectura
  }
  const sinCambios = Object.keys(cambios).length === 0

  const elegidas = elegibles.filter((o) => marcadas.includes(o.id))
  const avisos = lecturaUtil(lectura)
    ? avisosDelDetector({
        lectura,
        total: Number(total) > 0 ? Number(total) : null,
        moneda: monedaFactura,
        numero,
        marcadas: elegidas.map((o) => ({ numero: o.numero, referencia: o.numero })),
        disponibles: elegibles.map((o) => ({ numero: o.numero, referencia: o.numero })),
      }).map((a) => textoDelAviso(a, (n, m) => dinero(n, m)))
    : []
  const suma = elegidas.every((o) => o.pendiente !== null && o.moneda === monedaFactura)
    ? Math.round(elegidas.reduce((n, o) => n + (o.pendiente ?? 0), 0) * 100) / 100
    : null
  const enOtras = elegidas.some((o) => o.pendiente !== null && o.total !== null && o.pendiente < o.total)

  async function leerPdf(archivo: File | undefined) {
    const vez = ++turno.current
    // Lo que diga una lectura que otro PDF ya reemplazó no llega al campo.
    const anotar = (texto: string | null) => {
      if (vez === turno.current) setLeyendo(texto)
    }
    setPdf(archivo ?? null)
    setLectura(null)
    setAvisoPdf(null)
    setSinLeer(false)
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
    setSinLeer(!lecturaUtil(leida))
  }

  const id = f.id
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="cambios" value={JSON.stringify(cambios)} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Campo etiqueta="Proveedor" htmlFor={`fc-proveedor-${id}`} requerido>
          <Entrada id={`fc-proveedor-${id}`} value={proveedor} onChange={(e) => setProveedor(e.target.value)} required minLength={2} maxLength={160} />
        </Campo>
        <Campo
          etiqueta="RUC del emisor"
          htmlFor={`fc-ruc-${id}`}
          requerido={f.tipo === 'FACTURA_COMPRA' && Boolean(f.ruc_proveedor)}
          ayuda={f.ruc_proveedor ? undefined : 'Se registró sin RUC: anótalo si lo corriges.'}
        >
          <Entrada
            id={`fc-ruc-${id}`}
            value={ruc}
            onChange={(e) => setRuc(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            maxLength={13}
            pattern={'\\D*(\\d\\D*){11}'}
            title="Los 11 dígitos del RUC."
            required={f.tipo === 'FACTURA_COMPRA' && Boolean(f.ruc_proveedor)}
            className="tabular"
          />
        </Campo>
        <Campo etiqueta="Número" htmlFor={`fc-numero-${id}`} requerido>
          <Entrada id={`fc-numero-${id}`} value={numero} onChange={(e) => setNumero(e.target.value)} required minLength={3} maxLength={80} />
        </Campo>
        <Campo etiqueta="Emitida el" htmlFor={`fc-emision-${id}`} requerido>
          <Entrada id={`fc-emision-${id}`} type="date" value={emision} onChange={(e) => setEmision(e.target.value)} required />
        </Campo>
        <Campo etiqueta="Condición" htmlFor={`fc-condicion-${id}`}>
          <Seleccion id={`fc-condicion-${id}`} value={condicion} onChange={(e) => setCondicion(e.target.value)}>
            <option value="CONTADO">Contado</option>
            <option value="CREDITO">Crédito</option>
          </Seleccion>
        </Campo>
        <Campo etiqueta="Vence el" htmlFor={`fc-vence-${id}`} ayuda={condicion === 'CONTADO' ? 'Al contado vence el mismo día que se emite.' : undefined}>
          <Entrada
            id={`fc-vence-${id}`}
            type="date"
            value={condicion === 'CONTADO' ? emision : vencimiento}
            min={emision}
            onChange={(e) => setVencimiento(e.target.value)}
            disabled={condicion === 'CONTADO'}
          />
        </Campo>
        <Campo etiqueta="Moneda" htmlFor={`fc-moneda-${id}`} ayuda={f.pagado > 0 ? 'Ya tiene pagos: la moneda no cambia.' : undefined}>
          <Seleccion id={`fc-moneda-${id}`} value={monedaFactura} onChange={(e) => setMoneda(e.target.value)} disabled={f.pagado > 0}>
            <option value="PEN">Soles</option>
            <option value="USD">Dólares</option>
          </Seleccion>
        </Campo>
        <Campo
          etiqueta="Total con IGV"
          htmlFor={`fc-total-${id}`}
          requerido
          ayuda={f.pagado > 0 ? `Tesorería ya pagó ${dinero(f.pagado, codigo(f.moneda))}: no puede quedar por debajo.` : undefined}
        >
          <Entrada
            id={`fc-total-${id}`}
            type="number"
            inputMode="decimal"
            min={f.pagado > 0 ? f.pagado : 0.01}
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            required
          />
        </Campo>
        <Campo etiqueta="PDF corregido (opcional)" htmlFor={`fc-pdf-${id}`} ayuda="Solo si el PDF adjunto estaba mal. El que reemplaza queda como evidencia.">
          <ElegirArchivo
            id={`fc-pdf-${id}`}
            name="pdf"
            accept={ACEPTA_PDF}
            hastaMb={10}
            aviso={avisoPdf}
            estado={leyendo}
            onChange={(e) => void leerPdf(e.target.files?.[0])}
          />
        </Campo>
      </div>
      <Campo etiqueta="Observación" htmlFor={`fc-obs-${id}`}>
        <AreaTexto id={`fc-obs-${id}`} value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={1000} />
      </Campo>

      {(sinLeer || avisos.length > 0) && (
        <div className="space-y-1 text-sm" role="status">
          {sinLeer && <p className="text-texto-suave">No se pudo leer el PDF nuevo: revisa a mano el total y las OC.</p>}
          {avisos.length > 0 && (
            <ul className="space-y-0.5 text-aviso">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li className="text-xs text-texto-suave">Es solo un aviso: puedes corregir igual.</li>
            </ul>
          )}
        </div>
      )}

      {conOc && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-texto">OC que cubre</legend>
          <p className="text-xs text-texto-suave">
            Desmarca la que no es de esta factura: queda anotada como quitada y vuelve a esperar la suya. Se ofrecen las del mismo proveedor que esperan
            factura. Si la factura cubre solo una parte de una OC, márcala como parcial.
          </p>
          {elegibles.length === 0 ? (
            <p className="text-sm text-texto-suave">No hay OC del proveedor {proveedor} esperando factura.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {elegibles.map((o) => (
                <li key={o.id} className="rounded-[var(--radius-base)] border border-borde px-3 py-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-0">
                    <input
                      type="checkbox"
                      checked={marcadas.includes(o.id)}
                      onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, o.id] : m.filter((x) => x !== o.id)))}
                    />
                    <span className="tabular text-texto">{o.numero}</span>
                    <span className="ml-auto text-right tabular text-texto-suave">
                      {o.total === null ? 'sin precio' : dinero(o.total, codigo(o.moneda))}
                      {o.pendiente !== null && o.total !== null && o.pendiente < o.total && (
                        <span className="block text-xs">falta {dinero(o.pendiente, codigo(o.moneda))}</span>
                      )}
                    </span>
                  </label>
                  {marcadas.includes(o.id) && (
                    <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 text-xs text-texto sm:min-h-0">
                      <input
                        type="checkbox"
                        checked={parciales.includes(o.id)}
                        onChange={(e) => setParciales((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))}
                      />
                      Cubre solo una parte de esta OC
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
          {suma !== null && elegidas.length > 0 && Number(total) > 0 && (
            <p className={`text-xs ${Math.abs(Number(total) - suma) <= 1 ? 'text-exito' : 'text-aviso'}`}>
              {enOtras ? 'De las OC marcadas falta facturar' : 'Las OC marcadas suman'} {dinero(suma, codigo(monedaFactura))} y la factura dice{' '}
              {dinero(Number(total), codigo(monedaFactura))}.
            </p>
          )}
        </fieldset>
      )}

      <CamposDeCorreccion id={id} disabled={enviando} />
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {sinCambios && <p className="mr-auto text-xs text-texto-suave">Todavía no cambiaste nada.</p>}
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando || Boolean(leyendo)} disabled={sinCambios}>
          Corregir
        </Boton>
      </div>
    </form>
  )
}

'use client'

import { useId, useRef, useState, type FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import type { CompraSinFactura, FacturaDeLogistica } from '@/lib/datos/adquisiciones'
import { avisosDelDetector, numeroDeFactura, numeroDeOc, textoDelAviso, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { fecha as dia, moneda as dinero } from '@/lib/format'
import { ACEPTA_XML_FACTURA, camposDeLectura, leerFactura, leerFacturaDeEnlace } from '@/lib/leer-factura'

import { completarAdquisicion, enlaceDeFacturaDeLogistica, registrarAdquisicion } from './acciones'

type Fuente = 'xml' | 'pdf' | 'logistica'

type Dato = 'total' | 'numero' | 'emision'
const DATOS: Dato[] = ['total', 'numero', 'emision']
/** Cada dato y la fuente que lo llenó; `null` si lo escribió la persona o está vacío. */
type Llenado = Record<Dato, { valor: string; fuente: Fuente | null }>
const VACIO = { valor: '', fuente: null }
const SIN_LLENAR: Llenado = { total: VACIO, numero: VACIO, emision: VACIO }

/** Lo que está vacío se llena con lo que trae la fuente, y queda anotado que vino de ella. */
function llenarCon(d: Llenado, fuente: Fuente, valores: Partial<Record<Dato, string | null | undefined>>): Llenado {
  let n = d
  for (const k of DATOS) {
    const v = valores[k]
    if (v && !n[k].valor) n = { ...n, [k]: { valor: v, fuente } }
  }
  return n
}
const valoresDe = (l: LecturaFactura) => ({ total: l.total !== null ? l.total.toFixed(2) : null, numero: l.numero, emision: l.fecha_emision })

const ACEPTA_PDF = 'application/pdf,.pdf'

/** Lo que la primera marca de OC llena de su OC. */
type Valores = { proveedor: string; condicion: string; moneda: string; ot: string }

/**
 * Un estado que también se lee al día: lo que se decide al terminar una lectura,
 * o justo después de soltar un archivo, mira lo que hay ahora y no lo que había
 * cuando se pintó la pantalla.
 */
function useEstadoAlDia<T>(inicial: T) {
  const [valor, setValor] = useState(inicial)
  const ahora = useRef(inicial)
  const poner = (nuevo: T | ((antes: T) => T)) => {
    ahora.current = typeof nuevo === 'function' ? (nuevo as (antes: T) => T)(ahora.current) : nuevo
    setValor(ahora.current)
  }
  return [valor, poner, ahora] as const
}

type Props = {
  ordenes: { id: string; numero: string }[]
  compras: CompraSinFactura[]
  /** Las facturas que Logística anexó a sus OC y todavía nadie registra. */
  documentos: FacturaDeLogistica[]
}

const mismoNombre = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
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
 * Si se quita o se cambia el archivo, lo que llenó y nadie tocó se va con él.
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
  const [marcadas, setMarcadas, marcadasAhora] = useEstadoAlDia<string[]>([])
  const [parciales, setParciales] = useState<string[]>([])
  const [proveedor, setProveedor, proveedorAhora] = useEstadoAlDia('')
  const [condicion, setCondicion, condicionAhora] = useEstadoAlDia('CONTADO')
  const [monedaFactura, setMonedaFactura, monedaAhora] = useEstadoAlDia('PEN')
  const [ot, setOt, otAhora] = useEstadoAlDia('')
  // Las OC que marcó cada fuente sola (al leerla, o al elegir la factura de
  // Logística): se van con su archivo si nadie las cambió, como el total
  // (`soltar`). Una OC puede ser de dos fuentes; se va cuando no queda ninguna.
  const marcadasPor = useRef<Partial<Record<Fuente, string[]>>>({})
  // Lo que las fuentes pusieron en el proveedor, la condición, la moneda y la OT
  // (`puestos`) y lo que había antes de la primera (`base`): cuando ya no queda
  // ninguna, vuelve lo de antes en lo que nadie cambió.
  const puesto = useRef<{ base: Valores; puestos: Valores } | null>(null)
  // Los de esos cuatro que la persona cambió a mano: una fuente que vuelve a
  // marcar lo suyo después de que se fue otra no se los pisa.
  const tocados = useRef(new Set<keyof Valores>())
  const tocar = (k: keyof Valores) => tocados.current.add(k)
  // La factura de Logística elegida: su número, su fecha y su OC cuentan como
  // lo leído de esa fuente, aunque su PDF no se pueda leer.
  const documento = useRef<FacturaDeLogistica | null>(null)
  const [numeroDeLogistica, setNumeroDeLogistica] = useState<string | null>(null)
  // El total, el número y la emisión, con la fuente que los llenó: lo que llenó un
  // archivo se va con él si nadie lo cambió (`soltar`).
  const [llenado, setLlenado] = useState<Llenado>(SIN_LLENAR)
  const { total, numero, emision } = { total: llenado.total.valor, numero: llenado.numero.valor, emision: llenado.emision.valor }
  // Lo que escribe la persona ya no es de ninguna fuente: quitar un archivo no lo toca.
  const escribir = (dato: Dato, valor: string) => setLlenado((d) => ({ ...d, [dato]: { valor, fuente: null } }))
  // Lo que leyó el detector de cada fuente; manda el XML, después el PDF, después el de Logística.
  const [lecturas, setLecturas] = useState<Record<Fuente, LecturaFactura | null | undefined>>({ xml: undefined, pdf: undefined, logistica: undefined })
  // Lo que está leyendo cada fuente: el PDF y el XML lo dicen en su campo; la de Logística, abajo.
  const [leyendo, setLeyendo] = useState<Record<Fuente, string | null>>({ xml: null, pdf: null, logistica: null })
  // Por qué el PDF o el XML elegido no sirve: va en su campo, y no se lee.
  const [avisoArchivo, setAvisoArchivo] = useState<Record<'xml' | 'pdf', string | null>>({ xml: null, pdf: null })
  const turno = useRef<Record<Fuente, number>>({ xml: 0, pdf: 0, logistica: 0 })
  const { alEnviar, enviando, error, limpiar } = useEnvio(registrarAdquisicion, (r) => alRegistrar(r.mensaje ?? 'Comprobante registrado.'))
  const campoPdf = useRef<HTMLInputElement>(null)
  const avisoError = useRef<HTMLParagraphElement>(null)
  // Lo que es del PDF se dice en su campo, que se marca, y no se repite abajo.
  // Lo que dejó un borrador no se arregla eligiendo otro PDF: se completa en su
  // fila de la lista, así que su aviso va abajo.
  const [faltaPdf, setFaltaPdf] = useState(false)
  const errorPdf = error && /\bPDF\b/.test(error) && !/\bborrador\b/.test(error) ? error : null
  useCursorAlRechazo(enviando, error, () => (errorPdf ? campoPdf.current : avisoError.current))
  // Al elegir o quitar el PDF, o la factura de Logística, el aviso del PDF ya no vale.
  const yaNoFaltaPdf = () => {
    setFaltaPdf(false)
    if (errorPdf) limpiar()
  }

  function registrar(e: FormEvent<HTMLFormElement>) {
    const elegido = campoPdf.current?.files?.[0]
    const conLogistica = Boolean(new FormData(e.currentTarget).get('documento_compra_id'))
    // El PDF elegido y vacío ya lo dice su campo; sin PDF ni factura de
    // Logística, lo dice también. No se envía, y el cursor va ahí.
    if (elegido?.size === 0 || (!elegido && !conLogistica)) {
      e.preventDefault()
      if (!elegido) setFaltaPdf(true)
      campoPdf.current?.focus()
      return
    }
    alEnviar(e, (datos) => {
      // El campo que nadie tocó no se manda: en el servidor llegaría como un
      // archivo vacío con un nombre inventado («undefined») y no se distinguiría
      // de uno elegido vacío.
      const pdf = datos.get('pdf')
      if (pdf instanceof File && pdf.name === '') datos.delete('pdf')
    })
  }

  const elegidas = compras.filter((c) => marcadas.includes(c.orden_compra_id))
  const enParte = elegidas.filter((c) => parciales.includes(c.orden_compra_id))
  // Una OC entra con las marcadas si es del mismo proveedor y condición que ellas.
  const encajaCon = (ids: string[], c: CompraSinFactura) => {
    const base = compras.find((x) => ids.includes(x.orden_compra_id))
    return !base || (mismoNombre(c.proveedor, base.proveedor) && c.condicion_pago === base.condicion_pago)
  }
  const encaja = (c: CompraSinFactura) => encajaCon(marcadas, c)
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
    const leida = await leer(anotar).catch(() => null)
    if (vez !== turno.current[fuente]) return
    anotar(null)
    setLecturas((l) => ({ ...l, [fuente]: leida }))
    if (!leida) return
    setLlenado((d) => llenarCon(d, fuente, valoresDe(leida)))
    // Las OC se marcan solas si al terminar de leer no hay ninguna marcada.
    if (marcadasAhora.current.length === 0) marcarDeLectura(fuente, leida)
  }

  /** Las OC que nombra la factura y esperan la suya, del mismo proveedor y condición que la primera. */
  function marcarDeLectura(fuente: Fuente, leida: LecturaFactura, deNuevo = false) {
    const nombradas = compras.filter((c) => leida.ordenes.includes(numeroDeOc(c.numero) ?? ''))
    const primera = nombradas.at(0)
    const juntas = primera ? nombradas.filter((c) => mismoNombre(c.proveedor, primera.proveedor) && c.condicion_pago === primera.condicion_pago) : []
    if (juntas.length > 0 || leida.moneda) marcarSolas(fuente, juntas, leida.moneda, deNuevo)
  }

  /** La OC de la factura de Logística elegida, si espera su factura. */
  const compraDelDocumento = () => compras.find((x) => x.orden_compra_id === documento.current?.orden_compra_id)

  const valoresAhora = (): Valores => ({
    proveedor: proveedorAhora.current,
    condicion: condicionAhora.current,
    moneda: monedaAhora.current,
    ot: otAhora.current,
  })
  const ponerValores = (v: Valores) => {
    setProveedor(v.proveedor)
    setCondicion(v.condicion)
    setMonedaFactura(v.moneda)
    setOt(v.ot)
  }
  const CAMPOS = ['proveedor', 'condicion', 'moneda', 'ot'] as const
  const cada = (f: (k: (typeof CAMPOS)[number]) => string) => Object.fromEntries(CAMPOS.map((k) => [k, f(k)])) as Valores

  /**
   * Una fuente marca sola las primeras OC: llena con la primera el proveedor (si
   * está vacío), la condición, la moneda y la OT (si está vacía). Sin OC, pone
   * la moneda que leyó. Queda anotado qué marcó y qué había, para soltarlo.
   * `deNuevo`: la fuente seguía puesta y vuelve a marcar porque se fue otra; lo
   * que la persona cambió a mano se queda.
   */
  function marcarSolas(fuente: Fuente, cs: CompraSinFactura[], monedaLeida?: string | null, deNuevo = false) {
    const primera = cs.at(0)
    const ahora = valoresAhora()
    const antes = puesto.current
    // Lo de antes de la primera fuente se guarda; lo que la persona cambió
    // después de una fuente pasa a ser lo suyo.
    const base = antes ? cada((k) => (ahora[k] === antes.puestos[k] ? antes.base[k] : ahora[k])) : ahora
    const leidos: Valores = primera
      ? { proveedor: ahora.proveedor.trim() || primera.proveedor, condicion: primera.condicion_pago, moneda: primera.moneda, ot: ahora.ot || (primera.orden_id ?? '') }
      : { ...ahora, moneda: monedaLeida || ahora.moneda }
    const puestos = deNuevo ? cada((k) => (tocados.current.has(k) ? ahora[k] : leidos[k])) : leidos
    // Lo que la persona cambió y esta fuente pisó al marcar por primera vez ya
    // no es suyo: cuenta lo que cambie después.
    if (!deNuevo) for (const k of CAMPOS) if (puestos[k] !== ahora[k]) tocados.current.delete(k)
    const ids = cs.map((c) => c.orden_compra_id)
    setMarcadas(ids)
    ponerValores(puestos)
    marcadasPor.current[fuente] = ids
    puesto.current = { base, puestos }
  }

  /** Una fuente que sigue puesta vuelve a marcar lo suyo: la de Logística, su OC; las demás, lo que leyeron. */
  function marcarDeFuente(f: Fuente) {
    const c = f === 'logistica' ? compraDelDocumento() : undefined
    if (c) return marcarSolas('logistica', [c], null, true)
    const l = lecturas[f]
    if (l) marcarDeLectura(f, l, true)
  }

  /**
   * Lo que llenó una fuente se va con su archivo (quitado o cambiado por otro), si
   * nadie lo cambió: se vacía y se vuelve a llenar con lo que traen las demás.
   * Las OC que marcó sola se desmarcan, salvo las que también son de otra
   * fuente; si no queda ninguna, el proveedor, la condición, la moneda y la OT
   * vuelven a lo que había antes de la primera fuente, y otra fuente que siga
   * puesta marca las suyas.
   */
  function soltar(fuente: Fuente) {
    const otras = (['xml', 'pdf', 'logistica'] as const).filter((f) => f !== fuente)
    const valoresDeFuente = (f: Fuente): Partial<Record<Dato, string | null>> => {
      const l = lecturas[f]
      const leidos: Partial<Record<Dato, string | null>> = l ? valoresDe(l) : {}
      const d = f === 'logistica' ? documento.current : null
      return d ? { ...leidos, numero: d.numero || leidos.numero, emision: d.fecha || leidos.emision } : leidos
    }
    setLlenado((d) => {
      const sueltos = DATOS.filter((k) => d[k].fuente === fuente)
      if (sueltos.length === 0) return d
      let n = d
      for (const k of sueltos) n = { ...n, [k]: VACIO }
      for (const f of otras) {
        const valores = valoresDeFuente(f)
        n = llenarCon(n, f, Object.fromEntries(sueltos.map((k) => [k, valores[k]])))
      }
      return n
    })
    const suyas = marcadasPor.current[fuente]
    delete marcadasPor.current[fuente]
    if (!suyas) return
    const deOtras = otras.flatMap((f) => marcadasPor.current[f] ?? [])
    const sueltas = suyas.filter((id) => !deOtras.includes(id))
    const quedan = marcadasAhora.current.filter((id) => !sueltas.includes(id))
    setMarcadas(quedan)
    setParciales((p) => p.filter((id) => !sueltas.includes(id)))
    const p = puesto.current
    if (quedan.length > 0) {
      // La moneda y la OT de la OC que se fue pasan a ser las de la primera que
      // queda, en lo que nadie cambió; el proveedor y la condición son los mismos.
      const sigue = compras.find((c) => quedan.includes(c.orden_compra_id))
      if (p && sigue && sueltas.length > 0) {
        const ahora = valoresAhora()
        const sigueSiNadieLoCambio = (k: 'moneda' | 'ot', valor: string) =>
          ahora[k] === p.puestos[k] && !tocados.current.has(k) ? valor : ahora[k]
        const puestos = { ...ahora, moneda: sigueSiNadieLoCambio('moneda', sigue.moneda), ot: sigueSiNadieLoCambio('ot', sigue.orden_id ?? p.base.ot) }
        ponerValores(puestos)
        puesto.current = { base: p.base, puestos }
      }
      return
    }
    if (p) {
      // En lo que nadie cambió vuelve lo de antes; lo que cambió la persona se queda.
      const vuelto = cada((k) => (valoresAhora()[k] === p.puestos[k] ? p.base[k] : valoresAhora()[k]))
      ponerValores(vuelto)
      puesto.current = { base: vuelto, puestos: vuelto }
    }
    for (const f of otras) {
      marcarDeFuente(f)
      if (marcadasAhora.current.length > 0) break
    }
  }

  /**
   * El PDF o el XML que se eligió: antes de leerlo se mira que sea lo que dice. Un
   * Word con el nombre cambiado a «.pdf» queda en rojo en su campo y no se lee.
   */
  async function elegirArchivo(fuente: 'xml' | 'pdf', archivo: File | undefined, accept: string, hastaMb: number) {
    soltar(fuente)
    void detectar(fuente, null)
    setAvisoArchivo((a) => ({ ...a, [fuente]: null }))
    if (fuente === 'pdf') yaNoFaltaPdf()
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
        marcadas: elegidas,
        disponibles: compras,
      })
    : []
  // El detector compara con la primera fuente; si el archivo y la factura de
  // Logística son de facturas distintas, también se dice, una sola vez: si el
  // número del formulario ya es el de Logística, el detector lo está diciendo.
  const deLogistica = numeroDeFactura(numeroDeLogistica)
  const delArchivo = (lecturas.xml ?? lecturas.pdf)?.numero ?? null
  const yaLoDice = avisos.some((a) => a.tipo === 'NUMERO' && numeroDeFactura(a.registrado) === deLogistica)
  const otraFactura =
    deLogistica && delArchivo && deLogistica !== delArchivo && !yaLoDice
      ? [{ texto: `El ${lecturas.xml ? 'XML' : 'PDF'} es la factura ${delArchivo} y la de Logística es la ${deLogistica}: revisa que sean la misma.` }]
      : []

  function marcar(c: CompraSinFactura, si: boolean) {
    alEscribir()
    // La OC que marca o desmarca la persona ya no es de ninguna fuente: quitar un archivo no la toca.
    for (const [f, ids] of Object.entries(marcadasPor.current)) marcadasPor.current[f as Fuente] = ids.filter((id) => id !== c.orden_compra_id)
    if (!si) {
      setParciales((p) => p.filter((id) => id !== c.orden_compra_id))
      return setMarcadas((m) => m.filter((id) => id !== c.orden_compra_id))
    }
    if (marcadasAhora.current.length === 0) {
      // La primera la marcó la persona: lo que llena ya no se va con ningún archivo.
      puesto.current = null
      marcadasPor.current = {}
      if (!proveedorAhora.current.trim()) setProveedor(c.proveedor)
      setCondicion(c.condicion_pago)
      setMonedaFactura(c.moneda)
      if (!otAhora.current && c.orden_id) setOt(c.orden_id)
    }
    setMarcadas((m) => (m.includes(c.orden_compra_id) ? m : [...m, c.orden_compra_id]))
  }

  /** La factura de Logística trae su número, su fecha y su OC: se llenan si están vacíos. */
  function elegirDeLogistica(id: string) {
    const d = documentos.find((x) => x.id === id) ?? null
    if (d) yaNoFaltaPdf()
    soltar('logistica')
    documento.current = d
    setNumeroDeLogistica(d?.numero ?? null)
    if (d) setLlenado((l) => llenarCon(l, 'logistica', { numero: d.numero, emision: d.fecha }))
    const c = compraDelDocumento()
    // Su OC se marca sola (o queda anotada como suya si otra fuente ya la
    // marcó), y se desmarca si se cambia o se quita esta factura.
    if (c && encajaCon(marcadasAhora.current, c)) {
      alEscribir()
      if (marcadasAhora.current.length === 0) marcarSolas('logistica', [c])
      else {
        setMarcadas((m) => (m.includes(c.orden_compra_id) ? m : [...m, c.orden_compra_id]))
        marcadasPor.current.logistica = [c.orden_compra_id]
      }
    }
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
    <form onSubmit={registrar} onChange={alEscribir} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <Entrada
          id="adq-proveedor"
          name="proveedor"
          minLength={2}
          maxLength={160}
          required
          value={proveedor}
          onChange={(e) => {
            tocar('proveedor')
            setProveedor(e.target.value)
          }}
        />
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
          onChange={(e) => escribir('numero', e.target.value)}
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
                    <span className="text-right tabular text-sm text-texto">
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
        <Seleccion
          id="adq-ot"
          name="orden_id"
          value={ot}
          onChange={(e) => {
            tocar('ot')
            setOt(e.target.value)
          }}
        >
          <option value="">Sin OT específica</option>
          {ordenes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.numero}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Moneda" htmlFor="adq-moneda">
        <Seleccion
          id="adq-moneda"
          name="moneda"
          value={monedaFactura}
          onChange={(e) => {
            tocar('moneda')
            setMonedaFactura(e.target.value)
          }}
        >
          <option value="PEN">Soles</option>
          <option value="USD">Dólares</option>
        </Seleccion>
      </Campo>
      <Campo etiqueta="Fecha de emisión" htmlFor="adq-emision" requerido>
        <Entrada id="adq-emision" name="fecha_emision" type="date" required value={emision} onChange={(e) => escribir('emision', e.target.value)} />
      </Campo>
      <Campo etiqueta="Condición de pago" htmlFor="adq-condicion">
        <Seleccion
          id="adq-condicion"
          name="condicion_pago"
          value={condicion}
          onChange={(e) => {
            tocar('condicion')
            setCondicion(e.target.value)
          }}
        >
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
          onChange={(e) => escribir('total', e.target.value)}
        />
      </Campo>
      <AvisoDeMonto elegidas={elegidas} enParte={enParte} total={total} monedaFactura={monedaFactura} />
      <DetectorDeFactura
        lectura={lectura}
        leyendo={leyendo.logistica}
        sinLeer={sinLeer}
        avisos={[
          ...avisos.map((a) => ({
            texto: textoDelAviso(a, (monto, m) => dinero(monto, m)),
            marcar: a.tipo === 'OC_NO_MARCADA' && a.espera ? compras.find((c) => (c.numero ?? c.referencia) === a.oc && encaja(c)) : undefined,
          })),
          ...otraFactura,
        ]}
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
              {[d.numero ?? d.nombre_archivo, d.fecha ? dia(d.fecha) : null, d.oc, d.proveedor].filter(Boolean).join(' · ')}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="PDF del comprobante" htmlFor="adq-pdf" ayuda="Obligatorio si no eliges una factura de Logística.">
        <ElegirArchivo
          ref={campoPdf}
          id="adq-pdf"
          name="pdf"
          accept={ACEPTA_PDF}
          hastaMb={10}
          disabled={enviando}
          aviso={avisoArchivo.pdf ?? (faltaPdf ? 'Falta el PDF: adjúntalo o elige la factura que anexó Logística' : errorPdf)}
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
          disabled={enviando}
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
        {error && !errorPdf && (
          <p ref={avisoError} role="alert" tabIndex={-1} className="text-sm text-peligro">
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

export function CompletarAdquisicion({ id }: { id: string }) {
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

'use client'

import { Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { registrarDocumentoCompra } from '@/app/(app)/materiales/atencion/acciones-documentos'
import { CodigoInternoConLista } from '@/components/codigo-interno/elegir-codigo'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { CODIGOS_FIJOS, type CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { igvCompra } from '@/lib/dominio/compra-materiales'
import { comprobantePedido } from '@/lib/dominio/proveedores'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { cantidad as formatoCantidad, moneda as formatoMoneda } from '@/lib/format'
import { NO_QUEDO_SIN_RESPUESTA, NO_SE_CONFIRMO, esOtroArchivoEnLaRuta, subirArchivoPrivado } from '@/lib/subida-privada'

import { SelectorProveedor } from '../selector-proveedor'
import { emitirCompraDeInsumos, emitirCompraDirecta } from './acciones'
import { AvisoFacturaDeLaOrden, CamposDeLaFactura, faltaEnLaFactura, useDatosDeFactura, useDetectorDeFactura } from './detector-oc'

/** Una línea de la orden: un material, y los insumos de RQ que compra (vacío en la directa). */
type Linea = { clave: string; material_id: string; cantidad: string; precio: string; insumos: InsumoParaCompra[] }

/** Lo que se dice al emitir; `aRevisar` si la orden salió pero su comprobante no quedó, o no se sabe. */
export type Emitida = { texto: string; aRevisar: boolean }

/** Un insumo de un RQ que espera su compra: lo que falta de él, y de qué RQ y código interno es. */
export type InsumoParaCompra = {
  /** El insumo (`requerimiento_lineas.id`). */
  id: string
  requerimiento_id: string
  requerimiento: string
  area: string
  codigo_interno: string
  descripcion: string
  /** Lo que falta: lo pedido menos lo que Almacén tenía. */
  falta: number
  unidad: string
  /** El material del catálogo de Almacén con que se pidió: la línea de la orden lo trae puesto. */
  material_id: string | null
}

function lineaVacia(): Linea {
  return { clave: crypto.randomUUID(), material_id: '', cantidad: '', precio: '', insumos: [] }
}

const redondeo = (n: number) => Math.round(n * 1000) / 1000

/**
 * Las líneas de la orden que junta insumos: una por material, con lo que falta
 * de él en cada RQ sumado. El insumo sin material del catálogo va en su propia
 * línea, para que se elija qué se compra.
 */
function lineasDeInsumos(insumos: InsumoParaCompra[], delCatalogo: Set<string>): Linea[] {
  const porMaterial = new Map<string, Linea>()
  for (const i of insumos) {
    const material = i.material_id && delCatalogo.has(i.material_id) ? i.material_id : ''
    const clave = material || `sin-material-${i.id}`
    const linea = porMaterial.get(clave) ?? { ...lineaVacia(), material_id: material }
    linea.insumos = [...linea.insumos, i]
    linea.cantidad = String(redondeo(linea.insumos.reduce((suma, x) => suma + x.falta, 0)))
    porMaterial.set(clave, linea)
  }
  return [...porMaterial.values()]
}

const ACEPTA_PDF = 'application/pdf,.pdf'

/**
 * «No se pudo cargar el archivo. No tienes permiso…» → «no se pudo cargar el
 * archivo. No tienes permiso…», para ir detrás de «no se adjuntó:» sin perder el
 * motivo, que es lo que dice qué hacer.
 */
function dentroDeOtraOracion(texto: string) {
  const t = /[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t
}

async function esPdf(archivo: File) {
  return archivo.size > 0 && archivo.size <= 20 * 1024 * 1024 && (await archivo.slice(0, 5).text()) === '%PDF-'
}

/**
 * La orden de compra directa: proveedor del padrón, materiales del catálogo de
 * Almacén, cantidad y precio sin IGV, y por qué se compra. Dice si viene con
 * factura o sin ella —sin factura igual se pide un comprobante— y para qué
 * unidad es (código interno, o PLANTA). El comprobante se puede adjuntar aquí
 * mismo o después, desde la lista.
 */
export function NuevaCompraDirecta({
  proveedores,
  materiales,
  codigos,
  puedeRegistrarProveedor,
}: {
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  /** Para el buscador de código interno; `null` si la lista no se pudo leer. */
  codigos: CodigoParaElegir[] | null
  puedeRegistrarProveedor: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  // Cada apertura es una orden nueva; el formulario se monta de cero.
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<Emitida | null>(null)
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <Plus aria-hidden className="size-4" />
        Nueva OC directa
      </Boton>
      {aviso && (
        <p role="status" className={`basis-full text-sm ${aviso.aRevisar ? 'text-aviso' : 'text-exito'}`}>
          {aviso.texto}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nueva orden de compra directa"
        descripcion="Sin requerimiento: para el almacén. El número OC-…-MW lo pone el sistema y Gerencia la aprueba antes de que el conductor la recoja."
        ancho="xl"
      >
        <FormularioCompraDirecta
          key={vez}
          proveedores={proveedores}
          materiales={materiales}
          codigos={codigos}
          puedeRegistrarProveedor={puedeRegistrarProveedor}
          alTerminar={(emitida) => {
            setAbierta(false)
            setAviso(emitida)
          }}
        />
      </Ventana>
    </>
  )
}

/**
 * «Generar OC» con los insumos marcados en «Por comprar»: de uno o de varios RQ
 * del mismo tipo, para un proveedor. El mismo formulario de la directa, con una
 * línea por material y lo que falta de él ya puesto: queda el precio. Cada
 * insumo sigue con su RQ y su código interno; el motivo lo pone la base.
 */
export function GenerarCompraDeInsumos({
  insumos,
  proveedores,
  materiales,
  puedeRegistrarProveedor,
  alEmitir,
}: {
  insumos: InsumoParaCompra[]
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  puedeRegistrarProveedor: boolean
  /** Al emitirla: la lista desmarca lo que ya va en la orden. */
  alEmitir: (emitida: Emitida) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const rqs = new Set(insumos.map((i) => i.requerimiento_id)).size
  return (
    <>
      <Boton
        type="button"
        disabled={insumos.length === 0}
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <ShoppingCart aria-hidden className="size-4" />
        Generar OC
        {insumos.length > 0 && (
          <span className="tabular text-xs font-normal">
            · {insumos.length} {insumos.length === 1 ? 'insumo' : 'insumos'}
            {rqs > 1 ? ` de ${rqs} RQ` : ''}
          </span>
        )}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={rqs > 1 ? `Generar OC de ${rqs} requerimientos` : `Generar OC del ${insumos[0]?.requerimiento ?? 'requerimiento'}`}
        descripcion="Una línea por material, con lo que falta de él en cada requerimiento. Gerencia la aprueba y el conductor la deja en almacén; Almacén la recepciona y cada requerimiento queda listo."
        ancho="xl"
      >
        <FormularioCompraDirecta
          key={vez}
          insumos={insumos}
          proveedores={proveedores}
          materiales={materiales}
          puedeRegistrarProveedor={puedeRegistrarProveedor}
          alTerminar={(emitida) => {
            setAbierta(false)
            alEmitir(emitida)
          }}
        />
      </Ventana>
    </>
  )
}

function FormularioCompraDirecta({
  insumos,
  proveedores,
  materiales,
  codigos = null,
  puedeRegistrarProveedor,
  alTerminar,
}: {
  /** Los insumos de RQ que compra la orden; sin ellos, es la directa. */
  insumos?: InsumoParaCompra[]
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  /** La lista del código interno de la directa; la de insumos lleva el de cada RQ. */
  codigos?: CodigoParaElegir[] | null
  puedeRegistrarProveedor: boolean
  alTerminar: (emitida: Emitida) => void
}) {
  // Los dos identificadores se deciden aquí: un reintento manda los mismos y la
  // base devuelve la misma orden y el mismo documento, sin duplicar.
  const [id] = useState(() => crypto.randomUUID())
  const [idFactura] = useState(() => crypto.randomUUID())
  // La orden salió pero su comprobante no quedó, o no se sabe: el aviso no va en verde.
  const aRevisar = useRef(false)
  const [proveedorId, setProveedorId] = useState('')
  const [condicion, setCondicion] = useState('CONTADO')
  const [dias, setDias] = useState(0)
  const [divisa, setDivisa] = useState<'PEN' | 'USD'>('PEN')
  const [conFactura, setConFactura] = useState(true)
  // La orden de insumos trae puestos los materiales que faltan, con lo que
  // falta de cada uno: solo queda el precio.
  const [lineas, setLineas] = useState<Linea[]>(() =>
    insumos && insumos.length > 0 ? lineasDeInsumos(insumos, new Set(materiales.map((m) => m.id))) : [lineaVacia()],
  )
  const deInsumos = Boolean(insumos)
  const requerimientos = useMemo(() => {
    const vistos = new Map<string, InsumoParaCompra>()
    for (const i of insumos ?? []) if (!vistos.has(i.requerimiento_id)) vistos.set(i.requerimiento_id, i)
    return [...vistos.values()]
  }, [insumos])

  const opcionesMaterial = useMemo(
    () => materiales.map((m) => ({ valor: m.id, etiqueta: m.descripcion, detalle: [m.codigo, m.unidad].filter(Boolean).join(' · ') })),
    [materiales],
  )
  const unidadDe = useMemo(() => new Map(materiales.map((m) => [m.id, m.unidad])), [materiales])
  const total = lineas.reduce((suma, l) => suma + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0)
  const detector = useDetectorDeFactura(ACEPTA_PDF, 20)
  const datosFactura = useDatosDeFactura()
  // Con la factura elegida, su número y su fecha son obligatorios.
  const [hayFactura, setHayFactura] = useState(false)

  function elegirProveedor(p: ProveedorParaCompra | undefined) {
    setProveedorId(p?.id ?? '')
    if (p) {
      setCondicion(p.condicion_pago)
      setDias(p.dias_credito)
    }
  }
  function cambiar(clave: string, campo: keyof Omit<Linea, 'clave'>, valor: string) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)))
  }

  const { alEnviar, enviando, error, limpiar } = useEnvio(
    async (_previo, datos) => {
      const factura = datos.get('factura')
      datos.delete('factura')
      datos.delete('factura_numero')
      datos.delete('factura_fecha')
      const nombre = conFactura ? 'La factura' : 'El comprobante'
      const o = conFactura ? 'a' : 'o'
      aRevisar.current = false
      // Un archivo elegido cuenta aunque pese 0 bytes: tomarlo por «sin
      // archivo» emitía la orden sin decir que el PDF se quedó fuera.
      const adjuntando = factura instanceof File && factura.name !== ''
      if (adjuntando && factura.size === 0) {
        return { ok: false, error: `${nombre} está vací${o}: elige otr${o} o quítal${o} para adjuntarl${o} después.` }
      }
      if (adjuntando && !(await esPdf(factura))) {
        return { ok: false, error: `${nombre} debe ser un PDF de hasta 20 MB. Quítal${o} para adjuntarl${o} después.` }
      }
      // Antes de emitir: la orden no sale con una factura sin su número o su fecha.
      const falta = adjuntando && conFactura ? faltaEnLaFactura(datosFactura.numero, datosFactura.fecha) : null
      if (falta) return { ok: false, error: `${falta} O quita el PDF para adjuntarlo después.` }
      datos.set(
        'lineas',
        JSON.stringify(
          lineas.map((l) => ({
            material_id: l.material_id,
            cantidad: l.cantidad,
            precio: l.precio,
            ...(deInsumos ? { insumos: l.insumos.map((i) => i.id) } : {}),
          })),
        ),
      )
      const emitida = deInsumos ? await emitirCompraDeInsumos(null, datos) : await emitirCompraDirecta(null, datos)
      if (!emitida.ok || !adjuntando) return emitida

      const documento = new FormData()
      documento.set('id', idFactura)
      documento.set('orden_compra_id', id)
      documento.set('tipo', conFactura ? 'FACTURA' : 'COMPROBANTE')
      documento.set('nombre_archivo', factura.name.trim().slice(0, 200))
      if (conFactura) {
        documento.set('factura_numero', datosFactura.numero)
        documento.set('factura_fecha', datosFactura.fecha)
      }
      const adjunta = await subirArchivoPrivado({
        bucket: 'documentos-compras',
        ruta: `compra/${id}/${idFactura}.pdf`,
        archivo: factura,
        contentType: 'application/pdf',
        registrar: () => registrarDocumentoCompra(null, documento),
      })
      // La orden ya quedó y la ventana se cierra: si el comprobante no subió, se
      // dice, en el color de lo que falta, y se adjunta desde la lista. Si no se
      // sabe, se mira antes: desde la lista va con otro id y, si había quedado,
      // saldría dos veces.
      if (!adjunta.ok) {
        aRevisar.current = true
        if (adjunta.error.startsWith(NO_SE_CONFIRMO) || esOtroArchivoEnLaRuta(adjunta.error)) {
          return {
            ok: true,
            mensaje: `${emitida.mensaje} No se sabe si ${nombre.toLowerCase()} quedó adjunt${o}: recarga la lista y mira si está antes de adjuntarl${o} otra vez.`,
          }
        }
        const motivo = adjunta.error === NO_QUEDO_SIN_RESPUESTA ? 'no llegó la respuesta.' : dentroDeOtraOracion(adjunta.error)
        return { ok: true, mensaje: `${emitida.mensaje} ${nombre} no se adjuntó: ${motivo} Adjúntal${o} desde la lista.` }
      }
      return { ok: true, mensaje: `${emitida.mensaje} ${conFactura ? 'Factura adjunta.' : 'Comprobante adjunto.'}` }
    },
    (r) => alTerminar({ texto: r.mensaje ?? 'Orden emitida.', aRevisar: aRevisar.current }),
  )

  const listas = lineas.every((l) => l.material_id && Number(l.cantidad) > 0 && l.precio !== '')
  // Al volver de un rechazo, el cursor va al archivo si es por él, o al aviso.
  const campoFactura = useRef<HTMLInputElement>(null)
  const avisoError = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, () => (/ está vací|debe ser un PDF/.test(error ?? '') ? campoFactura.current : avisoError.current))

  return (
    <form onSubmit={alEnviar} className="space-y-6">
        <input type="hidden" name="operacion_id" value={id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectorProveedor
            id="ocd-proveedor"
            proveedores={proveedores}
            puedeRegistrar={puedeRegistrarProveedor}
            valor={proveedorId}
            alElegir={elegirProveedor}
          />
          <Campo etiqueta="Referencia del proveedor" htmlFor="ocd-referencia" ayuda="Su cotización o proforma. Si la dejas vacía, se usa el número de la orden.">
            <Entrada id="ocd-referencia" name="referencia" maxLength={100} placeholder="COT-0123" />
          </Campo>
          {deInsumos ? (
            <div className="rounded-xl border border-borde bg-superficie-2 p-3 text-sm sm:col-span-2">
              <p className="font-semibold text-texto">
                Atiende {requerimientos.length === 1 ? 'el requerimiento' : `${requerimientos.length} requerimientos`}
              </p>
              <ul className="mt-1 space-y-0.5 text-texto">
                {requerimientos.map((r) => (
                  <li key={r.requerimiento_id}>
                    <span className="tabular font-medium">{r.requerimiento}</span> · {r.area} · código interno{' '}
                    <span className="tabular font-medium">{r.codigo_interno}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-texto-suave">
                Cada insumo lleva el código interno de su requerimiento: el costo de la orden se reparte entre ellos. El motivo de la orden sale de los requerimientos.
              </p>
            </div>
          ) : (
            <>
              <Campo etiqueta="Por qué se compra sin requerimiento" htmlFor="ocd-motivo" requerido className="sm:col-span-2">
                <AreaTexto
                  id="ocd-motivo"
                  name="motivo"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={2}
                  placeholder="Por ejemplo: reposición de consumibles que bajaron del mínimo."
                />
              </Campo>
              <Campo etiqueta="Código interno" htmlFor="ocd-codigo" requerido ayuda={AYUDA_CODIGO_INTERNO}>
                <CodigoInternoConLista id="ocd-codigo" name="codigo_interno" requerido valorInicial="PLANTA" codigos={codigos} fijos={CODIGOS_FIJOS} />
              </Campo>
            </>
          )}
          <Campo etiqueta="Comprobante" htmlFor="ocd-comprobante" ayuda={comprobantePedido(conFactura).pide}>
            <Seleccion
              id="ocd-comprobante"
              name="con_factura"
              value={conFactura ? 'true' : 'false'}
              onChange={(e) => setConFactura(e.target.value === 'true')}
            >
              <option value="true">Con factura</option>
              <option value="false">Sin factura</option>
            </Seleccion>
          </Campo>
          <Campo etiqueta="Entrega estimada" htmlFor="ocd-fecha">
            <Entrada id="ocd-fecha" name="fecha_estimada" type="date" />
          </Campo>
          <Campo etiqueta="Moneda" htmlFor="ocd-moneda">
            <Seleccion id="ocd-moneda" name="moneda" value={divisa} onChange={(e) => setDivisa(e.target.value === 'USD' ? 'USD' : 'PEN')}>
              <option value="PEN">Soles</option>
              <option value="USD">Dólares</option>
            </Seleccion>
          </Campo>
          <Campo etiqueta="Pago" htmlFor="ocd-pago">
            <Seleccion
              id="ocd-pago"
              name="condicion"
              value={condicion}
              onChange={(e) => {
                setCondicion(e.target.value)
                if (e.target.value === 'CONTADO') setDias(0)
              }}
            >
              <option value="CONTADO">Contado</option>
              <option value="CREDITO">Crédito</option>
            </Seleccion>
          </Campo>
          <Campo etiqueta="Días de crédito" ayuda="0 para contado" htmlFor="ocd-dias">
            <Entrada
              id="ocd-dias"
              name="dias"
              type="number"
              min={condicion === 'CREDITO' ? 1 : 0}
              max={condicion === 'CREDITO' ? 365 : 0}
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
            />
          </Campo>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-3 font-semibold text-texto">Materiales · {lineas.length}</legend>
          {lineas.map((l, i) => (
            <div key={l.clave} className="grid gap-3 rounded-xl border border-borde p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <Campo etiqueta={`Material ${i + 1}`} htmlFor={`ocd-mat-${l.clave}`}>
                <SeleccionBuscable
                  id={`ocd-mat-${l.clave}`}
                  requerido
                  valor={l.material_id}
                  onChange={(v) => cambiar(l.clave, 'material_id', v)}
                  marcador="Elige del catálogo…"
                  marcadorBusqueda="Nombre o código…"
                  opciones={opcionesMaterial.filter((o) => o.valor === l.material_id || !lineas.some((x) => x.material_id === o.valor))}
                />
              </Campo>
              <Campo etiqueta={`Cantidad${unidadDe.get(l.material_id) ? ` (${unidadDe.get(l.material_id)})` : ''}`} htmlFor={`ocd-cant-${l.clave}`}>
                <Entrada
                  id={`ocd-cant-${l.clave}`}
                  type="number"
                  inputMode="decimal"
                  min={0.001}
                  step="0.001"
                  required
                  value={l.cantidad}
                  onChange={(e) => cambiar(l.clave, 'cantidad', e.target.value)}
                />
              </Campo>
              <Campo etiqueta="Precio unitario sin IGV" htmlFor={`ocd-precio-${l.clave}`}>
                <Entrada
                  id={`ocd-precio-${l.clave}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={l.precio}
                  onChange={(e) => cambiar(l.clave, 'precio', e.target.value)}
                />
              </Campo>
              <Boton
                type="button"
                variante="fantasma"
                tamano="icono"
                aria-label={`Quitar el material ${i + 1}${l.insumos.length > 0 ? ' y sus insumos' : ''}`}
                disabled={lineas.length === 1}
                onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
              >
                <Trash2 aria-hidden className="size-4" />
              </Boton>
              {l.insumos.length > 0 && (
                <ul className="space-y-0.5 text-xs text-texto-suave sm:col-span-4">
                  {l.insumos.map((x) => (
                    <li key={x.id}>
                      <span className="tabular font-medium text-texto">
                        {formatoCantidad(x.falta)} {x.unidad}
                      </span>{' '}
                      {x.descripcion} · <span className="tabular">{x.requerimiento}</span> · {x.area} ·{' '}
                      <span className="tabular">{x.codigo_interno}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {deInsumos ? (
              <p className="text-xs text-texto-suave">Para comprar otro insumo, márcalo en la lista y vuelve a abrir la orden.</p>
            ) : (
              <Boton type="button" variante="contorno" tamano="sm" disabled={lineas.length >= 100} onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
                <Plus aria-hidden className="size-4" />
                Agregar material
              </Boton>
            )}
            <p className="text-sm text-texto">
              {conFactura ? 'Subtotal sin IGV' : 'Total'} <span className="tabular font-semibold">{formatoMoneda(total, divisa)}</span>
              {conFactura && (
                <span className="ml-2 text-texto-suave">
                  · con IGV <span className="tabular">{formatoMoneda(total + igvCompra(total), divisa)}</span>
                </span>
              )}
            </p>
          </div>
          {materiales.length === 0 && <p className="text-sm text-texto-suave">El catálogo de Almacén está vacío: Almacén da de alta los materiales.</p>}
        </fieldset>

        <Campo
          etiqueta={conFactura ? 'Factura (opcional)' : 'Comprobante (opcional)'}
          htmlFor="ocd-factura"
          ayuda={
            conFactura
              ? 'Si todavía no la tienes, la adjuntas después desde la lista.'
              : 'La boleta, nota de venta o recibo. Si todavía no lo tienes, lo adjuntas después desde la lista.'
          }
        >
          <ElegirArchivo
            ref={campoFactura}
            id="ocd-factura"
            name="factura"
            accept={ACEPTA_PDF}
            hastaMb={20}
            disabled={enviando}
            aviso={detector.aviso}
            estado={conFactura ? detector.leyendo : null}
            onChange={(e) => {
              const archivo = e.target.files?.[0]
              // Uno vacío no pide su número ni su fecha: primero se cambia.
              setHayFactura(Boolean(archivo && archivo.size > 0))
              limpiar()
              // Lo leído del archivo anterior se va con él; lo escrito a mano se queda.
              datosFactura.soltarLeido()
              // El comprobante sin factura también se revisa, pero no se lee.
              void detector.leer(archivo, !conFactura).then(datosFactura.completar)
            }}
          />
        </Campo>
        {conFactura && hayFactura && !detector.aviso && (
          <div className="grid gap-4 sm:grid-cols-2">
            <CamposDeLaFactura id="ocd-factura" datos={datosFactura} requerido disabled={enviando} />
          </div>
        )}
        {conFactura && (
          <AvisoFacturaDeLaOrden
            lectura={detector.lectura}
            total={total > 0 ? Math.round((total + igvCompra(total)) * 100) / 100 : null}
            moneda={divisa}
            anotada={datosFactura.numero}
          />
        )}

        {error && (
          <p ref={avisoError} role="alert" tabIndex={-1} className="text-sm text-peligro">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Boton type="submit" cargando={enviando} disabled={!proveedorId || !listas}>
            Emitir orden de compra
          </Boton>
        </div>
      </form>
  )
}

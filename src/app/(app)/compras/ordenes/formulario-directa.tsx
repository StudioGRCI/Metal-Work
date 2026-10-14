'use client'

import { Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { registrarDocumentoCompra } from '@/app/(app)/materiales/atencion/acciones-documentos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { igvCompra } from '@/lib/dominio/compra-materiales'
import { comprobantePedido } from '@/lib/dominio/proveedores'
import { useEnvio } from '@/lib/envio'
import { cantidad as formatoCantidad, moneda as formatoMoneda } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'

import { SelectorProveedor } from '../selector-proveedor'
import { emitirCompraDelRequerimiento, emitirCompraDirecta } from './acciones'

type Linea = { clave: string; material_id: string; cantidad: string; precio: string }

/** El requerimiento del que nace la OC: lo que el formulario muestra y los insumos que ofrece marcar. */
export type RequerimientoParaCompra = {
  id: string
  numero: string
  area: string
  codigo_interno: string
  justificacion: string
  lineas: {
    item: number
    descripcion: string
    cantidad: number
    unidad: string
    orden_compra: string | null
    compra_rechazada: boolean
    /** Cuánto tenía Almacén al revisarlo; vacío si no lo revisó. Lo que tiene completo no se compra. */
    en_stock: number | null
  }[]
}

function lineaVacia(): Linea {
  return { clave: crypto.randomUUID(), material_id: '', cantidad: '', precio: '' }
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
  puedeRegistrarProveedor,
}: {
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  puedeRegistrarProveedor: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  // Cada apertura es una orden nueva; el formulario se monta de cero.
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
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
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
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
          puedeRegistrarProveedor={puedeRegistrarProveedor}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

/**
 * «Generar OC» desde un requerimiento al que Almacén le encontró faltantes: el
 * mismo formulario de la directa, con el código interno y el motivo tomados del
 * RQ y la lista de insumos que esta orden cubre. Solo se ofrece lo que falta:
 * lo que Almacén tiene completo no se compra, y de lo que tenía en parte se
 * compra el resto.
 */
export function GenerarCompraDelRequerimiento({
  requerimiento,
  proveedores,
  materiales,
  puedeRegistrarProveedor,
}: {
  requerimiento: RequerimientoParaCompra
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  puedeRegistrarProveedor: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <ShoppingCart aria-hidden className="size-4" />
        Generar OC
      </Boton>
      {aviso && (
        <p role="status" className="max-w-xs text-right text-xs text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Generar OC del ${requerimiento.numero}`}
        descripcion="Marca qué insumos del requerimiento cubre esta orden y elige del catálogo lo que se compra. Gerencia la aprueba y el conductor la deja en almacén; Almacén la recepciona y el requerimiento queda listo."
        ancho="xl"
      >
        <FormularioCompraDirecta
          key={vez}
          requerimiento={requerimiento}
          proveedores={proveedores}
          materiales={materiales}
          puedeRegistrarProveedor={puedeRegistrarProveedor}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

function FormularioCompraDirecta({
  requerimiento,
  proveedores,
  materiales,
  puedeRegistrarProveedor,
  alTerminar,
}: {
  requerimiento?: RequerimientoParaCompra
  proveedores: ProveedorParaCompra[]
  materiales: MaterialParaConteo[]
  puedeRegistrarProveedor: boolean
  alTerminar: (mensaje: string) => void
}) {
  // Los dos identificadores se deciden aquí: un reintento manda los mismos y la
  // base devuelve la misma orden y el mismo documento, sin duplicar.
  const [id] = useState(() => crypto.randomUUID())
  const [idFactura] = useState(() => crypto.randomUUID())
  const [proveedorId, setProveedorId] = useState('')
  const [condicion, setCondicion] = useState('CONTADO')
  const [dias, setDias] = useState(0)
  const [divisa, setDivisa] = useState<'PEN' | 'USD'>('PEN')
  const [conFactura, setConFactura] = useState(true)
  const [lineas, setLineas] = useState<Linea[]>(() => [lineaVacia()])

  const opcionesMaterial = useMemo(
    () => materiales.map((m) => ({ valor: m.id, etiqueta: m.descripcion, detalle: [m.codigo, m.unidad].filter(Boolean).join(' · ') })),
    [materiales],
  )
  const unidadDe = useMemo(() => new Map(materiales.map((m) => [m.id, m.unidad])), [materiales])
  const total = lineas.reduce((suma, l) => suma + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0)

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

  const { alEnviar, enviando, error } = useEnvio(
    async (_previo, datos) => {
      const factura = datos.get('factura')
      datos.delete('factura')
      const nombre = conFactura ? 'La factura' : 'El comprobante'
      const adjuntando = factura instanceof File && factura.size > 0
      if (adjuntando && !(await esPdf(factura))) {
        return { ok: false, error: `${nombre} debe ser un PDF de hasta 20 MB. Quítalo para adjuntarlo después.` }
      }
      datos.set(
        'lineas',
        JSON.stringify(lineas.map((l) => ({ material_id: l.material_id, cantidad: l.cantidad, precio: l.precio }))),
      )
      const emitida = requerimiento ? await emitirCompraDelRequerimiento(null, datos) : await emitirCompraDirecta(null, datos)
      if (!emitida.ok || !adjuntando) return emitida

      const documento = new FormData()
      documento.set('id', idFactura)
      documento.set('orden_compra_id', id)
      documento.set('tipo', conFactura ? 'FACTURA' : 'COMPROBANTE')
      documento.set('nombre_archivo', factura.name.trim().slice(0, 200))
      const adjunta = await subirArchivoPrivado({
        bucket: 'documentos-compras',
        ruta: `compra/${id}/${idFactura}.pdf`,
        archivo: factura,
        contentType: 'application/pdf',
        registrar: () => registrarDocumentoCompra(null, documento),
      })
      // La orden ya quedó: si el comprobante no subió, se dice y se adjunta desde la lista.
      if (!adjunta.ok) {
        return { ok: true, mensaje: `${emitida.mensaje} ${nombre} no se adjuntó (${adjunta.error}); adjúntalo desde la lista.` }
      }
      return { ok: true, mensaje: `${emitida.mensaje} ${conFactura ? 'Factura adjunta.' : 'Comprobante adjunto.'}` }
    },
    (r) => alTerminar(r.mensaje ?? 'Orden emitida.'),
  )

  const listas = lineas.every((l) => l.material_id && Number(l.cantidad) > 0 && l.precio !== '')

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
          {requerimiento ? (
            <div className="rounded-xl border border-borde bg-superficie-2 p-3 text-sm sm:col-span-2">
              <input type="hidden" name="requerimiento_id" value={requerimiento.id} />
              <p className="text-texto">
                <span className="font-semibold">{requerimiento.numero}</span> · {requerimiento.area} · código interno{' '}
                <span className="tabular font-semibold">{requerimiento.codigo_interno}</span>
              </p>
              <p className="mt-1 text-texto-suave">{requerimiento.justificacion}</p>
              <p className="mt-1 text-xs text-texto-suave">El código interno y el motivo de la orden salen del requerimiento.</p>
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
                <Entrada id="ocd-codigo" name="codigo_interno" required minLength={2} maxLength={60} defaultValue="PLANTA" autoComplete="off" />
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

        {requerimiento && (
          <fieldset className="space-y-2">
            <legend className="mb-2 font-semibold text-texto">Insumos del requerimiento que cubre esta orden</legend>
            {requerimiento.lineas.map((l) => {
              const enStock = l.en_stock ?? 0
              const loTiene = l.en_stock !== null && enStock >= l.cantidad
              const ocupado = loTiene || (Boolean(l.orden_compra) && !l.compra_rechazada)
              return (
                <label key={l.item} className={`flex items-start gap-2 text-sm ${ocupado ? 'text-texto-suave' : 'text-texto'}`}>
                  <input type="checkbox" name="item" value={l.item} defaultChecked={!ocupado} disabled={ocupado} className="mt-1" />
                  <span>
                    <span className="tabular font-medium">
                      {formatoCantidad(loTiene ? l.cantidad : l.cantidad - enStock)} {l.unidad}
                    </span>{' '}
                    {l.descripcion}
                    {loTiene ? (
                      <span className="block text-xs text-texto-suave">Almacén lo tiene: no se compra.</span>
                    ) : (
                      enStock > 0 && (
                        <span className="block text-xs text-texto-suave">
                          Pidieron {formatoCantidad(l.cantidad)}; Almacén tiene {formatoCantidad(enStock)}: se compra el resto.
                        </span>
                      )
                    )}
                    {!loTiene && l.orden_compra && (
                      <span className="block text-xs text-texto-suave">
                        {l.compra_rechazada ? `La ${l.orden_compra} se rechazó: vuelve a comprarse.` : `Ya va en la ${l.orden_compra}.`}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </fieldset>
        )}

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
                aria-label={`Quitar el material ${i + 1}`}
                disabled={lineas.length === 1}
                onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
              >
                <Trash2 aria-hidden className="size-4" />
              </Boton>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Boton type="button" variante="contorno" tamano="sm" disabled={lineas.length >= 100} onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
              <Plus aria-hidden className="size-4" />
              Agregar material
            </Boton>
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
              ? 'PDF de hasta 20 MB. Si todavía no la tienes, la adjuntas después desde la lista.'
              : 'La boleta, nota de venta o recibo, en PDF de hasta 20 MB. Si todavía no lo tienes, lo adjuntas después desde la lista.'
          }
        >
          <Entrada id="ocd-factura" name="factura" type="file" accept="application/pdf,.pdf" disabled={enviando} />
        </Campo>

        {error && (
          <p role="alert" className="text-sm text-peligro">
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

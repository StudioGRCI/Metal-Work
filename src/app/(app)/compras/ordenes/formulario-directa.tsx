'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { registrarDocumentoCompra } from '@/app/(app)/materiales/atencion/acciones-documentos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { useEnvio } from '@/lib/envio'
import { moneda as formatoMoneda } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'

import { SelectorProveedor } from '../selector-proveedor'
import { emitirCompraDirecta } from './acciones'

type Linea = { clave: string; material_id: string; cantidad: string; precio: string }

function lineaVacia(): Linea {
  return { clave: crypto.randomUUID(), material_id: '', cantidad: '', precio: '' }
}

async function esPdf(archivo: File) {
  return archivo.size > 0 && archivo.size <= 20 * 1024 * 1024 && (await archivo.slice(0, 5).text()) === '%PDF-'
}

/**
 * La orden de compra directa: proveedor del padrón, materiales del catálogo de
 * Almacén, cantidad y precio sin IGV, y por qué se compra. La factura se puede
 * adjuntar aquí mismo o después, desde la lista.
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

function FormularioCompraDirecta({
  proveedores,
  materiales,
  puedeRegistrarProveedor,
  alTerminar,
}: {
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
      const conFactura = factura instanceof File && factura.size > 0
      if (conFactura && !(await esPdf(factura))) {
        return { ok: false, error: 'La factura debe ser un PDF de hasta 20 MB. Quítala para adjuntarla después.' }
      }
      datos.set(
        'lineas',
        JSON.stringify(lineas.map((l) => ({ material_id: l.material_id, cantidad: l.cantidad, precio: l.precio }))),
      )
      const emitida = await emitirCompraDirecta(null, datos)
      if (!emitida.ok || !conFactura) return emitida

      const documento = new FormData()
      documento.set('id', idFactura)
      documento.set('orden_compra_id', id)
      documento.set('tipo', 'FACTURA')
      documento.set('nombre_archivo', factura.name.trim().slice(0, 200))
      const adjunta = await subirArchivoPrivado({
        bucket: 'documentos-compras',
        ruta: `compra/${id}/${idFactura}.pdf`,
        archivo: factura,
        contentType: 'application/pdf',
        registrar: () => registrarDocumentoCompra(null, documento),
      })
      // La orden ya quedó: si la factura no subió, se dice y se adjunta desde la lista.
      if (!adjunta.ok) return { ok: true, mensaje: `${emitida.mensaje} La factura no se adjuntó (${adjunta.error}); adjúntala desde la lista.` }
      return { ok: true, mensaje: `${emitida.mensaje} Factura adjunta.` }
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
              Total sin IGV <span className="tabular font-semibold">{formatoMoneda(total, divisa)}</span>
            </p>
          </div>
          {materiales.length === 0 && <p className="text-sm text-texto-suave">El catálogo de Almacén está vacío: Almacén da de alta los materiales.</p>}
        </fieldset>

        <Campo etiqueta="Factura (opcional)" htmlFor="ocd-factura" ayuda="PDF de hasta 20 MB. Si todavía no la tienes, la adjuntas después desde la lista.">
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

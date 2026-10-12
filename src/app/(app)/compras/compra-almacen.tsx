'use client'

import { PackagePlus, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { FormularioProveedor } from '@/app/(app)/proveedores/formulario'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { condicionDePago } from '@/lib/dominio/proveedores'
import { useEnvio } from '@/lib/envio'
import { moneda as formatearMoneda } from '@/lib/format'

import { emitirCompraParaAlmacen } from './acciones'

type Linea = { cantidad: string; precio: string }

/**
 * La orden de compra que no sale de ninguna OT: reponer el almacén. Se eligen
 * los materiales del catálogo de Almacén uno por uno, con su cantidad y su
 * precio sin IGV.
 */
export function CompraParaAlmacen({
  materiales,
  proveedores,
  puedeRegistrarProveedor,
}: {
  materiales: MaterialParaConteo[]
  proveedores: ProveedorParaCompra[]
  puedeRegistrarProveedor: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  // Cada apertura es una compra nueva, con su propio identificador.
  const [vez, setVez] = useState(0)
  return (
    <>
      <Boton onClick={() => { setAviso(null); setVez((v) => v + 1); setAbierta(true) }}>
        <PackagePlus aria-hidden className="size-4" />Compra para almacén
      </Boton>
      {aviso && <p role="status" className="basis-full text-sm text-exito">{aviso}</p>}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Compra para almacén"
        descripcion="Para reponer stock sin que una OT lo haya pedido. Pasa por la aprobación de Gerencia si llega al monto y, lista, le llega al conductor para recogerla."
        ancho="xl"
      >
        <Formulario
          key={vez}
          materiales={materiales}
          proveedores={proveedores}
          puedeRegistrarProveedor={puedeRegistrarProveedor}
          alTerminar={(mensaje) => { setAbierta(false); setAviso(mensaje ?? null) }}
        />
      </Ventana>
    </>
  )
}

function Formulario({
  materiales,
  proveedores,
  puedeRegistrarProveedor,
  alTerminar,
}: {
  materiales: MaterialParaConteo[]
  proveedores: ProveedorParaCompra[]
  puedeRegistrarProveedor: boolean
  alTerminar: (mensaje?: string) => void
}) {
  const [id] = useState(() => crypto.randomUUID())
  const [nuevos, setNuevos] = useState<ProveedorParaCompra[]>([])
  const [proveedorId, setProveedorId] = useState('')
  const [condicion, setCondicion] = useState('CONTADO')
  const [dias, setDias] = useState(0)
  const [codigoMoneda, setCodigoMoneda] = useState<'PEN' | 'USD'>('PEN')
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [avisoAlta, setAvisoAlta] = useState<string | null>(null)
  const [elegidos, setElegidos] = useState<string[]>([])
  const [lineas, setLineas] = useState<Record<string, Linea>>({})
  const { alEnviar, enviando, error } = useEnvio(emitirCompraParaAlmacen, (r) => alTerminar(r.mensaje))

  const padron = useMemo(() => {
    const vistos = new Set(proveedores.map((p) => p.id))
    return [...proveedores, ...nuevos.filter((n) => !vistos.has(n.id))]
  }, [proveedores, nuevos])
  const porId = useMemo(() => new Map(materiales.map((m) => [m.id, m])), [materiales])
  const disponibles = useMemo(
    () => materiales.filter((m) => !elegidos.includes(m.id)).map((m) => ({
      valor: m.id, etiqueta: m.descripcion, detalle: `${m.codigo}${m.unidad ? ` · ${m.unidad}` : ''}`,
    })),
    [materiales, elegidos],
  )
  const total = elegidos.reduce((s, m) => s + (Number(lineas[m]?.cantidad) || 0) * (Number(lineas[m]?.precio) || 0), 0)

  // Elegir el proveedor trae su pago habitual; se puede cambiar para esta compra.
  function elegirProveedor(valor: string) {
    setProveedorId(valor)
    const p = padron.find((x) => x.id === valor)
    if (p) { setCondicion(p.condicion_pago); setDias(p.dias_credito) }
  }
  function agregar(valor: string) {
    if (!valor || elegidos.includes(valor)) return
    setElegidos((e) => [...e, valor])
    setLineas((l) => ({ ...l, [valor]: l[valor] ?? { cantidad: '', precio: '' } }))
  }
  function quitar(valor: string) {
    setElegidos((e) => e.filter((x) => x !== valor))
  }
  function cambiar(valor: string, campo: keyof Linea, texto: string) {
    setLineas((l) => ({ ...l, [valor]: { ...(l[valor] ?? { cantidad: '', precio: '' }), [campo]: texto } }))
  }

  return (
    <>
      <form onSubmit={alEnviar} className="space-y-6">
        <input type="hidden" name="operacion_id" value={id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Proveedor" htmlFor="oca-proveedor" requerido ayuda={padron.length === 0 ? 'El padrón está vacío: registra el primero.' : undefined}>
            <div className="flex gap-2">
              <SeleccionBuscable id="oca-proveedor" name="proveedor_id" className="min-w-0 flex-1" requerido valor={proveedorId} onChange={elegirProveedor}
                marcador="Elige del padrón…" marcadorBusqueda="Razón social o RUC…"
                opciones={padron.map((p) => ({ valor: p.id, etiqueta: p.razon_social, detalle: `${p.numero_documento} · ${condicionDePago(p.condicion_pago, p.dias_credito)}` }))} />
              {puedeRegistrarProveedor && (
                <Boton type="button" variante="contorno" onClick={() => { setAvisoAlta(null); setAltaAbierta(true) }}>
                  <Plus aria-hidden className="size-4" />Nuevo
                </Boton>
              )}
            </div>
            {avisoAlta && <p role="status" className="text-xs text-exito">{avisoAlta}</p>}
          </Campo>
          <Campo etiqueta="Número de orden de compra" htmlFor="oca-numero" requerido>
            <Entrada id="oca-numero" name="referencia" required minLength={2} maxLength={100} />
          </Campo>
          <Campo etiqueta="Entrega estimada" htmlFor="oca-fecha" ayuda="El día que el conductor puede pasar a recogerla.">
            <Entrada id="oca-fecha" name="fecha_estimada" type="date" />
          </Campo>
          <Campo etiqueta="Moneda" htmlFor="oca-moneda">
            <Seleccion id="oca-moneda" name="moneda" value={codigoMoneda} onChange={(e) => setCodigoMoneda(e.target.value === 'USD' ? 'USD' : 'PEN')}>
              <option value="PEN">Soles</option><option value="USD">Dólares</option>
            </Seleccion>
          </Campo>
          <Campo etiqueta="Pago" htmlFor="oca-pago">
            <Seleccion id="oca-pago" name="condicion" value={condicion} onChange={(e) => { setCondicion(e.target.value); if (e.target.value === 'CONTADO') setDias(0) }}>
              <option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option>
            </Seleccion>
          </Campo>
          <Campo etiqueta="Días de crédito" ayuda="0 para contado" htmlFor="oca-dias">
            <Entrada id="oca-dias" name="dias" type="number" min={condicion === 'CREDITO' ? 1 : 0} max={condicion === 'CREDITO' ? 365 : 0}
              value={dias} onChange={(e) => setDias(Number(e.target.value))} />
          </Campo>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-3 font-semibold text-texto">Materiales · {elegidos.length} {elegidos.length === 1 ? 'elegido' : 'elegidos'}</legend>
          <Campo etiqueta="Agregar material del catálogo de Almacén" htmlFor="oca-agregar"
            ayuda={materiales.length === 0 ? 'El catálogo de Almacén está vacío: Almacén da de alta los materiales.' : 'Elige uno y aparece abajo para poner su cantidad y precio.'}>
            <SeleccionBuscable id="oca-agregar" valor="" onChange={agregar} permiteVaciar={false}
              marcador="Busca por nombre o código…" marcadorBusqueda="Nombre o código del material…" opciones={disponibles} />
          </Campo>
          {elegidos.map((m) => {
            const material = porId.get(m)
            return (
              <div key={m} className="rounded-xl border border-borde p-4">
                <input type="hidden" name="material_id" value={m} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-texto">{material?.descripcion ?? 'Material'}</p>
                    <p className="text-xs text-texto-suave"><span className="font-mono">{material?.codigo}</span>{material?.unidad ? ` · ${material.unidad}` : ''}</p>
                  </div>
                  <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Quitar ${material?.descripcion ?? 'material'}`} onClick={() => quitar(m)}>
                    <Trash2 aria-hidden className="size-4" />
                  </Boton>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta={`Cantidad${material?.unidad ? ` (${material.unidad})` : ''}`} htmlFor={`oca-cant-${m}`} requerido>
                    <Entrada id={`oca-cant-${m}`} name={`cantidad_${m}`} type="number" inputMode="decimal" min={0.001} step="0.001" required
                      value={lineas[m]?.cantidad ?? ''} onChange={(e) => cambiar(m, 'cantidad', e.target.value)} className="tabular" />
                  </Campo>
                  <Campo etiqueta="Precio unitario sin IGV" htmlFor={`oca-precio-${m}`} requerido ayuda="Si el proveedor lo da con IGV, divídelo entre 1.18.">
                    <Entrada id={`oca-precio-${m}`} name={`precio_${m}`} type="number" inputMode="decimal" min={0} step="0.01" required
                      value={lineas[m]?.precio ?? ''} onChange={(e) => cambiar(m, 'precio', e.target.value)} className="tabular" />
                  </Campo>
                </div>
              </div>
            )
          })}
          {elegidos.length === 0 && <p className="text-sm text-texto-suave">Todavía no hay materiales: búscalos arriba.</p>}
          {elegidos.length > 0 && (
            <p className="text-right text-sm text-texto-suave">Total sin IGV: <span className="tabular font-semibold text-texto">{formatearMoneda(total, codigoMoneda)}</span></p>
          )}
        </fieldset>
        {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
        <Boton type="submit" cargando={enviando} disabled={!elegidos.length || !proveedorId}>Emitir compra para almacén</Boton>
      </form>
      <Ventana abierta={altaAbierta} alCerrar={() => setAltaAbierta(false)} titulo="Nuevo proveedor"
        descripcion="Queda en el padrón y elegido para esta compra. Lo demás se completa en Proveedores." ancho="md">
        <FormularioProveedor breve alTerminar={(creado, mensaje) => {
          setAltaAbierta(false)
          if (!creado) return
          setNuevos((n) => [...n.filter((x) => x.id !== creado.id), creado])
          setProveedorId(creado.id); setCondicion(creado.condicion_pago); setDias(creado.dias_credito)
          setAvisoAlta(mensaje ?? null)
        }} />
      </Ventana>
    </>
  )
}

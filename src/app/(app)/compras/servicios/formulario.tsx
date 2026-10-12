'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { AreaSolicitante, OtParaLogistica } from '@/lib/datos/logistica'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { useEnvio } from '@/lib/envio'

import { SelectorProveedor } from '../selector-proveedor'
import { emitirOrdenServicio } from './acciones'

/** La orden de servicio: quién hace el trabajo, qué, para qué OT o área, cuánto y cuándo. */
export function NuevaOrdenServicio({
  proveedores,
  ordenes,
  areas,
  puedeRegistrarProveedor,
}: {
  proveedores: ProveedorParaCompra[]
  ordenes: OtParaLogistica[]
  areas: AreaSolicitante[]
  puedeRegistrarProveedor: boolean
}) {
  const [abierta, setAbierta] = useState(false)
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
        Nueva orden de servicio
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nueva orden de servicio"
        descripcion="Un trabajo que hace un tercero. El número OS-…-MW lo pone el sistema y Gerencia la aprueba antes de que el proveedor empiece."
        ancho="lg"
      >
        <FormularioServicio
          key={vez}
          proveedores={proveedores}
          ordenes={ordenes}
          areas={areas}
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

function FormularioServicio({
  proveedores,
  ordenes,
  areas,
  puedeRegistrarProveedor,
  alTerminar,
}: {
  proveedores: ProveedorParaCompra[]
  ordenes: OtParaLogistica[]
  areas: AreaSolicitante[]
  puedeRegistrarProveedor: boolean
  alTerminar: (mensaje: string) => void
}) {
  // Decidido aquí: un reintento manda el mismo y la base no duplica la orden.
  const [id] = useState(() => crypto.randomUUID())
  const [proveedorId, setProveedorId] = useState('')
  const [ordenId, setOrdenId] = useState('')
  const [condicion, setCondicion] = useState('CONTADO')
  const [dias, setDias] = useState(0)
  const { alEnviar, enviando, error } = useEnvio(emitirOrdenServicio, (r) => alTerminar(r.mensaje ?? 'Orden de servicio emitida.'))

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="operacion_id" value={id} />
      <SelectorProveedor
        id="os-proveedor"
        proveedores={proveedores}
        puedeRegistrar={puedeRegistrarProveedor}
        valor={proveedorId}
        alElegir={(p) => {
          setProveedorId(p?.id ?? '')
          if (p) {
            setCondicion(p.condicion_pago)
            setDias(p.dias_credito)
          }
        }}
      />
      <Campo etiqueta="Qué se hace" htmlFor="os-descripcion" requerido>
        <AreaTexto
          id="os-descripcion"
          name="descripcion"
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          placeholder="Por ejemplo: torneado de 4 ejes de 2 in según plano, con el material que entrega Metal Work."
        />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Para la OT (opcional)" htmlFor="os-orden" ayuda="Si el servicio es para una unidad en taller.">
          <SeleccionBuscable
            id="os-orden"
            name="orden_id"
            valor={ordenId}
            onChange={setOrdenId}
            marcador="Sin OT"
            marcadorBusqueda="Número de OT o unidad…"
            opciones={ordenes.map((o) => ({ valor: o.id, etiqueta: `OT ${o.numero}`, detalle: o.unidad ?? undefined }))}
          />
        </Campo>
        <Campo etiqueta="Área que lo pide (opcional)" htmlFor="os-area">
          <Seleccion id="os-area" name="area_id" defaultValue="">
            <option value="">Sin área</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Referencia del proveedor" htmlFor="os-referencia" ayuda="Su cotización o proforma, si la hay.">
          <Entrada id="os-referencia" name="referencia" maxLength={100} placeholder="COT-0123" />
        </Campo>
        <Campo etiqueta="Monto sin IGV" htmlFor="os-monto" requerido>
          <div className="flex gap-2">
            <Seleccion id="os-moneda" name="moneda" defaultValue="PEN" aria-label="Moneda" className="w-28">
              <option value="PEN">Soles</option>
              <option value="USD">Dólares</option>
            </Seleccion>
            <Entrada id="os-monto" name="monto" type="number" inputMode="decimal" min={0} step="0.01" required className="min-w-0 flex-1" />
          </div>
        </Campo>
        <Campo etiqueta="Inicio" htmlFor="os-inicio">
          <Entrada id="os-inicio" name="fecha_inicio" type="date" />
        </Campo>
        <Campo etiqueta="Entrega" htmlFor="os-fin">
          <Entrada id="os-fin" name="fecha_fin" type="date" />
        </Campo>
        <Campo etiqueta="Pago" htmlFor="os-pago">
          <Seleccion
            id="os-pago"
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
        <Campo etiqueta="Días de crédito" ayuda="0 para contado" htmlFor="os-dias">
          <Entrada
            id="os-dias"
            name="dias"
            type="number"
            min={condicion === 'CREDITO' ? 1 : 0}
            max={condicion === 'CREDITO' ? 365 : 0}
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
          />
        </Campo>
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando} disabled={!proveedorId}>
          Emitir orden de servicio
        </Boton>
      </div>
    </form>
  )
}

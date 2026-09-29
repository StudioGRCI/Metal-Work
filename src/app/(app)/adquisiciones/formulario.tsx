'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion, AreaTexto } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { registrarAdquisicion, completarAdquisicion } from './acciones'

export function FormularioAdquisicion({ ordenes, compras, documentos }: { ordenes: { id: string; numero: string }[]; compras: { id: string; proveedor: string; referencia: string; condicion_pago: string }[]; documentos: { id: string; nombre_archivo: string }[] }) {
  const [condicion, setCondicion] = useState('CONTADO')
  const { alEnviar, enviando, error, resultado } = useEnvio(registrarAdquisicion)
  return <form onSubmit={alEnviar} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    <Campo etiqueta="Tipo de comprobante" htmlFor="adq-tipo" requerido><Seleccion id="adq-tipo" name="tipo" required>
      <option value="FACTURA_COMPRA">Factura de compra</option><option value="RECIBO_HONORARIOS">Recibo por honorarios</option>
      <option value="FACTURA_VEHICULO">Factura de vehículo</option><option value="FACTURA_TESORERIA">Factura de Tesorería</option>
      <option value="OTRO">Otro comprobante</option>
    </Seleccion></Campo>
    <Campo etiqueta="Proveedor o emisor" htmlFor="adq-proveedor" requerido><Entrada id="adq-proveedor" name="proveedor" minLength={2} maxLength={160} required /></Campo>
    <Campo etiqueta="Número de comprobante" htmlFor="adq-numero" requerido><Entrada id="adq-numero" name="numero_documento" minLength={3} maxLength={80} required /></Campo>
    <Campo etiqueta="OT relacionada" htmlFor="adq-ot"><Seleccion id="adq-ot" name="orden_id" defaultValue=""><option value="">Sin OT específica</option>{ordenes.map(o=><option key={o.id} value={o.id}>{o.numero}</option>)}</Seleccion></Campo>
    <Campo etiqueta="Compra de Logística" htmlFor="adq-compra" ayuda="Si corresponde a una compra de materiales, elige la compra. La condición de pago debe coincidir con la de Logística."><Seleccion id="adq-compra" name="orden_compra_id" defaultValue=""><option value="">Sin compra asociada</option>{compras.map(c=><option key={c.id} value={c.id}>{c.proveedor} · {c.referencia} · {c.condicion_pago}</option>)}</Seleccion></Campo>
    <Campo etiqueta="Moneda" htmlFor="adq-moneda"><Seleccion id="adq-moneda" name="moneda"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
    <Campo etiqueta="Fecha de emisión" htmlFor="adq-emision" requerido><Entrada id="adq-emision" name="fecha_emision" type="date" required /></Campo>
    <Campo etiqueta="Condición de pago" htmlFor="adq-condicion"><Seleccion id="adq-condicion" name="condicion_pago" value={condicion} onChange={e=>setCondicion(e.target.value)}><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></Seleccion></Campo>
    <Campo etiqueta="Vencimiento" htmlFor="adq-vencimiento" requerido ayuda={condicion==='CONTADO'?'Debe ser igual a la emisión.':'Indica la fecha pactada con el proveedor.'}><Entrada id="adq-vencimiento" name="fecha_vencimiento" type="date" required /></Campo>
    <Campo etiqueta="Total" htmlFor="adq-total" requerido><Entrada id="adq-total" name="total" type="number" min="0.01" step="0.01" inputMode="decimal" required /></Campo>
    <Campo etiqueta="Factura ya subida por Logística" htmlFor="adq-documento"><Seleccion id="adq-documento" name="documento_compra_id" defaultValue=""><option value="">Ninguna; subiré un PDF</option>{documentos.map(d=><option key={d.id} value={d.id}>{d.nombre_archivo}</option>)}</Seleccion></Campo>
    <Campo etiqueta="PDF del comprobante" htmlFor="adq-pdf" ayuda="Obligatorio si no eliges una factura de Logística."><Entrada id="adq-pdf" name="pdf" type="file" accept="application/pdf,.pdf" /></Campo>
    <Campo etiqueta="Observación" htmlFor="adq-nota" className="sm:col-span-2 xl:col-span-3"><AreaTexto id="adq-nota" name="observacion" maxLength={1000} /></Campo>
    <div className="sm:col-span-2 xl:col-span-3 space-y-2"><Boton type="submit" cargando={enviando}>Registrar comprobante</Boton>
      {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
      {resultado?.ok && <p role="status" className="text-sm text-exito">{resultado.mensaje}</p>}
    </div>
  </form>
}

export function CompletarAdquisicion({ id }: { id: string }) {
  const { alEnviar, enviando, error, resultado } = useEnvio(completarAdquisicion)
  return <form onSubmit={alEnviar} className="mt-2 flex flex-wrap items-end gap-2">
    <input type="hidden" name="id" value={id} />
    <Campo etiqueta="PDF pendiente" htmlFor={`pdf-${id}`} requerido><Entrada id={`pdf-${id}`} name="pdf" type="file" accept="application/pdf,.pdf" required /></Campo>
    <Boton type="submit" tamano="sm" cargando={enviando}>Completar comprobante</Boton>
    {error && <p role="alert" className="basis-full text-xs text-peligro">{error}</p>}
    {resultado?.ok && <p role="status" className="basis-full text-xs text-exito">{resultado.mensaje}</p>}
  </form>
}

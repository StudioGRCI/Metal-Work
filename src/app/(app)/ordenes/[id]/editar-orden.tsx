'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion, AreaTexto } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import type { obtenerOrden } from '@/lib/datos/ordenes'
import type { cotizacionesParaCambio } from '@/lib/datos/edicion-ot'
import { editarOrdenConHistorial } from './acciones-edicion'

export function EditarOrden({ orden, cotizaciones }: {
  orden: NonNullable<Awaited<ReturnType<typeof obtenerOrden>>>
  cotizaciones: Awaited<ReturnType<typeof cotizacionesParaCambio>>
}) {
  const [abierta, abrir] = useState(false)
  const [nueva, elegir] = useState('')
  const [mensaje, avisar] = useState('')
  const { alEnviar, enviando, error } = useEnvio(editarOrdenConHistorial, r => {
    abrir(false); elegir(''); avisar(r.mensaje ?? 'Cambio guardado.')
  })
  const seleccionada = cotizaciones.find(c => c.id === nueva)
  return <>
    <Boton variante="secundario" tamano="sm" onClick={() => { avisar(''); abrir(true) }}>Editar OT / cambiar cliente</Boton>
    {mensaje && <p role="status" className="py-2 text-sm text-exito">{mensaje}</p>}
    <Ventana abierta={abierta} alCerrar={() => { if (!enviando) abrir(false) }} titulo={`Editar OT ${orden.numero}`}>
      <form onSubmit={alEnviar} className="space-y-4">
        <input type="hidden" name="orden_id" value={orden.id} />
        <input type="hidden" name="version" value={orden.actualizado_en} />
        <input type="hidden" name="unidad_version" value={orden.unidad?.actualizado_en ?? ''} />
        <p className="text-sm text-texto-suave">Se conserva el número de OT. Cada edición registra el motivo, quién la hizo y los valores anteriores.</p>
        <Campo etiqueta="Descripción del trabajo" htmlFor="editar-descripcion" requerido>
          <AreaTexto id="editar-descripcion" name="descripcion" defaultValue={orden.descripcion} required minLength={5} maxLength={5000} />
        </Campo>
        <Campo etiqueta="Prioridad" htmlFor="editar-prioridad">
          <Seleccion id="editar-prioridad" name="prioridad" defaultValue={orden.prioridad}>
            <option value="BAJA">Baja</option><option value="NORMAL">Normal</option>
            <option value="ALTA">Alta</option><option value="URGENTE">Urgente</option>
          </Seleccion>
        </Campo>
        <Campo etiqueta="Fecha de entrega prometida" htmlFor="editar-fecha" requerido>
          <Entrada id="editar-fecha" name="fecha_entrega_comprometida" type="date" required defaultValue={orden.fecha_entrega_comprometida ?? ''} />
        </Campo>
        <Campo etiqueta="Código interno" htmlFor="editar-codigo">
          <Entrada id="editar-codigo" name="codigo_interno" maxLength={40} readOnly={!orden.unidad} defaultValue={orden.unidad?.codigo_interno ?? ''} />
        </Campo>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Datos del chasis</legend>
          <Campo etiqueta="Marca" htmlFor="editar-marca"><Entrada id="editar-marca" name="marca" maxLength={80} readOnly={!orden.unidad} defaultValue={orden.unidad?.marca ?? ''} /></Campo>
          <Campo etiqueta="Modelo" htmlFor="editar-modelo"><Entrada id="editar-modelo" name="modelo" maxLength={80} readOnly={!orden.unidad} defaultValue={orden.unidad?.modelo ?? ''} /></Campo>
        </fieldset>
        <Campo etiqueta="Cambio de cliente por nueva venta" htmlFor="editar-cotizacion" ayuda="Sube y aprueba primero la cotización del nuevo comprador para esta carrocería.">
          <Seleccion id="editar-cotizacion" name="cotizacion_nueva_id" value={nueva} onChange={e => elegir(e.target.value)}>
            <option value="">Conservar el cliente actual</option>
            {cotizaciones.map(c => <option key={c.id} value={c.id}>{c.numero} — {c.cliente?.razon_social ?? 'Cliente'}</option>)}
          </Seleccion>
        </Campo>
        {seleccionada && <label className="flex items-start gap-2 rounded-[var(--radius-base)] bg-aviso-suave p-3 text-sm">
          <input name="confirmar_cambio" type="checkbox" required />
          <span>Confirmo cambiar de {orden.cliente?.razon_social ?? 'cliente actual'} a {seleccionada.cliente?.razon_social}. La cotización anterior quedará en el historial. El sistema no traslada pagos; si hay pagos, liberación de Tesorería o entrega, primero deben resolverse.</span>
        </label>}
        <Campo etiqueta="Motivo del cambio" htmlFor="editar-motivo" requerido>
          <AreaTexto id="editar-motivo" name="motivo" required minLength={5} maxLength={1000} placeholder="Describe la corrección o el incumplimiento que motiva la nueva venta" />
        </Campo>
        {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" disabled={enviando} onClick={() => abrir(false)}>Cancelar</Boton>
          <Boton type="submit" cargando={enviando}>Guardar con historial</Boton>
        </div>
      </form>
    </Ventana>
  </>
}

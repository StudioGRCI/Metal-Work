'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { controlesYSolicitudesDeOrden } from '@/lib/datos/costos-ot'
import { cantidad, fechaHora, moneda } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import { guardarChecklist, solicitarTesoreria } from './acciones-costos'

type Datos = Awaited<ReturnType<typeof controlesYSolicitudesDeOrden>>
type Control = Datos['controles'][number]

const ETIQUETAS: Record<'INGRESO' | 'SALIDA', [string, string, string, string]> = {
  INGRESO: ['Identidad de la unidad', 'Documentación recibida', 'Materiales y accesorios recibidos', 'Estado físico inicial'],
  SALIDA: ['Identidad de la unidad que sale', 'Documentos de entrega', 'Materiales y accesorios entregados', 'Estado físico final'],
}

export function CostosYControles({ ordenId, datos, puedeControlar, puedeSolicitar, ordenCerrada }: {
  ordenId: string
  datos: Datos
  puedeControlar: boolean
  puedeSolicitar: boolean
  ordenCerrada: boolean
}) {
  const salidaCompleta = datos.controles.some(c => c.tipo === 'SALIDA' && c.completado_en)
  return <div className="space-y-5">
    <Tarjeta>
      <TarjetaCabecera titulo="Materiales de la OT" descripcion="Resumen de lo asignado por Diseño a cada plano y área. Las solicitudes al almacén las hace el área que los utilizará." />
      <TarjetaCuerpo>
        {datos.materiales.length === 0 ? <p className="text-sm text-texto-suave">Diseño todavía no ha asignado materiales a esta orden.</p> :
          <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm">
            <thead><tr className="border-b border-borde text-left text-texto-suave"><th className="py-2 pr-3">Plano</th><th className="py-2 pr-3">Material</th><th className="py-2 pr-3">Área</th><th className="py-2 text-right">Cantidad</th></tr></thead>
            <tbody>{datos.materiales.map(m => <tr key={m.id} className="border-b border-borde last:border-0"><td className="py-2 pr-3">{m.numero_plano ?? 'Sin plano'}</td><td className="py-2 pr-3"><span className="font-medium">{m.material}</span><span className="block text-xs text-texto-suave">{m.material_codigo}</span></td><td className="py-2 pr-3">{m.area_destino}</td><td className="py-2 text-right tabular">{cantidad(m.cantidad)} {m.unidad}</td></tr>)}</tbody>
          </table></div>}
      </TarjetaCuerpo>
    </Tarjeta>
    <div className="grid gap-4 lg:grid-cols-2">
      {(['INGRESO', 'SALIDA'] as const).map(tipo => <ListaControl key={tipo} ordenId={ordenId} tipo={tipo}
        control={datos.controles.find(c => c.tipo === tipo) ?? null} editable={puedeControlar && !ordenCerrada} />)}
    </div>
    <Tarjeta>
      <TarjetaCabecera titulo="Solicitudes a Tesorería" descripcion="Costos solicita la atención del pago de materiales o la revisión financiera previa a la salida. Tesorería responde; esta solicitud no equivale a un pago ni a una liberación." />
      <TarjetaCuerpo className="space-y-4">
        {puedeSolicitar && !ordenCerrada && <NuevaSolicitud ordenId={ordenId} salidaCompleta={Boolean(salidaCompleta)} />}
        {datos.solicitudes.length === 0 ? <p className="text-sm text-texto-suave">Todavía no hay solicitudes de esta OT.</p> :
          <ol className="space-y-2">{datos.solicitudes.map(s => <li key={s.id} className="rounded-[var(--radius-base)] border border-borde p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{s.tipo === 'SALIDA_OT' ? 'Revisión para salida' : 'Pago de materiales'}</strong><Insignia tono={s.estado === 'ATENDIDA' ? 'exito' : s.estado === 'OBSERVADA' ? 'peligro' : 'aviso'}>{s.estado}</Insignia></div>
            <p className="mt-1 whitespace-pre-wrap">{s.concepto}</p>
            {s.monto !== null && <p className="mt-1 font-semibold tabular">{moneda(s.monto, s.moneda === 'USD' ? 'USD' : 'PEN')}</p>}
            <p className="mt-1 text-xs text-texto-suave">{fechaHora(s.creado_en)} · {s.solicitante ? `${s.solicitante.nombres} ${s.solicitante.apellidos}` : 'Costos y Materiales'}</p>
            {s.respuesta && <p className="mt-2 rounded-[var(--radius-base)] bg-superficie-2 p-2">Tesorería: {s.respuesta}</p>}
          </li>)}</ol>}
      </TarjetaCuerpo>
    </Tarjeta>
  </div>
}

function ListaControl({ ordenId, tipo, control, editable }: { ordenId: string; tipo: 'INGRESO' | 'SALIDA'; control: Control | null; editable: boolean }) {
  const { alEnviar, enviando, resultado, error } = useEnvio(guardarChecklist)
  const completada = Boolean(control?.completado_en)
  const campos = ['identidad_verificada', 'documentos_verificados', 'materiales_verificados', 'condicion_verificada'] as const
  return <Tarjeta>
    <TarjetaCabecera titulo={`Lista de ${tipo === 'INGRESO' ? 'ingreso' : 'salida'}`} descripcion={completada ? `Completada el ${fechaHora(control?.completado_en ?? '')}` : 'Marca lo comprobado; la lista se completa cuando los cuatro puntos estén verificados.'} />
    <TarjetaCuerpo>
      <form onSubmit={alEnviar} className="space-y-3">
        <input type="hidden" name="orden_id" value={ordenId} /><input type="hidden" name="tipo" value={tipo} />
        {campos.map((campo, i) => <label key={campo} className="flex min-h-11 items-center gap-3 text-sm text-texto"><input className="size-4 accent-acento" type="checkbox" name={campo} defaultChecked={Boolean(control?.[campo])} disabled={!editable || completada || enviando} />{ETIQUETAS[tipo][i]}</label>)}
        <Campo etiqueta="Observaciones" htmlFor={`observacion-${tipo}`} ayuda="Registra faltantes o daños antes de completar.">
          <AreaTexto id={`observacion-${tipo}`} name="observacion" rows={3} maxLength={2000} defaultValue={control?.observacion ?? ''} disabled={!editable || completada || enviando} />
        </Campo>
        {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
        {resultado?.ok && <p role="status" className="text-sm text-exito">{resultado.mensaje}</p>}
        {editable && !completada && <Boton type="submit" tamano="sm" cargando={enviando}>Guardar lista</Boton>}
      </form>
    </TarjetaCuerpo>
  </Tarjeta>
}

function NuevaSolicitud({ ordenId, salidaCompleta }: { ordenId: string; salidaCompleta: boolean }) {
  const [tipo, setTipo] = useState<'MATERIALES' | 'SALIDA_OT'>('MATERIALES')
  const { alEnviar, enviando, resultado, error } = useEnvio(solicitarTesoreria)
  return <form onSubmit={alEnviar} className="grid gap-3 rounded-[var(--radius-base)] border border-borde p-4 sm:grid-cols-2">
    <input type="hidden" name="orden_id" value={ordenId} />
    <Campo etiqueta="Tipo de solicitud" htmlFor="solicitud-tipo" requerido><Seleccion id="solicitud-tipo" name="tipo" value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}><option value="MATERIALES">Pago de materiales</option><option value="SALIDA_OT">Revisión para salida de OT</option></Seleccion></Campo>
    {tipo === 'MATERIALES' && <div className="grid grid-cols-[1fr_7rem] gap-2"><Campo etiqueta="Importe" htmlFor="solicitud-monto" requerido><Entrada id="solicitud-monto" name="monto" type="number" min="0.01" step="0.01" required /></Campo><Campo etiqueta="Moneda" htmlFor="solicitud-moneda" requerido><Seleccion id="solicitud-moneda" name="moneda" defaultValue="PEN"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo></div>}
    {tipo === 'SALIDA_OT' && <><input type="hidden" name="monto" value="" /><input type="hidden" name="moneda" value="" /><p className="self-end text-xs text-texto-suave">{salidaCompleta ? 'Lista de salida completada.' : 'Completa primero la lista de salida.'}</p></>}
    <div className="sm:col-span-2"><Campo etiqueta="Concepto y referencia" htmlFor="solicitud-concepto" requerido ayuda="Indica proveedor, factura o motivo de la revisión."><AreaTexto id="solicitud-concepto" name="concepto" minLength={10} maxLength={1000} required rows={3} /></Campo></div>
    {error && <p role="alert" className="sm:col-span-2 text-sm text-peligro">{error}</p>}
    {resultado?.ok && <p role="status" className="sm:col-span-2 text-sm text-exito">{resultado.mensaje}</p>}
    <div className="sm:col-span-2"><Boton type="submit" tamano="sm" cargando={enviando} disabled={tipo === 'SALIDA_OT' && !salidaCompleta}>Enviar a Tesorería</Boton></div>
  </form>
}

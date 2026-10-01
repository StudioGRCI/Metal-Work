'use client'

import Link from 'next/link'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { solicitudesPendientesTesoreria } from '@/lib/datos/costos-ot'
import { fechaHora, moneda } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import { responderSolicitudTesoreria } from '../ordenes/[id]/acciones-costos'

type Solicitud = Awaited<ReturnType<typeof solicitudesPendientesTesoreria>>[number]

export function SolicitudesOT({ solicitudes }: { solicitudes: Solicitud[] }) {
  return <Tarjeta className="mb-5"><TarjetaCabecera titulo="Solicitudes de Costos y Materiales" descripcion="Responde los pedidos de revisión de salida. Marcar atendida documenta la coordinación; la liberación de salida se registra por separado en la OT." />
    <TarjetaCuerpo className="space-y-3">{solicitudes.length === 0 ? <p className="text-sm text-texto-suave">No hay solicitudes pendientes.</p> : solicitudes.map(s => <SolicitudPendiente key={s.id} solicitud={s} />)}</TarjetaCuerpo>
  </Tarjeta>
}

function SolicitudPendiente({ solicitud: s }: { solicitud: Solicitud }) {
  const { alEnviar, enviando, error, resultado } = useEnvio(responderSolicitudTesoreria)
  return <article className="rounded-[var(--radius-base)] border border-borde p-4">
    <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-texto">{s.tipo === 'MATERIALES' ? 'Pago de materiales' : 'Revisión de salida'} · OT {s.orden?.numero ?? '—'}</p><Link className="text-sm text-acento hover:underline" href={`/ordenes/${s.orden_id}?vista=entrega`}>Abrir OT</Link></div>
    <p className="mt-2 whitespace-pre-wrap text-sm">{s.concepto}</p>
    {s.monto !== null && <p className="mt-1 font-semibold tabular">{moneda(s.monto, s.moneda === 'USD' ? 'USD' : 'PEN')}</p>}
    <p className="mt-1 text-xs text-texto-suave">{fechaHora(s.creado_en)} · {s.solicitante ? `${s.solicitante.nombres} ${s.solicitante.apellidos}` : 'Costos y Materiales'}</p>
    <form onSubmit={alEnviar} className="mt-3 grid gap-3 border-t border-borde pt-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
      <input type="hidden" name="id" value={s.id} /><input type="hidden" name="orden_id" value={s.orden_id} />
      <Campo etiqueta="Resultado" htmlFor={`resultado-${s.id}`}><Seleccion id={`resultado-${s.id}`} name="estado"><option value="ATENDIDA">Atendida</option><option value="OBSERVADA">Observada</option></Seleccion></Campo>
      <Campo etiqueta="Respuesta a Costos" htmlFor={`respuesta-${s.id}`} requerido><AreaTexto id={`respuesta-${s.id}`} name="respuesta" rows={2} minLength={3} maxLength={2000} required placeholder="Indica el comprobante o lo que falta" /></Campo>
      <Boton type="submit" tamano="sm" cargando={enviando}>Responder</Boton>
      {error && <p role="alert" className="sm:col-span-3 text-sm text-peligro">{error}</p>}
      {resultado?.ok && <p role="status" className="sm:col-span-3 text-sm text-exito">{resultado.mensaje}</p>}
    </form>
  </article>
}

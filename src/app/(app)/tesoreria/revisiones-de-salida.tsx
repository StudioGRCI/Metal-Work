'use client'

import Link from 'next/link'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { RevisionPendiente } from '@/lib/datos/vehiculos'
import { useEnvio } from '@/lib/envio'
import { fechaHora } from '@/lib/format'

import { responderRevisionSalida } from '../vehiculos/acciones-ficha'

/**
 * Los vehículos que Requerimientos quiere entregar y esperan la revisión de
 * Tesorería: cada pedido trae el código interno, lo que hay que revisar y el
 * escaneo firmado de la ficha de salida. Reemplaza, para los vehículos, la
 * revisión de salida que se pedía desde la OT (migración 20261016110000).
 */
export function RevisionesDeSalida({ revisiones }: { revisiones: RevisionPendiente[] }) {
  return (
    <Tarjeta className="mb-5" id="salidas-por-revisar">
      <TarjetaCabecera
        titulo="Salidas de vehículos por revisar"
        ayuda="Requerimientos pide tu revisión antes de entregar un vehículo. Si queda revisada, puede salir; si la observas, Requerimientos ve tu respuesta y vuelve a pedirla."
      />
      <TarjetaCuerpo className="space-y-3">
        {revisiones.map((v) => (
          <RevisionPorResponder key={v.id} revision={v} />
        ))}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function RevisionPorResponder({ revision: v }: { revision: RevisionPendiente }) {
  const { alEnviar, enviando, error, resultado } = useEnvio(responderRevisionSalida)
  return (
    <article className="rounded-[var(--radius-base)] border border-borde p-4" data-revision={v.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-texto">
            <span className="tabular">{v.vehiculo}</span>
            {v.codigo_interno && <span className="font-normal text-texto-suave"> · Código {v.codigo_interno}</span>}
          </p>
          <p className="text-xs text-texto-suave">
            {[v.unidad, v.empresa].filter(Boolean).join(' · ')}
            {v.ingreso_en && ` · entró ${fechaHora(v.ingreso_en)}`}
          </p>
        </div>
        <span className="flex flex-wrap gap-3 text-sm">
          {v.escaneo ? (
            <a href={v.escaneo} target="_blank" rel="noreferrer" className="text-acento hover:underline">
              Ver ficha firmada
            </a>
          ) : (
            <span className="text-texto-suave">La ficha firmada no se pudo abrir ahora</span>
          )}
          <Link href={`/vehiculos/${v.registro_id}#revision-salida`} className="text-acento hover:underline">
            Abrir el vehículo
          </Link>
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-texto">{v.concepto}</p>
      <p className="mt-1 text-xs text-texto-suave">
        {fechaHora(v.creado_en)} · {v.solicitante ?? 'Requerimientos'}
      </p>
      <form onSubmit={alEnviar} className="mt-3 grid gap-3 border-t border-borde pt-3 sm:grid-cols-[15rem_1fr_auto] sm:items-end">
        <input type="hidden" name="id" value={v.id} />
        <Campo etiqueta="Resultado" htmlFor={`salida-estado-${v.id}`}>
          <Seleccion id={`salida-estado-${v.id}`} name="estado" defaultValue="ATENDIDA">
            <option value="ATENDIDA">Revisada: puede salir</option>
            <option value="OBSERVADA">Observada</option>
          </Seleccion>
        </Campo>
        <Campo etiqueta="Respuesta a Requerimientos" htmlFor={`salida-respuesta-${v.id}`} requerido>
          <AreaTexto
            id={`salida-respuesta-${v.id}`}
            name="respuesta"
            rows={2}
            minLength={3}
            maxLength={2000}
            required
            placeholder="Indica el comprobante o lo que falta"
          />
        </Campo>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Responder
        </Boton>
        {error && (
          <p role="alert" className="text-sm text-peligro sm:col-span-3">
            {error}
          </p>
        )}
        {resultado?.ok && (
          <p role="status" className="text-sm text-exito sm:col-span-3">
            {resultado.mensaje}
          </p>
        )}
      </form>
    </article>
  )
}

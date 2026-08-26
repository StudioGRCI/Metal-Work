'use client'

import { Plus } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import type { ReclamoGarantia } from '@/lib/datos/garantias'
import { fecha } from '@/lib/format'
import { cn } from '@/lib/utils'

import { moverReclamo, registrarReclamo } from './acciones'

const ESTADO_RECLAMO = {
  RECIBIDO: { etiqueta: 'Recibido', tono: 'aviso' },
  EN_EVALUACION: { etiqueta: 'En evaluación', tono: 'aviso' },
  PROCEDE: { etiqueta: 'Procede', tono: 'exito' },
  NO_PROCEDE: { etiqueta: 'No procede', tono: 'neutro' },
  ATENDIDO: { etiqueta: 'Atendido', tono: 'exito' },
} as const

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado?.mensaje && resultado?.ok !== false) return null
  const malo = resultado.ok === false
  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-3 py-2 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}

/** Registrar un reclamo sobre una entrega con garantía. */
export function NuevoReclamo({ entregaId, unidad }: { entregaId: string; unidad: string }) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(registrarReclamo, null)

  if (!abierto) {
    return (
      <Boton variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>
        <Plus aria-hidden className="size-3.5" />
        Reclamo
      </Boton>
    )
  }

  return (
    <form action={accion} className="w-full space-y-2 rounded-[var(--radius-base)] bg-superficie-2 p-3">
      <input type="hidden" name="entrega_id" value={entregaId} />
      <p className="text-xs font-medium text-texto">Reclamo sobre {unidad}</p>
      <Campo etiqueta="Qué reclama" htmlFor={`descripcion-${entregaId}`} requerido>
        <AreaTexto
          id={`descripcion-${entregaId}`}
          name="descripcion"
          rows={2}
          required
          placeholder="La compuerta posterior no cierra al ras…"
        />
      </Campo>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo etiqueta="Quién reporta" htmlFor={`reportado-${entregaId}`}>
          <Entrada id={`reportado-${entregaId}`} name="reportado_por" placeholder="Nombre del chofer o contacto" />
        </Campo>
        <Campo etiqueta="Teléfono o correo" htmlFor={`contacto-${entregaId}`}>
          <Entrada id={`contacto-${entregaId}`} name="contacto" />
        </Campo>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Aviso resultado={resultado} />
        <div className="flex gap-2">
          <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierto(false)}>
            {resultado?.ok ? 'Cerrar' : 'Cancelar'}
          </Boton>
          <Boton type="submit" tamano="sm" cargando={enviando}>
            Registrar
          </Boton>
        </div>
      </div>
    </form>
  )
}

/** Un reclamo con su historia y sus movimientos posibles. */
export function TarjetaReclamo({ reclamo, puedeGestionar }: { reclamo: ReclamoGarantia; puedeGestionar: boolean }) {
  const [resultado, accion, enviando] = useActionState(moverReclamo, null)
  const estado = ESTADO_RECLAMO[reclamo.estado]
  const abierto = !['NO_PROCEDE', 'ATENDIDO'].includes(reclamo.estado)
  const orden = reclamo.entrega?.orden

  return (
    <div className="rounded-[var(--radius-base)] border border-borde p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-texto">
          {reclamo.numero}
          {orden && (
            <span className="ml-2 font-normal text-texto-suave">
              {orden.unidad?.placa ?? orden.numero} · {orden.cliente.razon_social}
            </span>
          )}
        </p>
        <span className="flex items-center gap-2">
          {!reclamo.dentro_de_garantia && <Insignia tono="peligro">Fuera de plazo</Insignia>}
          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
        </span>
      </div>

      <p className="mt-1 text-sm text-texto">{reclamo.descripcion}</p>
      <p className="mt-0.5 text-xs text-texto-suave">
        {fecha(reclamo.fecha_reclamo)}
        {reclamo.reportado_por && ` · reporta ${reclamo.reportado_por}`}
        {reclamo.contacto && ` (${reclamo.contacto})`}
      </p>

      {reclamo.evaluacion && (
        <p className="mt-2 rounded-[var(--radius-base)] bg-superficie-2 px-2 py-1.5 text-xs text-texto-suave">
          <strong className="font-medium text-texto">Evaluación:</strong> {reclamo.evaluacion}
          {reclamo.atendido && (
            <span className="block text-texto-tenue">
              {reclamo.atendido.nombres} {reclamo.atendido.apellidos}
              {reclamo.atendido_en ? ` · ${fecha(reclamo.atendido_en)}` : ''}
            </span>
          )}
        </p>
      )}

      {puedeGestionar && abierto && (
        <form action={accion} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={reclamo.id} />
          <Campo etiqueta="Mover a" htmlFor={`estado-${reclamo.id}`} className="w-44">
            <Seleccion id={`estado-${reclamo.id}`} name="estado" required defaultValue="">
              <option value="" disabled>
                Elegir…
              </option>
              {reclamo.estado === 'RECIBIDO' && <option value="EN_EVALUACION">En evaluación</option>}
              <option value="PROCEDE">Procede</option>
              <option value="NO_PROCEDE">No procede</option>
              <option value="ATENDIDO">Atendido</option>
            </Seleccion>
          </Campo>
          <Campo
            etiqueta="Evaluación"
            htmlFor={`evaluacion-${reclamo.id}`}
            ayuda="Obligatoria para cerrar"
            className="min-w-64 flex-1"
          >
            <Entrada
              id={`evaluacion-${reclamo.id}`}
              name="evaluacion"
              defaultValue={reclamo.evaluacion ?? ''}
              placeholder="Qué se encontró y qué se decide"
            />
          </Campo>
          <Boton type="submit" tamano="sm" cargando={enviando}>
            Guardar
          </Boton>
          <div className="w-full">
            <Aviso resultado={resultado} />
          </div>
        </form>
      )}
    </div>
  )
}

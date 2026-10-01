'use client'

import { CheckCircle2, MessageSquareWarning, Plus } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import type { Observacion } from '@/lib/datos/observaciones'
import { useEnvio } from '@/lib/envio'
import { fechaHora } from '@/lib/format'

import { levantarObservacion, resolverObservacion } from './acciones-observaciones'

export type ObservacionEnPantalla = Observacion & {
  /** Si quien mira puede resolverla, decidido en el servidor. */
  resoluble: boolean
}

function Falla({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * Los errores que alguien encontró en la orden (migración 106). Cada uno va a
 * un área, le avisa a esa área y al jefe de producción, y queda abierto hasta
 * que se resuelve diciendo qué se hizo.
 *
 * Desde el 2026-10-01 no es una tarjeta propia: va dentro de la tarjeta de la
 * orden, junto a su PDF, que es de lo que habla («si encuentras un error en la
 * orden…»). Las abiertas quedan a la vista; las resueltas, plegadas, porque ya
 * son historia y empujaban hacia abajo lo que sí falta.
 */
export function Observaciones({
  ordenId,
  observaciones,
  areas,
  puedeAnotar,
  preseleccion = null,
}: {
  ordenId: string
  observaciones: ObservacionEnPantalla[]
  areas: { id: string; codigo?: string; nombre: string }[]
  puedeAnotar: boolean
  /**
   * Con qué llega quien viene de una pieza o una actividad («Observar»): el
   * área ya elegida y el texto encabezado. El formulario se abre solo.
   */
  preseleccion?: { areaCodigo: string; texto: string } | null
}) {
  const [anotando, setAnotando] = useState(Boolean(preseleccion && puedeAnotar))
  const abiertas = observaciones.filter((o) => o.abierta)
  const resueltas = observaciones.filter((o) => !o.abierta)
  const areaPreseleccionada = preseleccion ? (areas.find((a) => a.codigo === preseleccion.areaCodigo)?.id ?? '') : ''

  return (
    <section id="observaciones" aria-labelledby="observaciones-titulo" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="observaciones-titulo" className="flex items-center gap-2 text-sm font-semibold text-texto">
          Observaciones
          {abiertas.length > 0 && (
            <Insignia tono="aviso">
              {abiertas.length} {abiertas.length === 1 ? 'abierta' : 'abiertas'}
            </Insignia>
          )}
        </h3>
        {puedeAnotar && !anotando && (
          <Boton variante="secundario" tamano="sm" onClick={() => setAnotando(true)}>
            <Plus aria-hidden className="size-3.5" />
            Anotar observación
          </Boton>
        )}
      </div>

      {anotando && (
        <NuevaObservacion
          ordenId={ordenId}
          areas={areas}
          areaInicial={areaPreseleccionada}
          textoInicial={preseleccion?.texto ?? ''}
          alCerrar={() => setAnotando(false)}
        />
      )}

      {abiertas.length === 0 && !anotando && (
        <p className="flex items-start gap-2 text-sm text-texto-suave">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-exito" />
          <span>
            <span className="font-medium text-texto">
              {resueltas.length > 0 ? 'Sin observaciones abiertas.' : 'Sin observaciones.'}
            </span>{' '}
            {puedeAnotar && 'Si encuentras un error en la orden, anótalo y se le avisa al área.'}
          </span>
        </p>
      )}

      {abiertas.length > 0 && (
        <ul className="space-y-3">
          {abiertas.map((o) => (
            <li key={o.id}>
              <ItemObservacion ordenId={ordenId} observacion={o} />
            </li>
          ))}
        </ul>
      )}

      {resueltas.length > 0 && (
        <details className="group rounded-[var(--radius-base)] border border-borde">
          <summary className="cursor-pointer px-3 py-2 text-sm text-texto-suave hover:text-texto">
            {resueltas.length === 1 ? 'Ver la observación resuelta' : `Ver las ${resueltas.length} observaciones resueltas`}
          </summary>
          <ul className="space-y-3 border-t border-borde p-3">
            {resueltas.map((o) => (
              <li key={o.id}>
                <ItemObservacion ordenId={ordenId} observacion={o} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function NuevaObservacion({
  ordenId,
  areas,
  areaInicial = '',
  textoInicial = '',
  alCerrar,
}: {
  ordenId: string
  areas: { id: string; nombre: string }[]
  areaInicial?: string
  textoInicial?: string
  alCerrar: () => void
}) {
  const { alEnviar, enviando, error } = useEnvio(levantarObservacion, alCerrar)

  return (
    <form onSubmit={alEnviar} className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
      <input type="hidden" name="orden_id" value={ordenId} />
      <Campo etiqueta="Para qué área" htmlFor="obs-area" requerido>
        <Seleccion id="obs-area" name="area_id" required defaultValue={areaInicial}>
          <option value="" disabled>
            Elige el área que tiene que corregir
          </option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Qué está mal" htmlFor="obs-texto" requerido>
        <AreaTexto
          id="obs-texto"
          name="descripcion"
          rows={3}
          required
          minLength={3}
          maxLength={2000}
          defaultValue={textoInicial}
          autoFocus={Boolean(textoInicial)}
          placeholder="El plano 3 del lateral viene con la cota de 2.40 y la unidad pide 2.60…"
        />
      </Campo>
      <Falla texto={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Anotar y avisar
        </Boton>
      </div>
    </form>
  )
}

function ItemObservacion({ ordenId, observacion: o }: { ordenId: string; observacion: ObservacionEnPantalla }) {
  const [resolviendo, setResolviendo] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(resolverObservacion, () => setResolviendo(false))

  return (
    <div
      className={
        o.abierta
          ? 'space-y-2 rounded-[var(--radius-base)] border border-aviso/40 bg-aviso-suave/40 p-3'
          : 'space-y-2 rounded-[var(--radius-base)] border border-borde p-3'
      }
    >
      {/* Quién y cuándo, en su propia línea: junto al PDF la columna es
          angosta y, en la misma línea, el «·» quedaba suelto al empezar. */}
      <div>
        <p className="flex flex-wrap items-center gap-2">
          <Insignia tono={o.abierta ? 'aviso' : 'exito'}>{o.abierta ? 'Abierta' : 'Resuelta'}</Insignia>
          <span className="text-sm font-medium text-texto">Para {o.area}</span>
        </p>
        <p className="mt-1 text-[11px] text-texto-tenue">
          {o.registrado_por_nombre ?? 'Alguien del taller'} · {fechaHora(o.creado_en)}
        </p>
      </div>

      <p className="flex items-start gap-1.5 text-sm whitespace-pre-wrap text-texto">
        <MessageSquareWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-aviso" />
        <span>{o.descripcion}</span>
      </p>

      {!o.abierta && o.resolucion && (
        <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-exito-suave px-2.5 py-1.5 text-xs text-exito">
          <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium">
              Resuelta por {o.resuelta_por_nombre ?? 'el taller'}
              {o.resuelta_en ? ` el ${fechaHora(o.resuelta_en)}` : ''}:
            </span>{' '}
            {o.resolucion}
          </span>
        </p>
      )}

      {o.resoluble &&
        (resolviendo ? (
          <form onSubmit={alEnviar} className="space-y-2">
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="orden_id" value={ordenId} />
            <AreaTexto
              name="resolucion"
              rows={2}
              required
              minLength={3}
              maxLength={1000}
              autoFocus
              aria-label="Qué se hizo para resolverla"
              placeholder="Qué se hizo: se corrigió el plano, se volvió a cortar la pieza…"
            />
            <Falla texto={error} />
            <div className="flex flex-wrap gap-2">
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Marcar resuelta
              </Boton>
              <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setResolviendo(false)}>
                Cancelar
              </Boton>
            </div>
          </form>
        ) : (
          <Boton
            type="button"
            tamano="sm"
            variante="contorno"
            onClick={() => {
              limpiar()
              setResolviendo(true)
            }}
          >
            <CheckCircle2 aria-hidden className="size-3.5" />
            Resolver
          </Boton>
        ))}
    </div>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, ShieldAlert } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_ETAPA, ORDEN_ESTADO_ETAPA, definir, opciones } from '@/lib/dominio/estados'
import { cantidad, fecha } from '@/lib/format'
import type { Vistas } from '@/types/database'

import { actualizarEtapa } from '../acciones'

type Etapa = Vistas<'ot_tablero_etapas'> & { observaciones: string | null }

const ESTADOS = opciones(ESTADO_ETAPA, ORDEN_ESTADO_ETAPA)

export function Etapas({
  ordenId,
  etapas,
  puedeRegistrar,
}: {
  ordenId: string
  etapas: Etapa[]
  puedeRegistrar: boolean
}) {
  const [editando, setEditando] = useState<string | null>(null)

  if (etapas.length === 0) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="py-10 text-center text-sm text-texto-suave">
            Esta orden todavía no tiene etapas. Se generan automáticamente al aprobarla.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Etapas de producción"
        descripcion="El avance de cada etapa alimenta el avance total de la orden, ponderado por sus horas."
      />
      <TarjetaCuerpo className="space-y-2 p-2">
        {etapas.map((etapa) => {
          const estado = definir(ESTADO_ETAPA, etapa.estado)
          const abierta = editando === etapa.etapa_id
          const bloqueada = Boolean(etapa.requiere_inspeccion) && !etapa.inspeccion_conforme

          return (
            <div
              key={etapa.etapa_id}
              className="rounded-[var(--radius-base)] border border-borde p-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="tabular w-6 shrink-0 text-xs text-texto-tenue">
                  {etapa.orden_secuencia}
                </span>

                <div className="min-w-40 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-texto">
                    {etapa.etapa}
                    {etapa.requiere_inspeccion &&
                      /* `role="img"`: sin él la etiqueta del <svg> no se
                         anuncia, y aquí el icono no adorna —dice si la etapa
                         puede darse por terminada o no—. */
                      (etapa.inspeccion_conforme ? (
                        <CheckCircle2 role="img" aria-label="Inspección conforme" className="size-3.5 text-exito" />
                      ) : (
                        <ShieldAlert role="img" aria-label="Requiere inspección de calidad" className="size-3.5 text-aviso" />
                      ))}
                  </p>
                  <p className="text-[11px] text-texto-suave">
                    {cantidad(etapa.horas_reales)} de {cantidad(etapa.horas_estimadas)} h
                    {(etapa.operarios_asignados ?? 0) > 0 &&
                      ` · ${etapa.operarios_asignados} operarios`}
                    {etapa.fecha_fin_real && ` · terminada el ${fecha(etapa.fecha_fin_real)}`}
                  </p>
                </div>

                {/* La barra ocupa la línea entera en el teléfono, donde si no
                    se queda apretada entre el nombre y la insignia; en el
                    monitor vuelve a sus 160 px de siempre. */}
                <div className="w-full sm:w-40">
                  <Progreso valor={etapa.avance_porcentaje} mostrarValor alto="sm" />
                </div>

                <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>

                {puedeRegistrar && (
                  <Boton
                    variante="fantasma"
                    tamano="sm"
                    onClick={() => setEditando(abierta ? null : etapa.etapa_id!)}
                    aria-expanded={abierta}
                  >
                    {abierta ? 'Cerrar' : 'Registrar'}
                  </Boton>
                )}
              </div>

              {abierta && (
                <FormularioEtapa
                  ordenId={ordenId}
                  etapa={etapa}
                  bloqueada={bloqueada}
                  alTerminar={() => setEditando(null)}
                />
              )}
            </div>
          )
        })}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function FormularioEtapa({
  ordenId,
  etapa,
  bloqueada,
  alTerminar,
}: {
  ordenId: string
  etapa: Etapa
  bloqueada: boolean
  alTerminar: () => void
}) {
  const router = useRouter()
  const [pendiente, iniciarTransicion] = useTransition()
  const [avance, setAvance] = useState(Number(etapa.avance_porcentaje ?? 0))
  const [error, setError] = useState<string | null>(null)

  // Manejador propio en lugar de useActionState: así el formulario se cierra
  // únicamente cuando el guardado fue correcto.
  async function enviar(datos: FormData) {
    setError(null)
    const resultado = await actualizarEtapa(null, datos)

    if (resultado.ok) {
      alTerminar()
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  return (
    <form action={enviar} className="mt-3 grid gap-3 border-t border-borde pt-3 sm:grid-cols-3">
      <input type="hidden" name="etapa_id" value={etapa.etapa_id ?? ''} />
      <input type="hidden" name="orden_id" value={ordenId} />

      <Campo etiqueta="Avance" htmlFor={`avance-${etapa.etapa_id}`}>
        <div className="flex items-center gap-2">
          <input
            id={`avance-${etapa.etapa_id}`}
            name="avance_porcentaje"
            type="range"
            min={0}
            max={100}
            step={5}
            value={avance}
            onChange={(e) => setAvance(Number(e.target.value))}
            // El riel mide 4 px; el blanco para agarrarlo, 44 en el teléfono.
            // En el monitor vuelve al alto natural del control.
            className="h-11 w-full accent-[var(--acento)] sm:h-auto"
          />
          <Entrada
            aria-label="Avance en porcentaje"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={avance}
            onChange={(e) => setAvance(Number(e.target.value))}
            className="tabular w-16 text-right"
          />
        </div>
      </Campo>

      <Campo
        etiqueta="Estado"
        htmlFor={`estado-${etapa.etapa_id}`}
        ayuda={bloqueada ? 'Requiere inspección de calidad conforme para poder terminarse' : undefined}
      >
        <Seleccion
          id={`estado-${etapa.etapa_id}`}
          name="estado"
          defaultValue={etapa.estado ?? 'PENDIENTE'}
        >
          {ESTADOS.map((o) => (
            <option key={o.valor} value={o.valor} disabled={o.valor === 'TERMINADA' && bloqueada}>
              {o.etiqueta}
            </option>
          ))}
        </Seleccion>
      </Campo>

      <Campo etiqueta="Observaciones" htmlFor={`obs-${etapa.etapa_id}`}>
        <AreaTexto
          id={`obs-${etapa.etapa_id}`}
          name="observaciones"
          rows={2}
          defaultValue={etapa.observaciones ?? ''}
          placeholder="Novedades del trabajo en esta etapa"
        />
      </Campo>

      {error && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro sm:col-span-3">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 sm:col-span-3">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="sm" cargando={pendiente}>
          Guardar avance
        </Boton>
      </div>
    </form>
  )
}

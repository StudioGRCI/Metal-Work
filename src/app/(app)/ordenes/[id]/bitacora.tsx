'use client'

import { useActionState, useEffect, useRef } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_EVENTO_BITACORA, definir } from '@/lib/dominio/estados'
import { fechaHora, tiempoRelativo } from '@/lib/format'

import { comentarOrden } from '../acciones'

type Evento = {
  id: string
  tipo_evento: string
  descripcion: string
  creado_en: string
  usuario: unknown
}

export function Bitacora({
  ordenId,
  eventos,
  puedeComentar,
}: {
  ordenId: string
  eventos: Evento[]
  puedeComentar: boolean
}) {
  const [resultado, ejecutar, pendiente] = useActionState(comentarOrden, null)
  const formulario = useRef<HTMLFormElement>(null)

  // Vaciar el cuadro de texto una vez que el comentario se guardó.
  useEffect(() => {
    if (resultado?.ok) formulario.current?.reset()
  }, [resultado])

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Trazabilidad"
        descripcion="Todo lo que ha ocurrido con esta orden, en orden cronológico inverso. Es un registro inmutable."
      />

      {puedeComentar && (
        <div className="border-b border-borde p-4">
          <form ref={formulario} action={ejecutar} className="space-y-2">
            <input type="hidden" name="orden_id" value={ordenId} />
            <AreaTexto
              name="descripcion"
              rows={2}
              required
              placeholder="Anota una novedad, acuerdo con el cliente o incidencia del taller"
              aria-label="Nuevo comentario"
            />
            {resultado && !resultado.ok && (
              <p role="alert" className="text-xs text-peligro">
                {resultado.error}
              </p>
            )}
            <div className="flex justify-end">
              <Boton type="submit" tamano="sm" cargando={pendiente}>
                Registrar comentario
              </Boton>
            </div>
          </form>
        </div>
      )}

      <TarjetaCuerpo>
        {eventos.length === 0 ? (
          <p className="py-8 text-center text-sm text-texto-suave">Sin eventos registrados.</p>
        ) : (
          <ol className="space-y-0">
            {eventos.map((evento, i) => {
              const tipo = definir(TIPO_EVENTO_BITACORA, evento.tipo_evento)
              const usuario = evento.usuario as { nombres: string; apellidos: string } | null
              const ultimo = i === eventos.length - 1

              return (
                <li key={evento.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {!ultimo && (
                    <span aria-hidden className="absolute top-5 bottom-0 left-[5px] w-px bg-borde" />
                  )}
                  <span
                    aria-hidden
                    className="mt-1.5 size-2.5 shrink-0 rounded-full bg-acento ring-4 ring-[var(--superficie)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia>
                      <time
                        dateTime={evento.creado_en}
                        title={fechaHora(evento.creado_en)}
                        className="text-[11px] text-texto-tenue"
                      >
                        {tiempoRelativo(evento.creado_en)}
                      </time>
                      {usuario && (
                        <span className="text-[11px] text-texto-tenue">
                          · {usuario.nombres} {usuario.apellidos}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-texto">{evento.descripcion}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

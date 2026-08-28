'use client'

import { useActionState, useEffect, useRef } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { fechaHora, tiempoRelativo } from '@/lib/format'
import type { EventoTimeline } from '@/lib/datos/documentos'
import type { Tono } from '@/components/ui/etiqueta-estado'

import { comentarOrden } from '../acciones'

/** Color de cada categoría de la línea de tiempo. */
const CATEGORIAS: Record<string, { etiqueta: string; tono: Tono }> = {
  BITACORA: { etiqueta: 'Bitácora', tono: 'acento' },
  DOCUMENTO: { etiqueta: 'Documento', tono: 'info' },
  MATERIAL: { etiqueta: 'Material', tono: 'neutro' },
  ALMACEN: { etiqueta: 'Almacén', tono: 'neutro' },
  INSPECCION: { etiqueta: 'Inspección', tono: 'aviso' },
  CALIDAD: { etiqueta: 'Calidad', tono: 'aviso' },
  AUDITORIA: { etiqueta: 'Cambio', tono: 'neutro' },
  ENTREGA: { etiqueta: 'Entrega', tono: 'exito' },
}

function definirCategoria(valor: string) {
  return (
    CATEGORIAS[valor] ?? {
      etiqueta: valor.replaceAll('_', ' ').toLowerCase(),
      tono: 'neutro' as Tono,
    }
  )
}

export function Bitacora({
  ordenId,
  eventos,
  puedeComentar,
}: {
  ordenId: string
  eventos: EventoTimeline[]
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
        descripcion="Todo lo ocurrido con esta orden: cambios de estado, documentos, material, inspecciones y comentarios. Es un registro inmutable."
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
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-texto">Todavía no ha pasado nada con esta orden</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-texto-suave">
              {puedeComentar
                ? 'Se irá llenando sola con cada cambio de estado, documento y salida de material. Si hay algo que contar antes, anótalo arriba.'
                : 'Se irá llenando sola con cada cambio de estado, documento y salida de material.'}
            </p>
          </div>
        ) : (
          <ol className="space-y-0">
            {eventos.map((evento, i) => {
              const tipo = definirCategoria(evento.categoria)
              const ultimo = i === eventos.length - 1

              return (
                <li key={evento.clave} className="relative flex gap-3 pb-4 last:pb-0">
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
                        dateTime={evento.ocurrido_en}
                        title={fechaHora(evento.ocurrido_en)}
                        className="text-[11px] text-texto-tenue"
                      >
                        {tiempoRelativo(evento.ocurrido_en)}
                      </time>
                      {evento.usuario && (
                        <span className="text-[11px] text-texto-tenue">· {evento.usuario}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-texto">{evento.titulo}</p>
                    {evento.detalle && evento.detalle !== evento.titulo && (
                      <p className="mt-0.5 text-xs text-texto-suave">{evento.detalle}</p>
                    )}
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

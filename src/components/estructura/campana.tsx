'use client'

import { Bell, Check, X } from 'lucide-react'
import Link from 'next/link'
import { useState, useRef } from 'react'

import { useAvisos } from './use-avisos'
import type { Notificacion } from '@/lib/datos/notificaciones'
import { fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Los avisos del circuito, en la barra de arriba.
 *
 * La cotización pasa por tres manos y hasta ahora ninguna se enteraba de que le
 * había llegado: había que acordarse de entrar a mirar la bandeja. Los avisos
 * los deja la base en cada cambio de estado; acá solo se muestran.
 *
 * No se abre solo ni suena: es una lista que está cuando se la busca. Un aviso
 * que interrumpe se aprende a cerrar sin leer.
 */
export function Campana({ avisos, sinLeer }: { avisos: Notificacion[]; sinLeer: number }) {
  const [abierta, setAbierta] = useState(false)
  const boton = useRef<HTMLButtonElement>(null)
  const cerrar = () => { setAbierta(false); boton.current?.focus() }
  const { abrir, marcarTodos, marcando, error } = useAvisos(cerrar)
  const sinLeerAhora = sinLeer

  return (
    <div className="relative" onKeyDown={e => { if (e.key === 'Escape') cerrar() }}>
      <button
        type="button"
        ref={boton}
        onClick={() => setAbierta((v) => !v)}
        aria-label={sinLeerAhora > 0 ? `Avisos, ${sinLeerAhora} sin leer` : 'Avisos'}
        aria-expanded={abierta}
        aria-controls={abierta ? 'panel-avisos' : undefined}
        className={cn('relative flex size-11 items-center justify-center rounded-full border border-borde transition-colors focus-visible:outline-2 focus-visible:outline-acento', abierta ? 'bg-acento text-acento-texto' : 'bg-superficie text-texto-suave hover:bg-superficie-2')}
      >
        <Bell aria-hidden className="size-5" />
        {sinLeerAhora > 0 && (
          // El número va sobre el icono y no al lado: en el teléfono no hay
          // sitio, y lo que importa es que se vea que hay algo.
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-peligro px-1 text-[10px] leading-4 font-semibold text-peligro-texto">
            {sinLeerAhora > 9 ? '9+' : sinLeerAhora}
          </span>
        )}
      </button>

      {abierta && (
        <>
          {/* Se cierra al tocar fuera. Acá sí —a diferencia de las ventanas de
              formulario— porque no hay nada escrito que perder. */}
          <button
            type="button"
            aria-label="Cerrar los avisos"
            onClick={() => setAbierta(false)}
            className="fixed inset-0 z-40 cursor-default"
          />

          <section id="panel-avisos" aria-label="Notificaciones" aria-busy={marcando} className="fixed inset-x-3 z-50 mt-2 max-h-[70dvh] overflow-y-auto rounded-2xl border border-borde bg-superficie shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:w-96">
            <div className="flex items-center justify-between border-b border-borde px-3 py-2">
              <span className="text-sm font-semibold text-texto">Notificaciones</span>
              {sinLeerAhora > 0 && (
                <button
                  type="button"
                  disabled={marcando}
                  onClick={marcarTodos}
                  className="inline-flex min-h-11 items-center gap-1 px-2 text-xs text-acento hover:underline disabled:opacity-60 sm:min-h-0"
                >
                  <Check aria-hidden className="size-3.5" />
                  {marcando ? 'Marcando…' : 'Marcar todos leídos'}
                </button>
              )}
              <button type="button" onClick={cerrar} aria-label="Cerrar notificaciones" className="flex size-11 shrink-0 items-center justify-center rounded-full text-texto-suave hover:bg-superficie-2"><X aria-hidden className="size-4" /></button>
            </div>
            {error && <p role="alert" className="m-3 rounded-xl bg-peligro-suave p-3 text-sm text-peligro">{error}</p>}

            {avisos.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-texto-suave">
                No hay avisos. Acá llega lo que te toca mover.
              </p>
            ) : (
              <ul>
                {avisos.map((a) => {
                  const leido = Boolean(a.leida_en)
                  const contenido = (
                    <>
                      <p className={cn('text-xs', leido ? 'text-texto-suave' : 'font-semibold text-texto')}>
                        {a.titulo}
                      </p>
                      {a.cuerpo && (
                        <p className="mt-0.5 text-[11px] leading-snug text-texto-suave">{a.cuerpo}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-texto-tenue">{fechaHora(a.creado_en)}</p>
                    </>
                  )

                  return (
                    <li key={a.id} className="border-b border-borde last:border-0">
                        <button
                          type="button"
                          disabled={marcando}
                          onClick={() => abrir(a)}
                          className={cn(
                            'block w-full px-4 py-3 text-left hover:bg-superficie-2 disabled:opacity-60',
                            !leido && 'bg-acento-suave/40',
                          )}
                        >
                          {contenido}
                        </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Los veinte últimos se caen de acá; en /avisos están todos. */}
            <Link
              href="/avisos"
              onClick={() => setAbierta(false)}
              className="flex min-h-11 items-center justify-center border-t border-borde text-xs text-acento hover:bg-superficie-2 sm:min-h-9"
            >
              Ver todos los avisos
            </Link>
          </section>
        </>
      )}
    </div>
  )
}

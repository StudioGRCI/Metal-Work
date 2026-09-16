'use client'

import { Bell, Check } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { marcarAvisoLeido, marcarTodosLeidos } from '@/app/(app)/acciones-avisos'
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
  const [marcando, iniciarTransicion] = useTransition()
  // Lo que ya se tocó se pinta leído al instante; el refresco lo confirma.
  const [leidos, setLeidos] = useState<Set<string> | 'todos'>(new Set())
  const router = useRouter()

  const estaLeido = (a: Notificacion) => Boolean(a.leida_en) || leidos === 'todos' || leidos.has(a.id)
  const sinLeerAhora = leidos === 'todos' ? 0 : Math.max(0, sinLeer - leidos.size)

  function alTocar(aviso: Notificacion) {
    setAbierta(false)
    if (!aviso.leida_en) {
      setLeidos((s) => (s === 'todos' ? s : new Set(s).add(aviso.id)))
      iniciarTransicion(async () => {
        await marcarAvisoLeido(aviso.id)
        router.refresh()
      })
    }
  }

  /**
   * A dónde lleva el aviso: su ruta y, si nombra una fila, el ancla para
   * aterrizar en ella y no arriba de la lista. La ruta viene de la base sin
   * filtro a propósito: el aviso se lee horas después y el estado ya se movió.
   */
  const destino = (a: Notificacion) =>
    a.ruta && a.origen_id && !a.ruta.includes('#') ? `${a.ruta}#${a.origen_id}` : (a.ruta ?? '')

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-label={sinLeerAhora > 0 ? `Avisos, ${sinLeerAhora} sin leer` : 'Avisos'}
        aria-expanded={abierta}
        className="relative flex size-11 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 hover:text-texto sm:size-9"
      >
        <Bell aria-hidden className="size-4" />
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

          <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[var(--radius-base)] border border-borde bg-superficie shadow-xl">
            <div className="flex items-center justify-between border-b border-borde px-3 py-2">
              <span className="text-xs font-semibold text-texto">Avisos</span>
              {sinLeerAhora > 0 && (
                <button
                  type="button"
                  disabled={marcando}
                  onClick={() => {
                    setLeidos('todos')
                    iniciarTransicion(async () => {
                      await marcarTodosLeidos()
                      router.refresh()
                    })
                  }}
                  className="inline-flex min-h-11 items-center gap-1 px-2 text-xs text-acento hover:underline disabled:opacity-60 sm:min-h-0"
                >
                  <Check aria-hidden className="size-3.5" />
                  {marcando ? 'Marcando…' : 'Marcar todos leídos'}
                </button>
              )}
            </div>

            {avisos.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-texto-suave">
                No hay avisos. Acá llega lo que te toca mover.
              </p>
            ) : (
              <ul>
                {avisos.map((a) => {
                  const leido = estaLeido(a)
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
                      {a.ruta ? (
                        <Link
                          href={destino(a)}
                          onClick={() => alTocar(a)}
                          className={cn(
                            'block px-3 py-2 hover:bg-superficie-2',
                            !leido && 'bg-acento-suave/40',
                          )}
                        >
                          {contenido}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => alTocar(a)}
                          className={cn(
                            'block w-full px-3 py-2 text-left hover:bg-superficie-2',
                            !leido && 'bg-acento-suave/40',
                          )}
                        >
                          {contenido}
                        </button>
                      )}
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
          </div>
        </>
      )}
    </div>
  )
}

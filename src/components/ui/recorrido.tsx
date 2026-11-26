import { Check, ChevronDown, Route } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { haceDias, type PasoDescrito } from '@/lib/dominio/recorrido'
import { fecha, fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * El recorrido de un documento numerado, plegado dentro de su tarjeta: los pasos
 * del circuito en orden, quién hizo cada uno y cuándo, quién lo tiene ahora y
 * hace cuántos días, y lo que falta (migración 20261125130000).
 *
 * Cerrado ya dice lo que más se pregunta: quién lo tiene y hace cuánto. Los
 * días los cuenta la base por fecha de Lima; aquí no se calcula nada. Todavía
 * no hay colores por demora: solo el número.
 *
 * `pasos` llega en palabras desde `src/lib/dominio/recorrido.ts`. `null` es «no
 * se pudo leer» y se dice; vacío es que no hay nada que mostrar.
 *
 * `className` pone el borde según dónde va: a todo el ancho de la tarjeta
 * (`border-t border-borde`) o como caja dentro de su cuerpo
 * (`rounded-[var(--radius-base)] border border-borde`). `relleno`, el margen
 * lateral de esa tarjeta. `femenino`, para el documento que lo es: «la tiene
 * Gerencia» de la cotización, «lo tiene Almacén» del requerimiento.
 * `sinQuienEnElResumen`, donde la fila ya dice quién lo tiene y hace cuánto
 * (la insignia de días de Atención de requerimiento): cerrado dice solo
 * «Recorrido», para no repetirlo a 80 px; abierto, igual que siempre.
 */
export function Recorrido({
  pasos,
  className,
  relleno = 'px-4',
  femenino = false,
  sinQuienEnElResumen = false,
}: {
  pasos: readonly PasoDescrito[] | null | undefined
  className?: string
  relleno?: string
  femenino?: boolean
  sinQuienEnElResumen?: boolean
}) {
  const lo = femenino ? 'la' : 'lo'
  if (pasos === null) {
    return (
      <p role="status" className={cn('py-2 text-xs text-aviso', relleno, className)} data-recorrido="sin-leer">
        No se pudo leer el recorrido. Recarga la página; si continúa, avisa al administrador.
      </p>
    )
  }
  if (!pasos || pasos.length === 0) return null

  const ahora = pasos.find((p) => p.situacion === 'AHORA')
  const hechos = pasos.filter((p) => p.situacion === 'HECHO')
  const ultimo = hechos.at(-1)

  return (
    <details className={cn('group/recorrido overflow-hidden', className)} data-recorrido>
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-superficie-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden',
          relleno,
        )}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-texto">
          <ChevronDown aria-hidden className="size-4 shrink-0 text-texto-suave transition-transform group-open/recorrido:rotate-180" />
          <Route aria-hidden className="size-4 shrink-0 text-texto-suave" />
          Recorrido
        </span>
        {/* Lo que más se pregunta, sin abrir: quién lo tiene y hace cuánto; si ya nadie, en qué terminó. */}
        {ahora ? (
          !sinQuienEnElResumen && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-texto-suave" data-recorrido-ahora>
            <span className="min-w-0 break-words">
              {femenino ? 'La' : 'Lo'} tiene <span className="font-medium text-texto">{ahora.puesto ?? 'alguien'}</span>
            </span>
            {ahora.dias !== null && <Insignia>{haceDias(ahora.dias)}</Insignia>}
          </span>
          )
        ) : (
          ultimo && (
            <span className="min-w-0 text-xs break-words text-texto-suave">
              {ultimo.titulo} · {fecha(ultimo.en)}
            </span>
          )
        )}
      </summary>

      <ol className={cn('border-t border-borde pt-3 pb-3', relleno)}>
        {pasos.map((p, i) => (
          <li key={p.orden} className="relative flex gap-3 pb-3 last:pb-0" data-recorrido-paso={p.paso} data-situacion={p.situacion}>
            {/* La línea que une este paso con el siguiente. */}
            {i < pasos.length - 1 && <span aria-hidden className="absolute top-5 bottom-0 left-[9px] w-px bg-borde" />}
            <Marca situacion={p.situacion} />
            <div className="min-w-0 flex-1">
              {p.situacion === 'HECHO' && (
                <>
                  <p className="text-sm font-medium break-words text-texto">{p.titulo}</p>
                  <p className="text-xs break-words text-texto-suave">
                    {p.puesto || 'Sin cuenta registrada'}
                  </p>
                  <p className="tabular text-xs text-texto-tenue">{fechaHora(p.en)}</p>
                  {p.nota && <p className="text-xs break-words text-texto-suave">{p.nota}</p>}
                </>
              )}
              {p.situacion === 'AHORA' && (
                <>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-texto">
                    <span className="min-w-0 break-words">Ahora {lo} tiene {p.puesto ?? 'alguien'}</span>
                    {p.dias !== null && <Insignia>{haceDias(p.dias)}</Insignia>}
                  </p>
                  {/* Qué se espera de quien lo tiene; si la base no lo dice, el paso. */}
                  <p className="text-xs break-words text-texto-suave">{p.nota ?? p.titulo}</p>
                  {p.en && <p className="tabular text-xs text-texto-tenue">Desde el {fechaHora(p.en)}</p>}
                </>
              )}
              {p.situacion === 'PENDIENTE' && (
                <p className="text-sm break-words text-texto-tenue">
                  <span className="sr-only">Falta: </span>
                  {p.titulo}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  )
}

/** El punto de cada paso: hecho, el que espera ahora, o el que todavía no toca. */
function Marca({ situacion }: { situacion: PasoDescrito['situacion'] }) {
  if (situacion === 'HECHO') {
    return (
      <span aria-hidden className="relative z-[1] mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full bg-exito-suave text-exito">
        <Check className="size-3" strokeWidth={3} />
      </span>
    )
  }
  if (situacion === 'AHORA') {
    return (
      <span aria-hidden className="relative z-[1] mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full border-2 border-acento bg-superficie">
        <span className="size-2 rounded-full bg-acento" />
      </span>
    )
  }
  return <span aria-hidden className="relative z-[1] mt-0.5 size-[19px] shrink-0 rounded-full border-2 border-borde bg-superficie" />
}

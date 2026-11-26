import { CircleDashed } from 'lucide-react'

import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import type { LoQueFalta, QuienLoTiene } from '@/lib/dominio/lo-que-falta'
import { cn } from '@/lib/utils'

/**
 * Qué le falta a la fila y de quién (plan 11.2), en un renglón por cosa:
 * «Falta la aprobación de la OC-0012-MW · Lo tiene Gerencia · hace 3 días». Lo que le
 * toca a quien mira dice «Te toca»; lo que espera a otra área, a quién, con
 * los días de la base cuando se saben (`DiasEnEspera`, plan 0.2).
 *
 * `mias` son las áreas de quien mira: Tesorería para quien paga, Gerencia
 * para quien aprueba. Sin nada que falte no se pinta.
 */
export function LoQueFaltaDeLaFila({ falta, mias = [], className }: { falta: readonly LoQueFalta[]; mias?: readonly QuienLoTiene[]; className?: string }) {
  if (falta.length === 0) return null
  return (
    <ul className={cn('space-y-1', className)} data-lo-que-falta>
      {falta.map((f) => {
        const mia = mias.includes(f.quien)
        return (
          // El ícono en su propia columna: en el teléfono, el texto que pasa de renglón no se mete debajo de él.
          <li key={`${f.quien}-${f.que}`} className="grid grid-cols-[auto_1fr] items-start gap-x-2 text-xs" data-falta-de={f.quien} data-traba={f.traba || undefined}>
            <CircleDashed aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', f.traba ? 'text-aviso' : 'text-texto-suave')} />
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-texto">
                <span className="font-medium">Falta</span> {f.que}
              </span>
              <Insignia tono={mia ? 'aviso' : 'neutro'}>{mia ? 'Te toca' : `Lo tiene ${f.quien}`}</Insignia>
              {/* Los días que lleva esperando, contados por la base con la fecha de Lima. Quién lo tiene ya
                  lo dice la insignia de al lado: el lector no lo oye dos veces. */}
              {f.dias != null && <DiasEnEspera dias={f.dias} desde={f.desde} quien={null} />}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

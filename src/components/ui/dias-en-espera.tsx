import { Clock } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { haceDias } from '@/lib/dominio/recorrido'
import { fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Cuánto lleva esperando una fila de una bandeja: «hoy», «hace 1 día», «hace 3
 * días» (migración 20261125140000). Los días los cuenta la base con la fecha de
 * Lima; aquí no se calcula nada. Todavía sin colores por demora: solo el número.
 *
 * `quien` es quién lo tiene, si la pantalla lo sabe («Almacén»): va en lo que se
 * lee y en la nota al pasar el puntero, con la hora desde la que espera. Sin
 * días no se pinta nada: que no se haya podido contar no se dice como «hoy».
 */
export function DiasEnEspera({
  dias,
  desde,
  quien,
  className,
}: {
  dias: number | null | undefined
  desde: string | null | undefined
  quien?: string | null
  className?: string
}) {
  if (dias == null) return null
  const nota = [quien ? `Lo tiene ${quien}` : 'Espera', desde ? `desde el ${fechaHora(desde)}` : null].filter(Boolean).join(' ')
  return (
    <Insignia className={cn('tabular', className)} title={nota} data-dias-en-espera={dias} data-desde={desde ?? undefined}>
      <Clock aria-hidden className="size-3" />
      <span className="sr-only">{quien ? `Lo tiene ${quien} ` : 'Espera '}</span>
      {haceDias(dias)}
    </Insignia>
  )
}

import { Clock } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { haceDias } from '@/lib/dominio/recorrido'
import { fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Cuánto lleva esperando una fila de una bandeja: «desde hoy», «hace 1 día», «hace 3
 * días» (migración 20261125140000). Los días los cuenta la base con la fecha de
 * Lima; aquí no se calcula nada. Todavía sin colores por demora: solo el número.
 *
 * `quien` es quién lo tiene, si la pantalla lo sabe («Almacén»): va en lo que se
 * lee y en la nota al pasar el puntero, con la hora desde la que espera. Con
 * `verQuien` también se ve («Gerencia · hace 5 días»): en una bandeja donde no
 * todo lo tiene quien mira, el número solo se leía como su propia demora. Sin
 * días no se pinta nada: que no se haya podido contar no se dice como «desde hoy».
 */
export function DiasEnEspera({
  dias,
  desde,
  quien,
  verQuien = false,
  className,
}: {
  dias: number | null | undefined
  desde: string | null | undefined
  quien?: string | null
  verQuien?: boolean
  className?: string
}) {
  if (dias == null) return null
  const nota = [quien ? `Lo tiene ${quien}` : 'Espera', desde ? `desde el ${fechaHora(desde)}` : null].filter(Boolean).join(' ')
  // Lo que se ve, corto; lo que oye el lector, una frase entera.
  const visible = verQuien && quien ? `${quien} · ${haceDias(dias)}` : haceDias(dias)
  const lector = `${quien ? `Lo tiene ${quien}` : 'Espera'} ${dias <= 0 ? haceDias(dias) : `desde ${haceDias(dias)}`}`
  return (
    <Insignia className={cn('tabular', className)} title={nota} data-dias-en-espera={dias} data-desde={desde ?? undefined}>
      <Clock aria-hidden className="size-3" />
      <span aria-hidden>{visible}</span>
      <span className="sr-only">{lector}</span>
    </Insignia>
  )
}

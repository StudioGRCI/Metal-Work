import * as React from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cn } from '@/lib/utils'

export type TonoIndicador = 'neutro' | 'acento' | 'aviso' | 'peligro' | 'exito'

/* El tono pinta el número y su icono, nunca el fondo de la tarjeta: en el
   tablero hay cinco seguidas y cinco fondos de color se leen como una alarma
   permanente. Cada clase se escribe entera porque Tailwind no ve las que se
   arman concatenando. */
const TONOS: Record<TonoIndicador, { valor: string; icono: string }> = {
  neutro: { valor: 'text-texto', icono: 'text-texto-suave' },
  acento: { valor: 'text-acento', icono: 'text-acento' },
  aviso: { valor: 'text-aviso', icono: 'text-aviso' },
  peligro: { valor: 'text-peligro', icono: 'text-peligro' },
  exito: { valor: 'text-exito', icono: 'text-exito' },
}

export interface IndicadorProps {
  /** Rótulo corto de lo que se está contando. */
  titulo: string
  /**
   * La cifra. Acepta nodo, no solo texto, para los casos que ya existen: una
   * barra de `Progreso`, o un número con su unidad en menor tamaño.
   * El formateo es del que llama —`moneda()`, `cantidad()`, `fecha()`—;
   * este componente nunca formatea, para no repetir la zona horaria de Lima.
   */
  valor: React.ReactNode
  /** Icono de lucide, decorativo: la información la lleva el título. */
  icono?: LucideIcon
  tono?: TonoIndicador
  /** Una línea de contexto: «de 12 abiertas», «3 más que ayer». */
  pie?: React.ReactNode
  /** Si se pasa, toda la tarjeta es un enlace a la lista ya filtrada. */
  href?: string
  className?: string
}

/**
 * La tarjeta de un número con su rótulo, la misma en el tablero, en avance,
 * en costos, en servicios, en informes, en producción y en la orden.
 *
 * Tamaños: la clase base es la del teléfono —el taller lo mira de pie y a
 * veces con guante— y `sm:` devuelve el tamaño de escritorio de siempre.
 */
export function Indicador({
  titulo,
  valor,
  icono: Icono,
  tono = 'neutro',
  pie,
  href,
  className,
}: IndicadorProps) {
  const color = TONOS[tono]

  const cuerpo = (
    <TarjetaCuerpo>
      {/* En minúsculas y no en versalitas: en mayúsculas espaciadas, en la
          media columna del teléfono «REQUERIMIENTOS ABIERTOS» se partía en tres
          renglones y empujaba la cifra hacia abajo, cada tarjeta a otra altura. */}
      {/* En el teléfono el rótulo reserva dos renglones: así la cifra cae a la
          misma altura en las dos tarjetas de la fila aunque solo uno parta.
          La tarjeta que va sola a todo lo ancho lo suelta con la clase
          `rotulo-indicador` (ver el Dashboard): ahí cabe en uno y sobraba. */}
      <p className="rotulo-indicador flex min-h-[2.75em] items-start gap-1.5 text-[13px] leading-snug font-medium text-texto-suave sm:min-h-0 sm:text-xs">
        {Icono && <Icono aria-hidden className={cn('mt-px size-4 shrink-0 sm:size-3.5', color.icono)} />}
        {titulo}
      </p>
      {/* Va en <div> y no en <p>: `valor` puede traer una barra de progreso, y
          un <div> dentro de un <p> el navegador lo saca de sitio al analizarlo
          y React lo denuncia como error de hidratación. */}
      {/* La cifra es lo que se viene a mirar: en el monitor salía apenas más
          grande que su rótulo. `text-xl` y no más, para que un monto de siete
          cifras entre en la quinta parte de la fila. */}
      <div className={cn('tabular mt-1.5 text-2xl leading-tight font-semibold sm:text-xl', color.valor)}>
        {valor}
      </div>
      {pie && <p className="mt-0.5 text-xs text-texto-tenue">{pie}</p>}
    </TarjetaCuerpo>
  )

  /* Con href es un enlace de verdad —no una tarjeta con onClick—: se abre en
     otra pestaña, se navega con teclado y el foco lo pinta la regla global de
     globals.css. `h-full` mantiene parejas las tarjetas de una misma fila
     cuando solo algunas llevan pie. */
  if (href) {
    return (
      <Link href={href} className={cn('group block rounded-[var(--radius-base)]', className)}>
        <Tarjeta className="h-full transition-colors group-hover:border-borde-fuerte group-hover:bg-superficie-2">
          {cuerpo}
        </Tarjeta>
      </Link>
    )
  }

  return <Tarjeta className={cn('h-full', className)}>{cuerpo}</Tarjeta>
}

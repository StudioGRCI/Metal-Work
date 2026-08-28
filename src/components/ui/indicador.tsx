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
  /** Rótulo corto de lo que se está contando. Se muestra en versalitas. */
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
      <p className="flex items-center gap-1.5 text-xs leading-tight font-medium tracking-wide text-texto-suave uppercase sm:text-[11px]">
        {Icono && <Icono aria-hidden className={cn('size-4 shrink-0 sm:size-3.5', color.icono)} />}
        {titulo}
      </p>
      {/* Va en <div> y no en <p>: `valor` puede traer una barra de progreso, y
          un <div> dentro de un <p> el navegador lo saca de sitio al analizarlo
          y React lo denuncia como error de hidratación. */}
      <div className={cn('tabular mt-1 text-2xl leading-tight font-semibold sm:text-lg', color.valor)}>
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

'use client'

import { RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Boton } from '@/components/ui/boton'
import { yaEntroSinVentana } from '@/lib/acciones'

/**
 * El «ya quedó registrado la primera vez» de un envío sin ventana (pagar o
 * reservar las horas extras, la llegada y el despacho del tablero), en el
 * recuadro azul de `PieDeVentana`, con el cursor y en lugar del botón que envía.
 *
 * Existe porque esos avisos iban en gris junto al botón, y la pantalla se ponía
 * al día sola: la fila se iba con el aviso a medio leer (la decisión de
 * «Reservar» parecía guardada y era «Pagar»), o quedaba con lo cambiado
 * editable y otra clave, y pulsar otra vez registraba un segundo despacho. La
 * pantalla se pone al día cuando la persona lo pide con «Ver cómo quedó»
 * (20261023200000).
 */
export function AvisoYaQuedo({ error, alVer, className }: { error: string; alVer: () => void; className?: string }) {
  const aviso = useRef<HTMLParagraphElement>(null)
  useEffect(() => aviso.current?.focus(), [error])
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <p ref={aviso} role="alert" tabIndex={-1} data-ya-entro className="rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-sm text-texto">
        {yaEntroSinVentana(error, 'toca «Ver cómo quedó» para poner la pantalla al día')}
      </p>
      <Boton type="button" variante="contorno" tamano="sm" onClick={alVer}>
        <RefreshCw aria-hidden className="size-4" />
        Ver cómo quedó
      </Boton>
    </div>
  )
}

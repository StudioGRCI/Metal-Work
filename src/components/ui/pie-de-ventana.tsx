'use client'

import { useRef, type ReactNode } from 'react'

import { Boton } from '@/components/ui/boton'
import { useCursorAlRechazo } from '@/lib/envio'

/**
 * El pie de una ventana con formulario: el aviso del rechazo, «Cancelar» y el
 * botón que envía. Tras un rechazo el cursor va al aviso; sin esto caía a la
 * página y Tab salía de la ventana. Antes, el pie entero a la vista: en el
 * teléfono, enfocar solo el aviso dejaba el botón debajo del borde de la hoja
 * (a 390, «Registrar el pago» mostraba 4 de sus 44 px). Nació en la caja diaria;
 * la undécima pasada lo pidió en Cuentas por pagar, la OS y la guía.
 */
export function PieDeVentana({
  error,
  enviando,
  alCancelar,
  texto,
  variante,
  disabled,
  idError,
  enLugarDelError,
  children,
}: {
  error: string | null
  enviando: boolean
  alCancelar: () => void
  /** El botón que envía. Sin texto no hay: los botones de `children` hacen otra cosa. */
  texto?: string
  variante?: 'primario' | 'peligro'
  disabled?: boolean
  /** Para el `aria-describedby` de los campos que el aviso explica. */
  idError?: string
  /** Lo que se dice en lugar del aviso, y recibe el cursor, cuando la ventana se corrigió con lo que dijo la base. */
  enLugarDelError?: ReactNode
  /** Botones que van entre «Cancelar» y el que envía. */
  children?: ReactNode
}) {
  const aviso = useRef<HTMLParagraphElement>(null)
  const corregida = useRef<HTMLDivElement>(null)
  const pie = useRef<HTMLDivElement>(null)
  useCursorAlRechazo(enviando, error, () => {
    pie.current?.scrollIntoView({ block: 'nearest' })
    return enLugarDelError ? corregida.current : aviso.current
  })
  return (
    <div ref={pie} className="space-y-4">
      {enLugarDelError ? (
        <div ref={corregida} tabIndex={-1}>
          {enLugarDelError}
        </div>
      ) : (
        error && (
          <p ref={aviso} id={idError} role="alert" tabIndex={-1} className="text-sm text-peligro">
            {error}
          </p>
        )
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alCancelar}>
          Cancelar
        </Boton>
        {children}
        {texto && (
          <Boton type="submit" variante={variante} cargando={enviando} disabled={disabled}>
            {texto}
          </Boton>
        )}
      </div>
    </div>
  )
}

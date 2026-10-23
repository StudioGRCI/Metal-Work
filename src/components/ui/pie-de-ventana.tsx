'use client'

import { useEffect, useRef, type ReactNode } from 'react'

import { Boton } from '@/components/ui/boton'
import { yaEntroEnLaVentana, yaEntroLaPrimeraVez } from '@/lib/acciones'
import { useCursorAlRechazo } from '@/lib/envio'

/**
 * El pie de una ventana con formulario: el aviso del rechazo, «Cancelar» y el
 * botón que envía. Tras un rechazo el cursor va al aviso; sin esto caía a la
 * página y Tab salía de la ventana. Antes, el pie entero a la vista: en el
 * teléfono, enfocar solo el aviso dejaba el botón debajo del borde de la hoja
 * (a 390, «Registrar el pago» mostraba 4 de sus 44 px). Nació en la caja diaria;
 * la undécima pasada lo pidió en Cuentas por pagar, la OS y la guía.
 *
 * Si la base dice que el envío ya entró la primera vez, no es un rechazo: el
 * aviso va sin rojo y la ventana solo se cierra. Volver a enviar con el mismo
 * id no registra nada, y en rojo y con el botón activo parecía que faltaba
 * algo: se cancelaba y se pagaba otra vez desde la tarjeta (duodécima pasada).
 * Los campos quedan trabados: lo cambiado seguía editable junto al aviso, el
 * archivo invitaba a cambiarlo y la cámara del vehículo subía otra foto
 * (decimocuarta pasada). Como el reporte diario, que lo hace con su `fieldset`.
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
  nota,
  cargando,
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
  /** Una línea a la izquierda de los botones («Todavía no cambiaste nada.»). */
  nota?: ReactNode
  /** El botón que envía, ocupado también por algo que no es el envío (un PDF que se lee). */
  cargando?: boolean
  /** Botones que van entre «Cancelar» y el que envía. */
  children?: ReactNode
}) {
  const aviso = useRef<HTMLParagraphElement>(null)
  const corregida = useRef<HTMLDivElement>(null)
  const pie = useRef<HTMLDivElement>(null)
  const yaEntro = yaEntroLaPrimeraVez(error)
  // Se traba lo que haya en el formulario mientras dure el aviso, también lo
  // que React vuelve a encender después: los campos con `disabled={enviando}`
  // estaban apagados al llegar el aviso, se saltaban y quedaban editables, y un
  // campo que la pantalla al día vuelve a montar salía activo (decimoquinta
  // pasada). Al soltarse se enciende solo lo que se apagó aquí. La ayuda de un
  // campo («Qué es…») no se traba: leerla no cambia nada.
  useEffect(() => {
    const formulario = pie.current?.closest('form')
    if (!yaEntro || !formulario) return
    const trabados = new Set<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>()
    const trabar = () => {
      for (const c of formulario.elements) {
        if (!(c instanceof HTMLInputElement || c instanceof HTMLSelectElement || c instanceof HTMLTextAreaElement || c instanceof HTMLButtonElement)) continue
        if (c.disabled || pie.current?.contains(c) || c.hasAttribute('data-ayuda')) continue
        c.disabled = true
        trabados.add(c)
      }
    }
    trabar()
    const vigia = new MutationObserver(trabar)
    vigia.observe(formulario, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] })
    return () => {
      vigia.disconnect()
      for (const c of trabados) c.disabled = false
    }
  }, [yaEntro])
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
          <p
            ref={aviso}
            id={idError}
            role="alert"
            tabIndex={-1}
            data-ya-entro={yaEntro || undefined}
            className={yaEntro ? 'rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-sm text-texto' : 'text-sm text-peligro'}
          >
            {yaEntro ? yaEntroEnLaVentana(error) : error}
          </p>
        )
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {nota && !yaEntro && <p className="mr-auto text-xs text-texto-suave">{nota}</p>}
        <Boton type="button" variante="contorno" onClick={alCancelar}>
          {yaEntro ? 'Cerrar' : 'Cancelar'}
        </Boton>
        {!yaEntro && children}
        {texto && !yaEntro && (
          <Boton type="submit" variante={variante} cargando={enviando || cargando} disabled={disabled}>
            {texto}
          </Boton>
        )}
      </div>
    </div>
  )
}

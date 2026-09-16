'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useEffect, useRef } from 'react'

/**
 * Lo que hace que la pantalla se sienta viva sin websockets: cuando la persona
 * vuelve a la pestaña —o a la ventana, en el monitor de oficina— después de un
 * rato, y cada minuto mientras la mira, se comprueba si le llegaron avisos y,
 * si cambió el número, se repinta todo con `router.refresh()`: la campana, los
 * contadores del Tablero, «Te toca» y las listas a la vez.
 *
 * Nunca refresca mientras hay una `Ventana` abierta o un campo con foco: el
 * supervisor escribe reportes largos con guante y un repintado a mitad de
 * frase mueve lo que está escribiendo. Sin fila que perder, refrescar es
 * gratis; con ella, se espera.
 */
const RATO_FUERA_MS = 30_000
const CADA_MS = 60_000

function alguienEscribe() {
  if (document.querySelector('[role="dialog"]')) return true
  const activo = document.activeElement
  if (!activo) return false
  const etiqueta = activo.tagName
  return etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT' || activo.hasAttribute('contenteditable')
}

export function RefrescoAlVolver({
  sinLeer,
  contar,
}: {
  /** Los avisos sin leer con los que se pintó la pantalla. */
  sinLeer: number
  /** La acción de servidor que cuenta los avisos sin leer de esta cuenta. */
  contar: () => Promise<number>
}) {
  const router = useRouter()
  const conocido = useRef(sinLeer)
  const fueraDesde = useRef<number | null>(null)

  useEffect(() => {
    conocido.current = sinLeer
  }, [sinLeer])

  useEffect(() => {
    const refrescar = () => {
      if (alguienEscribe()) return
      startTransition(() => router.refresh())
    }

    const alVolver = () => {
      const desde = fueraDesde.current
      fueraDesde.current = null
      if (desde !== null && Date.now() - desde >= RATO_FUERA_MS) refrescar()
    }
    const alIrse = () => {
      if (fueraDesde.current === null) fueraDesde.current = Date.now()
    }

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') alIrse()
      else alVolver()
    }

    // Cada minuto, con la pestaña a la vista, se pregunta solo por el número:
    // es una cuenta de cabecera, y solo cuando cambia se repinta.
    const sondeo = setInterval(async () => {
      if (document.visibilityState !== 'visible' || alguienEscribe()) return
      try {
        const n = await contar()
        if (n !== conocido.current) {
          conocido.current = n
          refrescar()
        }
      } catch {
        // Sin red no hay nada que refrescar; se vuelve a intentar al minuto.
      }
    }, CADA_MS)

    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('blur', alIrse)
    window.addEventListener('focus', alVolver)
    return () => {
      clearInterval(sondeo)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('blur', alIrse)
      window.removeEventListener('focus', alVolver)
    }
  }, [router, contar])

  return null
}

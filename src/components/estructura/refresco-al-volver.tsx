'use client'

import { RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { esDeLaVersionAnterior, laPestanaEsDeLaVersionAnterior, laPestanaEsDeOtraCuenta, usePestanaDeLaVersionAnterior } from '@/lib/envio'

/**
 * Lo que hace que la pantalla se sienta viva sin websockets: cuando la persona
 * vuelve a la pestaña —o a la ventana, en el monitor de oficina— después de un
 * rato, y cada minuto mientras la mira, se comprueba si le llegaron avisos y,
 * si cambió el número, se repinta todo con `router.refresh()`: la campana, los
 * contadores del menú, las cifras del Dashboard y las listas a la vez.
 *
 * Nunca refresca mientras hay una `Ventana` abierta o un campo con foco: el
 * supervisor escribe reportes largos con guante y un repintado a mitad de
 * frase mueve lo que está escribiendo. Sin fila que perder, refrescar es
 * gratis; con ella, se espera.
 *
 * Tampoco mientras la pestaña es de otra cuenta (`laPestanaEsDeOtraCuenta`): el
 * repintado traería la pantalla de la cuenta que entró en la otra pestaña y se
 * llevaba la traba y lo escrito sin que nadie recargara.
 *
 * Ni en una pestaña de antes del último despliegue: ahí `router.refresh()` no
 * repinta, recarga el documento entero (Next ve otra compilación), y se llevaba
 * lo escrito y dejaba suelta la foto ya subida del reporte diario (crítica de
 * la vigesimonovena pasada). Al volver se pregunta primero por los avisos: si
 * esa acción ya no existe, la pestaña es vieja, no se repinta y se dice arriba.
 */
const RATO_FUERA_MS = 30_000
const CADA_MS = 60_000

function alguienEscribe() {
  if (laPestanaEsDeOtraCuenta() || laPestanaEsDeLaVersionAnterior()) return true
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
  const vieja = usePestanaDeLaVersionAnterior()

  useEffect(() => {
    conocido.current = sinLeer
  }, [sinLeer])

  useEffect(() => {
    const refrescar = () => {
      if (alguienEscribe()) return
      startTransition(() => router.refresh())
    }

    const alVolver = async () => {
      const desde = fueraDesde.current
      fueraDesde.current = null
      if (desde === null || Date.now() - desde < RATO_FUERA_MS || laPestanaEsDeLaVersionAnterior()) return
      try {
        conocido.current = await contar()
      } catch (e) {
        // La pestaña es vieja: queda anotado y no se repinta. Sin red, se repinta
        // igual, como antes.
        if (esDeLaVersionAnterior(e)) return
      }
      refrescar()
    }
    const alIrse = () => {
      if (fueraDesde.current === null) fueraDesde.current = Date.now()
    }

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') alIrse()
      else void alVolver()
    }
    const alEnfocar = () => void alVolver()

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
      } catch (e) {
        // Sin red no hay nada que refrescar; se vuelve a intentar al minuto. Si
        // la acción ya no existe, la pestaña queda anotada como vieja.
        esDeLaVersionAnterior(e)
      }
    }, CADA_MS)

    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('blur', alIrse)
    window.addEventListener('focus', alEnfocar)
    return () => {
      clearInterval(sondeo)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('blur', alIrse)
      window.removeEventListener('focus', alEnfocar)
    }
  }, [router, contar])

  return vieja ? <AvisoDePestanaVieja /> : null
}

/**
 * Arriba de toda pantalla, solo en la pestaña vieja. La región nace vacía y el
 * texto llega en la pintada siguiente: la que nace con su texto el lector no la
 * lee. Y no está montada en las demás: una fija en toda pantalla quedaba delante
 * de la región de estado de cada una («Requerimiento registrado…»), como la que
 * `TrabaDeOtraCuenta` dejó de tener (trigésima pasada).
 */
function AvisoDePestanaVieja() {
  const [conTexto, setConTexto] = useState(false)
  useEffect(() => {
    const cuadro = requestAnimationFrame(() => setConTexto(true))
    return () => cancelAnimationFrame(cuadro)
  }, [])
  return (
    <div role="status" className="print:hidden" data-region-pestana-vieja>
      {conTexto && (
        <div className="flex items-center gap-3 border-b border-borde bg-aviso-suave px-4 py-2.5" data-pestana-vieja>
          <p className="min-w-0 flex-1 text-xs text-texto">
            El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde aquí no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.
          </p>
          <Boton tamano="sm" variante="secundario" onClick={() => window.location.reload()}>
            <RotateCw aria-hidden className="size-3.5" />
            Volver a cargar
          </Boton>
        </div>
      )}
    </div>
  )
}

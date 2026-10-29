'use client'

import { RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import {
  anotarQueHuboUnDespliegue,
  esDeLaVersionAnterior,
  laPestanaEsDeOtraCuenta,
  laPestanaEsDeOtroDespliegue,
  useVersionDeLaPestana,
  volverACargar,
  type VersionDeLaPestana,
} from '@/lib/envio'

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
 * Ni después de un despliegue: ahí `router.refresh()` no repinta, recarga el
 * documento entero (Next ve otra compilación), y se llevaba lo escrito y dejaba
 * suelta la foto ya subida del reporte diario. La pregunta por los avisos trae
 * también de qué despliegue es el servidor: si no es el de la pantalla, no se
 * repinta y se dice arriba. Antes solo se miraba si la acción seguía existiendo,
 * y en el despliegue de todos los días sigue (trigésima pasada).
 *
 * Ni sin respuesta a esa pregunta: sin red, Next pide la pantalla entera al
 * navegador, sale la página sin conexión y se lleva lo escrito (trigésima).
 */
const RATO_FUERA_MS = 30_000
const CADA_MS = 60_000

function alguienEscribe() {
  if (laPestanaEsDeOtraCuenta() || laPestanaEsDeOtroDespliegue()) return true
  if (document.querySelector('[role="dialog"]')) return true
  const activo = document.activeElement
  if (!activo) return false
  const etiqueta = activo.tagName
  return etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT' || activo.hasAttribute('contenteditable')
}

type Cuenta = { sinLeer: number; compilacion: string | null }

export function RefrescoAlVolver({
  sinLeer,
  compilacion,
  contar,
}: {
  /** Los avisos sin leer con los que se pintó la pantalla. */
  sinLeer: number
  /** De qué despliegue es el servidor que pintó la pantalla (`compilacionDelServidor`). */
  compilacion: string | null
  /** La acción de servidor que cuenta los avisos sin leer de esta cuenta. */
  contar: () => Promise<Cuenta>
}) {
  const router = useRouter()
  const conocido = useRef(sinLeer)
  const fueraDesde = useRef<number | null>(null)
  // La del primer pintado: un repintado de otra compilación Next no lo aplica
  // (recarga el documento), así que la pestaña no cambia de despliegue.
  const [deLaPestana] = useState(compilacion)
  const version = useVersionDeLaPestana()

  useEffect(() => {
    conocido.current = sinLeer
  }, [sinLeer])

  useEffect(() => {
    const refrescar = () => {
      if (alguienEscribe()) return
      startTransition(() => router.refresh())
    }

    /** Los avisos sin leer, o `null` si no se debe repintar. */
    const preguntar = async () => {
      let cuenta: Cuenta
      try {
        cuenta = await contar()
      } catch (e) {
        // Sin red, nada. Si la acción ya no existe, la pestaña queda anotada
        // como vieja y lo dice el aviso de arriba.
        esDeLaVersionAnterior(e, { sinAvisoPropio: true })
        return null
      }
      if (deLaPestana && cuenta.compilacion && cuenta.compilacion !== deLaPestana) {
        anotarQueHuboUnDespliegue()
        return null
      }
      return cuenta.sinLeer
    }

    const alVolver = async () => {
      const desde = fueraDesde.current
      fueraDesde.current = null
      if (desde === null || Date.now() - desde < RATO_FUERA_MS || laPestanaEsDeOtroDespliegue()) return
      const n = await preguntar()
      if (n === null) return
      conocido.current = n
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
      const n = await preguntar()
      if (n === null || n === conocido.current) return
      conocido.current = n
      refrescar()
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
  }, [router, contar, deLaPestana])

  if (version.estado === 'al-dia') return null
  // Otra llave al cambiar: el aviso que pasa de anunciarse a callarse es otro
  // elemento, y el texto nuevo no se lee dos veces.
  return <AvisoDeOtroDespliegue key={`${version.estado}-${version.callado}`} version={version} />
}

const TEXTO = {
  nueva: 'El sistema se actualizó mientras tenías la pantalla abierta. Termina lo que estás haciendo y vuelve a cargar la pantalla para ver lo nuevo.',
  vieja:
    'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde aquí no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.',
}

/**
 * Arriba de toda pantalla, solo después de un despliegue. Si nadie lo dijo
 * todavía (se supo al volver, en el sondeo o al abrir una ventana), va en una
 * región que nace vacía y recibe el texto en la pintada siguiente: la que nace
 * con su texto el lector no la lee. Si lo supo un envío que ya lo dice junto a
 * su botón, sin región: el lector lo oía dos veces seguidas (trigésima pasada).
 * Y no está montada en las demás pestañas: una fija en toda pantalla quedaba
 * delante de la región de estado de cada una («Requerimiento registrado…»),
 * como la que `TrabaDeOtraCuenta` dejó de tener.
 */
function AvisoDeOtroDespliegue({ version }: { version: VersionDeLaPestana }) {
  const anunciar = !version.callado
  const [conTexto, setConTexto] = useState(!anunciar)
  const [recargando, setRecargando] = useState(false)
  useEffect(() => {
    if (conTexto) return
    const cuadro = requestAnimationFrame(() => setConTexto(true))
    return () => cancelAnimationFrame(cuadro)
  }, [conTexto])

  const caja = conTexto && (
    <div className="flex items-center gap-3 border-b border-borde bg-aviso-suave px-4 py-2.5" data-pestana-vieja={version.estado}>
      <p className="min-w-0 flex-1 text-xs text-texto">{TEXTO[version.estado === 'vieja' ? 'vieja' : 'nueva']}</p>
      <Boton
        tamano="sm"
        variante="secundario"
        cargando={recargando}
        onClick={() => {
          // Antes, lo que la pantalla subió y nadie va a nombrar (`alVolverACargar`).
          setRecargando(true)
          void volverACargar()
        }}
      >
        <RotateCw aria-hidden className="size-3.5" />
        Volver a cargar
      </Boton>
    </div>
  )
  return anunciar ? (
    <div role="status" className="print:hidden" data-region-pestana-vieja>
      {caja}
    </div>
  ) : (
    <div className="print:hidden">{caja}</div>
  )
}

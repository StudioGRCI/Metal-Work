'use client'

import { RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { cn } from '@/lib/utils'
import { hayVentanaAbierta } from '@/lib/ventanas-abiertas'
import {
  anotarLaCompilacionDeLaPestana,
  anotarQueHuboUnDespliegue,
  desdeQueSeVa,
  esDeLaVersionAnterior,
  laPestanaEsDeOtraCuenta,
  laPestanaEsDeOtroDespliegue,
  refrescarLaSesionAntesDeCadaAccion,
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

  useEffect(() => anotarLaCompilacionDeLaPestana(deLaPestana), [deLaPestana])

  // La sesión que está por vencer se refresca antes de cada acción, no durante (X8).
  useEffect(() => refrescarLaSesionAntesDeCadaAccion(), [])

  useEffect(() => {
    const refrescar = () => {
      if (alguienEscribe()) return
      startTransition(() => router.refresh())
    }

    /** Los avisos sin leer, o `null` si no se debe repintar. */
    const preguntar = async () => {
      let cuenta: Partial<Cuenta> | null
      try {
        cuenta = await contar()
      } catch (e) {
        // Sin red, nada. Si la acción ya no existe, la pestaña queda anotada
        // como vieja y lo dice el aviso de arriba.
        esDeLaVersionAnterior(e, { sinAvisoPropio: true })
        return null
      }
      // Otra forma es otro despliegue, que cambió la respuesta sin cambiarle el
      // nombre a la acción: la pestaña de antes comparaba un número con el
      // objeto de ahora y se recargaba (trigesimoprimera pasada).
      if (typeof cuenta?.sinLeer !== 'number' || (deLaPestana && cuenta.compilacion && cuenta.compilacion !== deLaPestana)) {
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

// En «nueva» lo enviado entra, pero casi todo envío repinta, y Next recarga el
// documento: «Termina lo que estás haciendo» invitaba a seguir con lo de otra
// parte de la pantalla, y el envío se lo llevaba (trigesimoprimera pasada).
const TEXTO = {
  nueva:
    'El sistema se actualizó mientras tenías la pantalla abierta. Lo que envíes todavía entra, pero al enviarlo la pantalla se vuelve a cargar y se pierde lo que tengas a medio escribir en otra parte de ella. Envía una cosa a la vez y vuelve a cargar la pantalla para ver lo nuevo.',
  vieja:
    'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde aquí no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.',
}

// Lo mismo en una línea, en la franja que queda a la vista bajo la cabecera.
const CORTO = {
  nueva: 'El sistema se actualizó: al enviar algo, la pantalla se vuelve a cargar.',
  vieja: 'El sistema se actualizó: lo que envíes desde aquí no va a entrar.',
}

// Por qué «Volver a cargar» todavía no recargó (`volverACargar`).
const SIN_RECARGAR = {
  'en-camino':
    'Lo que enviaste todavía no contesta. Si entra, la pantalla se vuelve a cargar sola; si la vuelves a cargar antes, no vas a saber si entró.',
  'no-entro': 'Lo que enviaste no entró, o no se sabe si entró: lee el aviso junto a su botón antes de volver a cargar la pantalla.',
  'se-va': 'Lo que enviaste ya entró, y la pantalla a la que lleva tarda en abrir. Si no abre, vuelve a cargar: ya está guardado, no lo envíes de nuevo.',
}

// Solo en el navegador: el aviso nunca sale en la pintada del servidor (la pestaña nace «al día»).
const dondeTerminaLaCabecera = () => Math.max(0, Math.round(document.querySelector('[data-barra-superior]')?.getBoundingClientRect().bottom ?? 0))

/**
 * Arriba de toda pantalla, solo después de un despliegue. Si nadie lo dijo
 * todavía (se supo al volver, en el sondeo o al abrir una ventana), va en una
 * región que nace vacía y recibe el texto en la pintada siguiente: la que nace
 * con su texto el lector no la lee. Si lo supo un envío que ya lo dice junto a
 * su botón, sin región: el lector lo oía dos veces seguidas (trigésima pasada).
 * Y no está montada en las demás pestañas: una fija en toda pantalla quedaba
 * delante de la región de estado de cada una («Requerimiento registrado…»),
 * como la que `TrabaDeOtraCuenta` dejó de tener.
 *
 * Con la pantalla bajada, una franja de una línea bajo la cabecera dice lo
 * mismo: arriba quedaba fuera de la vista, y el envío de más abajo recargaba
 * sin que nadie la hubiera visto (D12 de la trigesimosegunda pasada). La franja
 * no es una región: lo anunció ya la de arriba.
 *
 * «Volver a cargar» espera lo que está en camino y no recarga encima de lo que
 * no entró: lo dice aquí y el botón pasa a «Volver a cargar igual», que recarga
 * sin esperar (trigesimosegunda).
 */
function AvisoDeOtroDespliegue({ version }: { version: VersionDeLaPestana }) {
  // Vieja con una ventana abierta: la ventana lo anuncia arriba de su contenido
  // (`SeActualizoEnLaVentana`), y aquí se oía otra vez en el mismo instante
  // (trigesimoprimera pasada). Se mira al montarse: cada cambio es otra llave.
  const [anunciar] = useState(() => !version.callado && !(version.estado === 'vieja' && hayVentanaAbierta()))
  const [conTexto, setConTexto] = useState(!anunciar)
  // Con la ida a otra pantalla en camino (`desdeQueSeVa`), sigue girando hasta
  // los 15 s también si el aviso se volvió a montar mientras Next la carga.
  const [idaDesde, setIdaDesde] = useState(desdeQueSeVa)
  const [recargando, setRecargando] = useState(idaDesde !== null)
  const [sinRecargar, setSinRecargar] = useState<keyof typeof SIN_RECARGAR | null>(null)
  // Dónde termina la cabecera, y si el aviso de arriba quedó debajo de ella.
  const [cabecera, setCabecera] = useState(dondeTerminaLaCabecera)
  const [fuera, setFuera] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const estado = version.estado === 'vieja' ? 'vieja' : 'nueva'

  useEffect(() => {
    if (conTexto) return
    const cuadro = requestAnimationFrame(() => setConTexto(true))
    return () => cancelAnimationFrame(cuadro)
  }, [conTexto])

  // Al girar el teléfono la cabecera cambia de alto (el borde del iPhone).
  useEffect(() => {
    const medir = () => setCabecera(dondeTerminaLaCabecera())
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])

  useEffect(() => {
    const aviso = caja.current
    if (!aviso || typeof IntersectionObserver === 'undefined') return
    const mirar = new IntersectionObserver(([visto]) => setFuera(!visto.isIntersecting && visto.boundingClientRect.top < cabecera), {
      rootMargin: `-${cabecera}px 0px 0px 0px`,
    })
    mirar.observe(aviso)
    return () => mirar.disconnect()
  }, [conTexto, cabecera])

  // Si a los 15 s la ida no llegó, lo dice, y el toque siguiente va a esa
  // pantalla (F2 de la trigesimotercera).
  useEffect(() => {
    if (idaDesde === null) return
    const tope = setTimeout(() => {
      setRecargando(false)
      setSinRecargar('se-va')
    }, Math.max(0, idaDesde + 15_000 - Date.now()))
    return () => clearTimeout(tope)
  }, [idaDesde])

  function recargar() {
    // Antes, lo que la pantalla subió y nadie va a nombrar (`alVolverACargar`).
    const igual = sinRecargar !== null
    setRecargando(true)
    setSinRecargar(null)
    void volverACargar({
      igual,
      alTardar: () => {
        setRecargando(false)
        setSinRecargar('en-camino')
      },
    }).then((fin) => {
      if (fin === 'no-entro') {
        setRecargando(false)
        setSinRecargar('no-entro')
        return
      }
      // Recarga, o lo hace la ida a la otra pantalla.
      setSinRecargar(null)
      setRecargando(true)
      if (fin === 'se-va') setIdaDesde(desdeQueSeVa())
    })
  }

  const boton = (
    <Boton tamano="sm" variante="secundario" cargando={recargando} onClick={recargar} className="shrink-0">
      <RotateCw aria-hidden className="size-3.5" />
      {sinRecargar ? 'Volver a cargar igual' : 'Volver a cargar'}
    </Boton>
  )
  const contenido = conTexto && (
    <div ref={caja} className="flex items-center gap-3 border-b border-borde bg-aviso-suave px-4 py-2.5" data-pestana-vieja={version.estado}>
      <div className="min-w-0 flex-1 space-y-1 text-xs text-texto">
        <p>{TEXTO[estado]}</p>
        {/* Montada desde antes, para que el lector oiga por qué no recargó. */}
        <p role={anunciar ? undefined : 'status'} className={sinRecargar ? 'font-semibold' : 'sr-only'} data-sin-recargar={sinRecargar ?? undefined}>
          {sinRecargar ? SIN_RECARGAR[sinRecargar] : ''}
        </p>
      </div>
      {boton}
    </div>
  )
  return (
    <>
      {anunciar ? (
        <div role="status" className="print:hidden" data-region-pestana-vieja>
          {contenido}
        </div>
      ) : (
        <div className="print:hidden">{contenido}</div>
      )}
      {fuera && (
        <div
          className="fixed inset-x-0 z-20 flex items-center gap-3 border-b border-borde bg-aviso-suave px-4 py-1.5 shadow-[var(--sombra)] lg:left-64 print:hidden"
          style={{ top: cabecera }}
          data-franja-pestana-vieja={version.estado}
        >
          <p className={cn('min-w-0 flex-1 text-xs text-texto', sinRecargar && 'font-semibold')}>{sinRecargar ? SIN_RECARGAR[sinRecargar] : CORTO[estado]}</p>
          {boton}
        </div>
      )}
    </>
  )
}

'use client'

import { Download, Share, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { Boton } from '@/components/ui/boton'

/**
 * Instalar el sistema en el celular, para que se abra como aplicación: con su
 * ícono en la pantalla de inicio y sin la barra del navegador.
 *
 * Chrome y Edge avisan que se puede con el evento `beforeinstallprompt`, y el
 * botón muestra su ventana de instalar. El iPhone no avisa nada y no deja
 * instalar por botón: ahí se dice el camino a mano, Compartir → Agregar a
 * inicio. Ya instalada, no se ofrece más.
 *
 * Todo lo que depende del navegador se lee con `useSyncExternalStore`: en el
 * servidor no existe, y leerlo en un efecto para guardarlo en un estado es lo
 * que la regla del proyecto prohíbe.
 */

type EventoInstalar = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// ------------------------------------------------ el aviso de que se puede
let pendiente: EventoInstalar | null = null
const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin esto Chrome muestra su propia barrita, que la gente descarta sin leer.
    e.preventDefault()
    pendiente = e as EventoInstalar
    avisar()
  })
  window.addEventListener('appinstalled', () => {
    pendiente = null
    avisar()
  })
}

function suscribir(f: () => void) {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
  }
}

// ------------------------------------------------------ si ya está instalada
const MODO_APP = '(display-mode: standalone)'

function suscribirModo(f: () => void) {
  const consulta = window.matchMedia(MODO_APP)
  consulta.addEventListener('change', f)
  return () => consulta.removeEventListener('change', f)
}

const enModoApp = () =>
  window.matchMedia(MODO_APP).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const esIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const nada = () => () => {}

// --------------------------------------------- el aviso descartado, en este aparato
const CLAVE = 'metalwork:instalar-descartado'

function descartado() {
  try {
    return localStorage.getItem(CLAVE) === '1'
  } catch {
    return false
  }
}

function descartar() {
  try {
    localStorage.setItem(CLAVE, '1')
  } catch {
    // Sin memoria en este navegador: el aviso vuelve a salir, y ya.
  }
  avisar()
}

function useInstalacion() {
  const evento = useSyncExternalStore(suscribir, () => pendiente, () => null)
  // En el servidor se da por instalada: así no se pinta nada que después
  // desaparezca al hidratar.
  const instalada = useSyncExternalStore(suscribirModo, enModoApp, () => true)
  const iphone = useSyncExternalStore(nada, esIphone, () => false)
  return { evento, instalada, iphone }
}

async function instalar(evento: EventoInstalar) {
  await evento.prompt()
  await evento.userChoice
  // El mismo aviso no se puede usar dos veces: si dijo que no, se espera al
  // próximo que mande el navegador.
  pendiente = null
  avisar()
}

/** El bloque de instalar, para el final del menú «Más». */
export function InstalarApp() {
  const { evento, instalada, iphone } = useInstalacion()
  if (instalada) return null

  if (evento) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-texto-suave">
          Instálala en este celular: se abre como aplicación, con su ícono y sin la barra del navegador.
        </p>
        <Boton variante="secundario" onClick={() => instalar(evento)}>
          <Download aria-hidden className="size-4" />
          Instalar la aplicación
        </Boton>
      </div>
    )
  }

  if (iphone) {
    return (
      <p className="text-xs text-texto-suave">
        Para tenerla como aplicación en el iPhone: abre esta página en Safari, toca{' '}
        <Share aria-label="Compartir" className="inline size-3.5 align-text-bottom" /> y elige
        «Agregar a inicio».
      </p>
    )
  }

  return (
    <p className="text-xs text-texto-suave">
      Para tenerla como aplicación: en el menú del navegador (⋮), «Instalar aplicación» o «Agregar a la
      pantalla principal».
    </p>
  )
}

/**
 * El aviso de arriba, solo en el teléfono y solo cuando se puede instalar de
 * verdad. Se descarta una vez y no vuelve en ese aparato.
 */
export function AvisoInstalar() {
  const { evento, instalada, iphone } = useInstalacion()
  const yaNo = useSyncExternalStore(suscribir, descartado, () => true)
  if (instalada || yaNo || (!evento && !iphone)) return null

  return (
    <div className="flex items-center gap-3 border-b border-borde bg-acento-suave px-4 py-2.5 lg:hidden">
      <p className="min-w-0 flex-1 text-xs text-texto">
        {evento ? (
          'Tenla como aplicación en este celular: se abre sin la barra del navegador.'
        ) : (
          <>
            Tenla como aplicación: en Safari, toca{' '}
            <Share aria-label="Compartir" className="inline size-3.5 align-text-bottom" /> y «Agregar a
            inicio».
          </>
        )}
      </p>
      {evento && (
        <Boton tamano="sm" onClick={() => instalar(evento)}>
          <Download aria-hidden className="size-3.5" />
          Instalar
        </Boton>
      )}
      <button
        type="button"
        onClick={descartar}
        aria-label="No mostrar más este aviso"
        className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}

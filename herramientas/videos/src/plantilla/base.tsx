/**
 * Las piezas que usan todas las escenas: las letras, el movimiento, el fondo,
 * el logo y los íconos. Todo lo que aquí se decide vale para todos los videos.
 */
import '@fontsource/jost/500.css'
import '@fontsource/jost/600.css'
import '@fontsource/jost/700.css'
import '@fontsource/arimo/400.css'
import '@fontsource/arimo/700.css'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { AbsoluteFill, Easing, Img, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion'

import { COLOR, MEDIDAS, type Medidas } from './tema'
import type { Formato } from './tipos'

// ------------------------------------------------------------------ formato

const ContextoFormato = createContext<Formato>('horizontal')
export const ProveedorFormato = ContextoFormato.Provider
export const useFormato = () => useContext(ContextoFormato)
export const useMedidas = (): Medidas => MEDIDAS[useFormato()]

// -------------------------------------------------------------------- letras

/** Espera a que carguen Jost y Arimo: sin esto el primer cuadro sale con la letra del sistema. */
export function EsperarLetras({ children }: { children: React.ReactNode }) {
  const [espera] = useState(() => delayRender('Cargando las letras de la marca'))
  useEffect(() => {
    const pesos = ["500 20px 'Jost'", "600 20px 'Jost'", "700 20px 'Jost'", "400 20px 'Arimo'", "700 20px 'Arimo'"]
    Promise.all(pesos.map((p) => document.fonts.load(p, 'áéíóúñ¿¡«»')))
      .then(() => document.fonts.ready)
      .then(() => continueRender(espera))
      // Sin las letras de la marca no hay video: mejor que se detenga a que salga con la letra del sistema.
      .catch((e) => cancelRender(e instanceof Error ? e : new Error('No cargaron las letras de la marca (Jost y Arimo).')))
  }, [espera])
  return <>{children}</>
}

// ---------------------------------------------------------------- movimiento

const SUAVE = Easing.bezier(0.22, 0.61, 0.36, 1)
const IDA_Y_VUELTA = Easing.bezier(0.45, 0, 0.25, 1)

/** De 0 a 1 entre `desde` y `desde + dura` cuadros, frenando al llegar. */
export function avance(cuadro: number, desde: number, dura: number, curva: 'suave' | 'ida-y-vuelta' = 'suave') {
  return interpolate(cuadro, [desde, desde + Math.max(1, dura)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: curva === 'suave' ? SUAVE : IDA_Y_VUELTA,
  })
}

/** Algo que entra: aparece y sube unos píxeles. El único movimiento de entrada de la plantilla. */
export function Entra({
  desde = 0,
  dura = 14,
  sube = 18,
  children,
  style,
}: {
  desde?: number
  dura?: number
  sube?: number
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  const p = avance(useCurrentFrame(), desde, dura)
  return <div style={{ ...style, opacity: p, transform: `translateY(${(1 - p) * sube}px)` }}>{children}</div>
}

// --------------------------------------------------------------------- fondo

/** El fondo de todos los videos: el azul de marca en sombra, con una luz arriba y el filete rojo. */
export function Fondo() {
  const m = useMedidas()
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.azulNoche }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 18% 0%, ${COLOR.azul} 0%, ${COLOR.azulFuerte} 38%, ${COLOR.azulNoche} 100%)`,
        }}
      />
      {/* Las diagonales del isotipo, apenas dichas. */}
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage: `repeating-linear-gradient(115deg, ${COLOR.blanco} 0 2px, transparent 2px ${Math.round(m.ancho / 22)}px)`,
        }}
      />
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: Math.max(6, Math.round(m.alto / 180)), backgroundColor: COLOR.rojo }} />
    </AbsoluteFill>
  )
}

/** La foto del taller detrás del gancho y la portada, teñida de azul para que el texto se lea. */
export function FotoDelTaller({ opacidad = 1 }: { opacidad?: number }) {
  const cuadro = useCurrentFrame()
  return (
    <AbsoluteFill style={{ opacity: opacidad }}>
      <Img
        src={staticFile('marca/taller.jpg')}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.06 + cuadro * 0.0004})`, filter: 'saturate(0.6)' }}
      />
      <AbsoluteFill style={{ background: `linear-gradient(160deg, rgba(8,31,59,0.9) 0%, rgba(14,53,96,0.84) 55%, rgba(8,31,59,0.95) 100%)` }} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------- logo

/** El logo oficial, leído del disco. `claro` va sobre el azul; el otro, sobre blanco. */
export function Logo({ alto, claro = true, style }: { alto: number; claro?: boolean; style?: React.CSSProperties }) {
  return <Img src={staticFile(claro ? 'marca/logo-metal-work-claro.png' : 'marca/logo-metal-work.png')} style={{ height: alto, width: 'auto', ...style }} />
}

// -------------------------------------------------------------------- íconos

/** Trazos como los de Lucide, que es la familia de íconos del sistema. */
export function Icono({ nombre, lado, color }: { nombre: 'visto' | 'equis' | 'flecha'; lado: number; color: string }) {
  const trazo = { visto: 'M20 6 9 17l-5-5', equis: 'M18 6 6 18M6 6l12 12', flecha: 'M5 12h14M12 5l7 7-7 7' }[nombre]
  return (
    <svg width={lado} height={lado} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={trazo} />
    </svg>
  )
}

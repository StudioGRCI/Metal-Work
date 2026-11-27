/**
 * Las piezas fijas de la plantilla: la cabecera, la ventana con la pantalla
 * real (zoom suave y recuadro), el rótulo de cada paso y los subtítulos.
 * Están siempre en el mismo sitio, con la misma letra y el mismo movimiento.
 */
import React from 'react'
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

import { Logo, avance, useFormato, useMedidas } from './base'
import { COLOR, LETRA, TRANSICION, type Medidas } from './tema'
import type { Caja, Captura, Subtitulo } from './tipos'

// ------------------------------------------------------------------ cabecera

/** Arriba, en todo el video menos la portada: de quién es y de qué tarea trata. */
export function Cabecera({ tarea, puesto }: { tarea: string; puesto: string }) {
  const m = useMedidas()
  const vertical = useFormato() === 'vertical'
  return (
    <div
      style={{
        position: 'absolute',
        left: m.margen,
        right: m.margen,
        top: Math.max(6, Math.round(m.alto / 180)),
        height: m.cabecera.alto,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Logo alto={m.cabecera.logo} />
      <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: vertical ? 'flex-end' : 'center', gap: vertical ? 8 : 18 }}>
        <span style={{ fontFamily: LETRA.titulos, fontWeight: 600, fontSize: m.cabecera.letra, color: COLOR.blanco, letterSpacing: 0.2 }}>{tarea}</span>
        <span
          style={{
            fontFamily: LETRA.texto,
            fontWeight: 700,
            fontSize: m.cabecera.letra * 0.74,
            color: COLOR.blanco,
            border: `2px solid rgba(255,255,255,0.45)`,
            borderRadius: 999,
            padding: `${m.cabecera.letra * 0.16}px ${m.cabecera.letra * 0.6}px`,
          }}
        >
          {puesto}
        </span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- ventana

export type TomaLista = {
  captura: Captura
  /** Lo que se resalta, ya unido en un solo recuadro; sin él, la pantalla entera. */
  caja: Caja | null
  /** El cuadro de la escena en que entra esta toma. */
  desde: number
}

type Vista = { escala: number; x: number; y: number }

/** La vista de partida: en horizontal la pantalla entera; en vertical, a lo ancho y a la altura de lo resaltado. */
function vistaInicial(m: Medidas, c: Captura, caja: Caja | null): Vista {
  const escala = Math.max(m.ventana.ancho / c.ancho, m.ventana.alto / c.alto)
  return encuadrar(m, c, escala, caja ? caja.x + caja.ancho / 2 : c.ancho / 2, caja ? caja.y + caja.alto / 2 : 0)
}

/** La vista de llegada: lo resaltado al centro, ocupando la parte de la ventana que manda el formato. */
function vistaFinal(m: Medidas, c: Captura, caja: Caja | null): Vista {
  const partida = vistaInicial(m, c, caja)
  if (!caja) return partida
  const porAncho = (m.ventana.ancho * m.zoom.ocupa) / caja.ancho
  const porAlto = (m.ventana.alto * 0.6) / caja.alto
  const escala = Math.min(Math.max(Math.min(porAncho, porAlto), partida.escala * m.zoom.minimo), partida.escala * m.zoom.maximo)
  return encuadrar(m, c, Math.max(escala, partida.escala), caja.x + caja.ancho / 2, caja.y + caja.alto / 2)
}

/** Centra un punto de la captura sin dejar ver el borde de la imagen. */
function encuadrar(m: Medidas, c: Captura, escala: number, cx: number, cy: number): Vista {
  const limite = (valor: number, minimo: number) => Math.min(0, Math.max(minimo, valor))
  return {
    escala,
    x: limite(m.ventana.ancho / 2 - cx * escala, m.ventana.ancho - c.ancho * escala),
    y: limite(m.ventana.alto / 2 - cy * escala, m.ventana.alto - c.alto * escala),
  }
}

const mezclar = (a: number, b: number, p: number) => a + (b - a) * p

/**
 * La pantalla real del sistema, con su zoom suave hacia lo que se explica y el
 * recuadro que lo resalta. Con varias tomas: si la siguiente es la misma
 * pantalla, la cámara y el recuadro se deslizan; si es otra, funde.
 */
export function Ventana({ tomas }: { tomas: TomaLista[] }) {
  const m = useMedidas()
  const cuadro = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fundido = Math.round(TRANSICION.toma * fps)
  const actual = Math.max(0, tomas.findLastIndex((t) => t.desde <= cuadro))

  const estado = (k: number) => {
    const t = tomas[k]
    const previa = k > 0 ? tomas[k - 1] : null
    const sigue = previa !== null && previa.captura.archivo === t.captura.archivo
    const local = cuadro - t.desde
    const llegada = vistaFinal(m, t.captura, t.caja)
    const partida = sigue && previa ? vistaFinal(m, previa.captura, previa.caja) : vistaInicial(m, t.captura, t.caja)
    // La misma pantalla: se desliza enseguida. Otra pantalla: primero se ve entera, después se acerca.
    const p = sigue ? avance(local, 0, 0.8 * fps, 'ida-y-vuelta') : avance(local, 0.35 * fps, 1.0 * fps, 'ida-y-vuelta')
    const vista: Vista = { escala: mezclar(partida.escala, llegada.escala, p), x: mezclar(partida.x, llegada.x, p), y: mezclar(partida.y, llegada.y, p) }
    const cajaDesde = sigue && previa?.caja ? previa.caja : t.caja
    const caja =
      t.caja && cajaDesde
        ? { x: mezclar(cajaDesde.x, t.caja.x, p), y: mezclar(cajaDesde.y, t.caja.y, p), ancho: mezclar(cajaDesde.ancho, t.caja.ancho, p), alto: mezclar(cajaDesde.alto, t.caja.alto, p) }
        : null
    const marco = sigue && previa?.caja ? 1 : avance(local, 0.75 * fps, 0.4 * fps)
    return { t, sigue, local, vista, caja, marco }
  }

  const capa = (k: number, opacidad: number) => {
    const { t, vista, caja, marco, local } = estado(k)
    const margen = Math.round(m.ventana.ancho / 110)
    const grosor = Math.max(4, Math.round(m.ventana.ancho / 260))
    // El recuadro respira muy despacio: llama sin distraer.
    const pulso = 0.5 + 0.5 * Math.sin((local / fps) * Math.PI * 1.1)
    return (
      <AbsoluteFill key={k} style={{ opacity: opacidad }}>
        <Img
          src={staticFile(`capturas/${t.captura.archivo}`)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: t.captura.ancho,
            height: t.captura.alto,
            maxWidth: 'none',
            transformOrigin: '0 0',
            transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})`,
          }}
        />
        {caja && (
          <div
            style={{
              position: 'absolute',
              left: caja.x * vista.escala + vista.x - margen,
              top: caja.y * vista.escala + vista.y - margen,
              width: caja.ancho * vista.escala + margen * 2,
              height: caja.alto * vista.escala + margen * 2,
              borderRadius: margen * 1.4,
              border: `${grosor}px solid ${COLOR.rojo}`,
              // Lo de alrededor baja un poco: el ojo va solo al recuadro.
              boxShadow: `0 0 0 4000px rgba(8,31,59,${0.16 * marco}), 0 0 ${grosor * (3 + 3 * pulso)}px rgba(253,0,2,${0.55 * marco})`,
              opacity: marco,
              transform: `scale(${mezclar(1.12, 1, marco)})`,
            }}
          />
        )}
      </AbsoluteFill>
    )
  }

  const entrada = estado(actual)
  const funde = actual > 0 && !entrada.sigue && entrada.local < fundido
  return (
    <div
      style={{
        position: 'absolute',
        left: m.ventana.x,
        top: m.ventana.y,
        width: m.ventana.ancho,
        height: m.ventana.alto,
        borderRadius: m.ventana.radio,
        overflow: 'hidden',
        backgroundColor: COLOR.fondo,
        boxShadow: `0 0 0 ${Math.max(3, Math.round(m.ventana.ancho / 330))}px rgba(255,255,255,0.16), 0 30px 70px -20px rgba(0,0,0,0.6)`,
      }}
    >
      {funde && capa(actual - 1, 1)}
      {capa(actual, funde ? avance(entrada.local, 0, fundido) : 1)}
    </div>
  )
}

/** Une varios recuadros en uno que los abarca. */
export function unirCajas(cajas: Caja[]): Caja | null {
  if (cajas.length === 0) return null
  const x = Math.min(...cajas.map((c) => c.x))
  const y = Math.min(...cajas.map((c) => c.y))
  return { x, y, ancho: Math.max(...cajas.map((c) => c.x + c.ancho)) - x, alto: Math.max(...cajas.map((c) => c.y + c.alto)) - y }
}

// -------------------------------------------------------------------- rótulo

/** El rótulo corto de cada paso, debajo de la pantalla: el número y qué hacer. */
export function Rotulo({ paso, total, texto }: { paso: number; total: number; texto: string }) {
  const m = useMedidas()
  const cuadro = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = avance(cuadro, 0.25 * fps, 0.45 * fps)
  const letra = m.rotulo.letra
  return (
    <div
      style={{
        position: 'absolute',
        left: m.ventana.x,
        width: m.ventana.ancho,
        top: m.rotulo.y,
        height: m.rotulo.alto,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        opacity: p,
        transform: `translateY(${(1 - p) * letra * 0.5}px)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: letra * 0.55,
          maxWidth: '100%',
          backgroundColor: COLOR.superficie,
          borderRadius: letra * 0.6,
          padding: `${letra * 0.3}px ${letra * 0.8}px ${letra * 0.3}px ${letra * 0.36}px`,
          boxShadow: '0 12px 30px -12px rgba(0,0,0,0.55)',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            fontFamily: LETRA.titulos,
            fontWeight: 700,
            fontSize: letra * 0.68,
            color: COLOR.blanco,
            backgroundColor: COLOR.azul,
            borderRadius: letra * 0.4,
            padding: `${letra * 0.22}px ${letra * 0.5}px`,
            whiteSpace: 'nowrap',
          }}
        >
          Paso {paso} de {total}
        </span>
        <span style={{ fontFamily: LETRA.texto, fontWeight: 700, fontSize: letra, lineHeight: 1.15, color: COLOR.texto, textWrap: 'balance' } as React.CSSProperties}>{texto}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- subtítulos

/** Los subtítulos: siempre visibles mientras se habla, con el texto del guion y el tiempo que midió Whisper. */
export function Subtitulos({ subtitulos }: { subtitulos: Subtitulo[] }) {
  const m = useMedidas()
  const cuadro = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ahora = cuadro / fps
  // El cuadro en que entra cada uno es el redondeo de su segundo: la revisión mide contra eso.
  const actual = subtitulos.find((s) => cuadro >= Math.round(s.inicio * fps) && cuadro < Math.round(s.fin * fps))
  if (!actual) return null
  const entra = interpolate(ahora, [actual.inicio, actual.inicio + 0.1], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const letra = m.subtitulos.letra
  return (
    <div
      style={{
        position: 'absolute',
        left: (m.ancho - m.subtitulos.ancho) / 2,
        width: m.subtitulos.ancho,
        top: m.subtitulos.y,
        height: m.subtitulos.alto,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <span
        style={
          {
            fontFamily: LETRA.texto,
            fontWeight: 700,
            fontSize: letra,
            lineHeight: 1.22,
            color: COLOR.blanco,
            textAlign: 'center',
            textWrap: 'balance',
            backgroundColor: 'rgba(4,16,32,0.78)',
            borderRadius: letra * 0.32,
            padding: `${letra * 0.2}px ${letra * 0.55}px`,
            opacity: entra,
          } as React.CSSProperties
        }
      >
        {actual.texto}
      </span>
    </div>
  )
}

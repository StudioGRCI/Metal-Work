/**
 * Las seis escenas de todo video de Metal Work, en su orden:
 * gancho · portada · antes y después · paso a paso · por qué importa · cierre.
 * Un video nuevo no escribe escenas: llena su `guion.json` y la plantilla las arma.
 */
import React from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

import { Entra, FotoDelTaller, Icono, Logo, avance, useFormato, useMedidas } from './base'
import { Rotulo, Ventana, unirCajas, type TomaLista } from './piezas'
import { COLOR, LETRA } from './tema'
import type { Captura, Capturas, EscenaGuion, TiemposEscena } from './tipos'

type De<T extends EscenaGuion['tipo']> = Extract<EscenaGuion, { tipo: T }>

/** La zona de las escenas de texto: entre la cabecera y los subtítulos. */
function Zona({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const m = useMedidas()
  const arriba = m.ventana.y
  return (
    <div
      style={{
        position: 'absolute',
        left: m.margen * 1.6,
        right: m.margen * 1.6,
        top: arriba,
        height: m.subtitulos.y - arriba - m.margen * 0.3,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function Etiqueta({ children, color = COLOR.blanco }: { children: React.ReactNode; color?: string }) {
  const m = useMedidas()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: m.letra.etiqueta * 0.6 }}>
      <span style={{ width: m.letra.etiqueta * 1.6, height: Math.max(4, m.letra.etiqueta * 0.2), backgroundColor: COLOR.rojo, borderRadius: 2 }} />
      <span style={{ fontFamily: LETRA.titulos, fontWeight: 600, fontSize: m.letra.etiqueta, letterSpacing: m.letra.etiqueta * 0.14, textTransform: 'uppercase', color }}>{children}</span>
    </div>
  )
}

function buscar(capturas: Capturas, nombre: string): Captura {
  const c = capturas[nombre]
  if (!c) throw new Error(`El guion pide la captura «${nombre}» y no está en capturas.json.`)
  return c
}

function cajaDe(captura: Captura, resalte: string | string[] | undefined) {
  if (!resalte) return null
  const nombres = Array.isArray(resalte) ? resalte : [resalte]
  return unirCajas(
    nombres.map((n) => {
      const caja = captura.resaltes[n]
      if (!caja) throw new Error(`La captura «${captura.archivo}» no tiene el resalte «${n}».`)
      return caja
    }),
  )
}

// -------------------------------------------------------------- 1. el gancho

/** Los primeros 5 segundos: qué gana quien lo ve. Letra grande sobre la foto del taller. */
export function Gancho({ escena, frase }: { escena: De<'gancho'>; frase: string }) {
  const m = useMedidas()
  const cuadro = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Cada palabra por separado, sabiendo si va dentro de **la parte fuerte**.
  const palabras = (escena.titular ?? frase)
    .split(/\*\*/g)
    .flatMap((tramo, i) => tramo.split(/\s+/).filter(Boolean).map((texto) => ({ texto, fuerte: i % 2 === 1 })))
  return (
    <AbsoluteFill>
      <FotoDelTaller />
      <div style={{ position: 'absolute', left: m.margen, top: m.margen * 0.9 }}>
        <Logo alto={m.cabecera.logo * 1.15} />
      </div>
      <Zona style={{ top: m.cabecera.alto + m.margen }}>
        <div style={{ display: 'flex', gap: m.letra.gancho * 0.32 }}>
          <span style={{ width: Math.max(8, m.letra.gancho * 0.1), backgroundColor: COLOR.rojo, borderRadius: 4, transform: `scaleY(${avance(cuadro, 0, 0.4 * fps)})`, transformOrigin: 'top' }} />
          <p
            style={
              {
                margin: 0,
                fontFamily: LETRA.titulos,
                fontWeight: 600,
                fontSize: m.letra.gancho,
                lineHeight: 1.12,
                color: COLOR.blanco,
                textWrap: 'balance',
              } as React.CSSProperties
            }
          >
            {palabras.map((p, i) => {
              // Cada palabra entra un instante después de la anterior: se lee al ritmo de la voz.
              const q = avance(cuadro, 2 + i * 2.2, 0.3 * fps)
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    // Entre dos palabras fuertes el espacio es relleno: el subrayado rojo no se corta.
                    ...(p.fuerte && palabras[i + 1]?.fuerte ? { paddingRight: '0.26em' } : { marginRight: '0.26em' }),
                    opacity: q,
                    transform: `translateY(${(1 - q) * m.letra.gancho * 0.2}px)`,
                    boxShadow: p.fuerte ? `inset 0 -${m.letra.gancho * 0.12}px 0 ${COLOR.rojo}` : undefined,
                  }}
                >
                  {p.texto}
                </span>
              )
            })}
          </p>
        </div>
      </Zona>
    </AbsoluteFill>
  )
}

// ------------------------------------------------------------- 2. la portada

/** Dos segundos: logo, tarea y puesto. */
export function Portada({ tarea, puesto }: { tarea: string; puesto: string }) {
  const m = useMedidas()
  const cuadro = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill>
      <FotoDelTaller />
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: m.letra.titulo * 0.5, paddingBottom: m.alto - m.subtitulos.y - m.subtitulos.alto }}>
        <Entra dura={0.4 * fps}>
          <Logo alto={m.letra.titulo * 3.2} />
        </Entra>
        <span style={{ width: m.letra.titulo * 2.2 * avance(cuadro, 0.2 * fps, 0.4 * fps), height: Math.max(6, m.letra.titulo * 0.09), backgroundColor: COLOR.rojo, borderRadius: 3 }} />
        <Entra desde={0.2 * fps} dura={0.4 * fps}>
          <h1 style={{ margin: 0, fontFamily: LETRA.titulos, fontWeight: 700, fontSize: m.letra.titulo * 1.3, lineHeight: 1.1, color: COLOR.blanco, textAlign: 'center' }}>{tarea}</h1>
        </Entra>
        <Entra desde={0.35 * fps} dura={0.4 * fps}>
          <span
            style={{
              fontFamily: LETRA.texto,
              fontWeight: 700,
              fontSize: m.letra.punto * 0.82,
              color: COLOR.azulFuerte,
              backgroundColor: COLOR.blanco,
              borderRadius: 999,
              padding: `${m.letra.punto * 0.22}px ${m.letra.punto * 0.7}px`,
            }}
          >
            {puesto}
          </span>
        </Entra>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ------------------------------------------------------ 3. antes y después

/** Cómo estaba y cómo se ve ahora: primero manda «Antes»; al nombrar el ahora, la pantalla real. */
export function AntesDespues({ escena, tiempos, capturas }: { escena: De<'antes-despues'>; tiempos: TiemposEscena; capturas: Capturas }) {
  const m = useMedidas()
  const vertical = useFormato() === 'vertical'
  const cuadro = useCurrentFrame()
  const { fps } = useVideoConfig()
  const cambio = tiempos.frases[1]?.inicio ?? tiempos.duracion / 2
  const p = avance(cuadro, cambio - 0.15 * fps, 0.45 * fps, 'ida-y-vuelta')
  const captura = buscar(capturas, escena.ahora.captura)
  const caja = cajaDe(captura, escena.ahora.resalte) ?? { x: 0, y: 0, ancho: captura.ancho, alto: captura.alto }

  const radio = m.letra.punto * 0.5
  const relleno = m.letra.punto * 0.8
  const anchoZona = m.ancho - m.margen * 3.2
  const anchoAhora = vertical ? anchoZona : anchoZona * 0.6
  // El recorte de la pantalla: lo resaltado a lo ancho de la tarjeta, con un poco de aire.
  const anchoRecorte = anchoAhora - relleno * 2
  const aire = caja.ancho * 0.03
  const escala = anchoRecorte / (caja.ancho + aire * 2)
  const altoRecorte = Math.min((caja.alto + aire * 2) * escala, vertical ? 520 : 420)

  const tarjeta: React.CSSProperties = { borderRadius: radio, padding: relleno, display: 'flex', flexDirection: 'column', gap: m.letra.punto * 0.55, minWidth: 0 }
  const chip = (texto: string, fondo: string, color: string) => (
    <span style={{ alignSelf: 'flex-start', fontFamily: LETRA.titulos, fontWeight: 700, fontSize: m.letra.etiqueta, letterSpacing: m.letra.etiqueta * 0.12, color, backgroundColor: fondo, borderRadius: 999, padding: `${m.letra.etiqueta * 0.25}px ${m.letra.etiqueta * 0.8}px` }}>
      {texto}
    </span>
  )
  const punto = (texto: string, icono: 'visto' | 'equis', color: string, fondo: string, tinta: string, i: number, desde: number) => (
    <Entra key={i} desde={desde + i * 0.25 * fps} style={{ display: 'flex', alignItems: 'center', gap: m.letra.punto * 0.45 }}>
      <span style={{ flexShrink: 0, width: m.letra.punto * 1.05, height: m.letra.punto * 1.05, borderRadius: 999, backgroundColor: fondo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icono nombre={icono} lado={m.letra.punto * 0.62} color={color} />
      </span>
      <span style={{ fontFamily: LETRA.texto, fontWeight: 700, fontSize: m.letra.punto * 0.72, lineHeight: 1.2, color: tinta, textWrap: 'balance' } as React.CSSProperties}>{texto}</span>
    </Entra>
  )

  return (
    <Zona style={{ flexDirection: vertical ? 'column' : 'row', alignItems: 'stretch', justifyContent: 'center', gap: m.letra.punto * 0.7, paddingTop: m.margen * 0.4, paddingBottom: m.margen * 0.4 }}>
      <div
        style={{
          ...tarjeta,
          flex: vertical ? '0 0 auto' : '0 0 38%',
          justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.08)',
          border: '2px solid rgba(255,255,255,0.22)',
          opacity: 1 - 0.55 * p,
          transform: `scale(${1 - 0.03 * p})`,
        }}
      >
        {chip('ANTES', 'rgba(255,255,255,0.16)', COLOR.blanco)}
        {escena.antes.map((t, i) => punto(t, 'equis', COLOR.peligro, COLOR.peligroSuave, COLOR.blanco, i, 0.3 * fps))}
      </div>
      <div
        style={{
          ...tarjeta,
          flex: '1 1 0',
          justifyContent: 'center',
          backgroundColor: COLOR.superficie,
          boxShadow: '0 30px 70px -20px rgba(0,0,0,0.6)',
          opacity: 0.4 + 0.6 * p,
          transform: `scale(${0.97 + 0.03 * p})`,
        }}
      >
        {chip('AHORA', COLOR.exitoSuave, COLOR.exito)}
        <div style={{ position: 'relative', width: anchoRecorte, height: altoRecorte, borderRadius: radio * 0.6, overflow: 'hidden', border: `2px solid ${COLOR.borde}`, flexShrink: 0 }}>
          <Img
            src={staticFile(`capturas/${captura.archivo}`)}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: captura.ancho,
              height: captura.alto,
              maxWidth: 'none',
              transformOrigin: '0 0',
              transform: `translate(${-(caja.x - aire) * escala}px, ${-(caja.y - aire) * escala}px) scale(${escala})`,
            }}
          />
        </div>
        {escena.ahora.puntos.map((t, i) => punto(t, 'visto', COLOR.exito, COLOR.exitoSuave, COLOR.texto, i, cambio))}
      </div>
    </Zona>
  )
}

// ------------------------------------------------------------ 4. cada paso

/** Un paso en la pantalla real: zoom suave a lo que se toca, su recuadro y el rótulo corto abajo. */
export function Paso({ escena, tiempos, capturas, numero, total }: { escena: De<'paso'>; tiempos: TiemposEscena; capturas: Capturas; numero: number; total: number }) {
  const { fps } = useVideoConfig()
  const formato = useFormato()
  const tomas: TomaLista[] = escena.tomas.filter((toma) => !toma.solo || toma.solo === formato).map((toma, k) => {
    const captura = buscar(capturas, toma.captura)
    // La toma entra un instante antes de la frase que la explica. Si este formato no dice esa frase, con la siguiente.
    const frase = toma.desdeFrase === undefined ? undefined : tiempos.frases.find((f) => f.indice >= (toma.desdeFrase ?? 0))
    const desde = k === 0 ? 0 : frase ? Math.max(0, frase.inicio - Math.round(0.2 * fps)) : Number.POSITIVE_INFINITY
    return { captura, caja: cajaDe(captura, toma.resalte), desde }
  })
  return (
    <AbsoluteFill>
      <Ventana tomas={tomas.filter((t) => Number.isFinite(t.desde))} />
      <Rotulo paso={numero} total={total} texto={escena.rotulo} />
    </AbsoluteFill>
  )
}

// ----------------------------------------------------- 5. por qué importa

/** Cómo ayuda al trabajo. El lema recuerda que el sistema guía y la persona decide. */
export function PorQue({ escena, tiempos }: { escena: De<'porque'>; tiempos: TiemposEscena }) {
  const m = useMedidas()
  const { fps } = useVideoConfig()
  const n = tiempos.frases.length
  const lema = n > 1 ? tiempos.frases[n - 1].inicio : tiempos.duracion * 0.6
  return (
    <Zona style={{ gap: m.letra.punto * 0.8 }}>
      <Entra>
        <Etiqueta>{escena.titulo}</Etiqueta>
      </Entra>
      <div style={{ display: 'flex', flexDirection: 'column', gap: m.letra.punto * 0.55 }}>
        {escena.puntos.map((t, i) => {
          const k = Math.min(i, Math.max(0, n - 2))
          const desde = (tiempos.frases[k]?.inicio ?? 0) + (i - k) * 0.6 * fps + 0.1 * fps
          return (
            <Entra key={i} desde={desde} style={{ display: 'flex', alignItems: 'center', gap: m.letra.punto * 0.5 }}>
              <span style={{ flexShrink: 0, width: m.letra.punto * 1.2, height: m.letra.punto * 1.2, borderRadius: 999, backgroundColor: COLOR.blanco, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icono nombre="visto" lado={m.letra.punto * 0.72} color={COLOR.azul} />
              </span>
              <span style={{ fontFamily: LETRA.texto, fontWeight: 700, fontSize: m.letra.punto, lineHeight: 1.18, color: COLOR.blanco, textWrap: 'balance' } as React.CSSProperties}>{t}</span>
            </Entra>
          )
        })}
      </div>
      <Entra desde={lema - 0.1 * fps} dura={0.45 * fps} style={{ alignSelf: 'flex-start', marginTop: m.letra.punto * 0.4 }}>
        <p
          style={
            {
              margin: 0,
              padding: `${m.letra.lema * 0.32}px ${m.letra.lema * 0.6}px`,
              backgroundColor: COLOR.superficie,
              borderLeft: `${Math.max(8, m.letra.lema * 0.14)}px solid ${COLOR.rojo}`,
              borderRadius: m.letra.lema * 0.22,
              fontFamily: LETRA.titulos,
              fontWeight: 600,
              fontSize: m.letra.lema,
              lineHeight: 1.15,
              color: COLOR.azulFuerte,
              textWrap: 'balance',
              boxShadow: '0 30px 70px -20px rgba(0,0,0,0.6)',
            } as React.CSSProperties
          }
        >
          {escena.lema}
        </p>
      </Entra>
    </Zona>
  )
}

// -------------------------------------------------------------- 6. el cierre

/** El resumen en tres puntos y, al callar la voz, el logo. */
export function Cierre({ escena, tiempos }: { escena: De<'cierre'>; tiempos: TiemposEscena }) {
  const m = useMedidas()
  const vertical = useFormato() === 'vertical'
  const cuadro = useCurrentFrame()
  const { fps } = useVideoConfig()
  const n = tiempos.frases.length
  const fin = tiempos.frases[n - 1]?.fin ?? tiempos.duracion * 0.7
  const logo = avance(cuadro, fin + 0.15 * fps, 0.5 * fps)
  return (
    <AbsoluteFill>
      <Zona style={{ flexDirection: vertical ? 'column' : 'row', alignItems: 'center', justifyContent: vertical ? 'center' : 'space-between', gap: m.letra.punto * 1.2 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: m.letra.punto * 0.7, alignSelf: vertical ? 'stretch' : 'center' }}>
          <Entra>
            <Etiqueta>{escena.titulo}</Etiqueta>
          </Entra>
          {escena.puntos.map((t, i) => {
            const k = Math.max(0, n - escena.puntos.length + i)
            const frase = tiempos.frases[Math.min(k, n - 1)]
            return (
              <Entra key={i} desde={(frase?.inicio ?? 0) - 0.05 * fps} style={{ display: 'flex', alignItems: 'center', gap: m.letra.punto * 0.55 }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: m.letra.punto * 1.35,
                    height: m.letra.punto * 1.35,
                    borderRadius: 999,
                    backgroundColor: COLOR.blanco,
                    color: COLOR.azul,
                    fontFamily: LETRA.titulos,
                    fontWeight: 700,
                    fontSize: m.letra.punto * 0.86,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontFamily: LETRA.titulos, fontWeight: 600, fontSize: m.letra.punto * 1.12, lineHeight: 1.15, color: COLOR.blanco, textWrap: 'balance' } as React.CSSProperties}>{t}</span>
              </Entra>
            )
          })}
        </div>
        <div style={{ opacity: logo, transform: `scale(${0.94 + 0.06 * logo})`, flexShrink: 0, padding: vertical ? 0 : `0 ${m.margen}px` }}>
          <Logo alto={m.letra.titulo * (vertical ? 3.4 : 4)} />
        </div>
      </Zona>
    </AbsoluteFill>
  )
}

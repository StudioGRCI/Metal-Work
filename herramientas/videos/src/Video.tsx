/**
 * El video entero: pone cada escena del guion en su tiempo, con el fundido
 * entre una y otra, y encima lo que no cambia nunca —el fondo, la cabecera y
 * los subtítulos—. No sabe de ningún video en particular: todo le llega por
 * las propiedades (guion, línea de tiempo y capturas).
 */
import React from 'react'
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

import { EsperarLetras, Fondo, ProveedorFormato } from './plantilla/base'
import { AntesDespues, Cierre, Gancho, Paso, PorQue, Portada } from './plantilla/escenas'
import { Cabecera, Subtitulos } from './plantilla/piezas'
import { TRANSICION } from './plantilla/tema'
import type { EscenaGuion, EscenaLinea, PropiedadesVideo, TiemposEscena } from './plantilla/tipos'

/** Las escenas que traen su propio fondo y su propio logo: sin cabecera encima. */
const A_PANTALLA_COMPLETA: EscenaGuion['tipo'][] = ['gancho', 'portada']

export function Video({ formato, guion, linea, capturas }: PropiedadesVideo) {
  const { fps, durationInFrames } = useVideoConfig()
  const cuadro = useCurrentFrame()
  const fundido = Math.round(TRANSICION.escena * fps)
  const pasos: EscenaGuion[] = guion.escenas.filter((e) => e.tipo === 'paso')

  // Cada escena ocupa de su inicio a su fin, más medio fundido a cada lado para cruzarse con sus vecinas.
  const tramos = linea.escenas.map((e, i) => {
    const primera = i === 0
    const ultima = i === linea.escenas.length - 1
    const inicio = Math.round(e.inicio * fps)
    const fin = ultima ? durationInFrames : Math.round(e.fin * fps)
    const desde = primera ? 0 : inicio - Math.floor(fundido / 2)
    const hasta = ultima ? durationInFrames : fin + Math.ceil(fundido / 2)
    return { e, desde, hasta, primera, ultima }
  })

  // La cabecera entra cuando termina la portada y se queda hasta el final.
  const sinCabecera = tramos.filter((t) => A_PANTALLA_COMPLETA.includes(t.e.tipo))
  const entraCabecera = sinCabecera.length > 0 ? Math.max(...sinCabecera.map((t) => t.hasta)) - fundido : 0
  const cabecera = interpolate(cuadro, [entraCabecera, entraCabecera + fundido], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  // El último medio segundo se va a negro: el video no se corta en seco.
  const salida = interpolate(cuadro, [durationInFrames - Math.round(0.5 * fps), durationInFrames - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <ProveedorFormato value={formato}>
      <EsperarLetras>
        <AbsoluteFill style={{ backgroundColor: '#000' }}>
          <AbsoluteFill style={{ opacity: salida }}>
            <Fondo />
            {tramos.map(({ e, desde, hasta, primera, ultima }) => (
              <Sequence key={e.indice} from={desde} durationInFrames={hasta - desde} name={`${e.indice + 1} · ${e.tipo}`}>
                <Fundido entra={primera ? 0 : fundido} sale={ultima ? 0 : fundido} dura={hasta - desde}>
                  <Escena escena={guion.escenas[e.indice]} linea={e} desde={desde} props={{ formato, guion, linea, capturas }} numero={pasos.indexOf(guion.escenas[e.indice]) + 1} total={pasos.length} />
                </Fundido>
              </Sequence>
            ))}
            <AbsoluteFill style={{ opacity: cabecera }}>
              <Cabecera tarea={guion.tarea} puesto={guion.puesto} />
            </AbsoluteFill>
            <Subtitulos subtitulos={linea.subtitulos} />
          </AbsoluteFill>
        </AbsoluteFill>
      </EsperarLetras>
    </ProveedorFormato>
  )
}

function Fundido({ entra, sale, dura, children }: { entra: number; sale: number; dura: number; children: React.ReactNode }) {
  const cuadro = useCurrentFrame()
  const a = entra > 0 ? interpolate(cuadro, [0, entra], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1
  const b = sale > 0 ? interpolate(cuadro, [dura - sale, dura], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1
  return <AbsoluteFill style={{ opacity: Math.min(a, b) }}>{children}</AbsoluteFill>
}

function Escena({
  escena,
  linea,
  desde,
  props,
  numero,
  total,
}: {
  escena: EscenaGuion
  linea: EscenaLinea
  desde: number
  props: PropiedadesVideo
  numero: number
  total: number
}) {
  const { fps } = useVideoConfig()
  // Los tiempos de la escena, en cuadros contados desde que empieza a verse.
  const tiempos: TiemposEscena = {
    duracion: Math.round((linea.fin - linea.inicio) * fps),
    frases: linea.frases.map((f) => ({ indice: f.indice, inicio: Math.round(f.inicio * fps) - desde, fin: Math.round(f.fin * fps) - desde })),
  }
  switch (escena.tipo) {
    case 'gancho':
      return <Gancho escena={escena} frase={linea.frases[0]?.texto ?? ''} />
    case 'portada':
      return <Portada tarea={props.guion.tarea} puesto={props.guion.puesto} />
    case 'antes-despues':
      return <AntesDespues escena={escena} tiempos={tiempos} capturas={props.capturas} />
    case 'paso':
      return <Paso escena={escena} tiempos={tiempos} capturas={props.capturas} numero={numero} total={total} />
    case 'porque':
      return <PorQue escena={escena} tiempos={tiempos} />
    case 'cierre':
      return <Cierre escena={escena} tiempos={tiempos} />
  }
}

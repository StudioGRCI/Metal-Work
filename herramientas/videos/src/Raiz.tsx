/**
 * Las composiciones de Remotion: la misma plantilla en sus dos formatos.
 * El tamaño, los cuadros por segundo y la duración salen de las propiedades
 * (`formatos.json` y la línea de tiempo del video), no de aquí.
 */
import React from 'react'
import { Composition, type CalculateMetadataFunction } from 'remotion'

import { Video } from './Video'
import formatos from './plantilla/formatos.json'
import type { Formato, PropiedadesVideo } from './plantilla/tipos'

/** Un video mínimo para abrir el estudio sin propiedades: `npm run estudio -- --props=…` trae el de verdad. */
const deMuestra = (formato: Formato): PropiedadesVideo => ({
  formato,
  guion: {
    id: 'muestra',
    tarea: 'Cómo hacer la tarea',
    puesto: 'Puesto',
    voz: { nombre: 'es-PE-CamilaNeural', velocidad: '-5%' },
    escenas: [{ tipo: 'gancho', frases: ['Lo que gana quien lo ve.'] }, { tipo: 'portada' }],
  },
  linea: {
    video: 'muestra',
    formato,
    duracion: 7,
    escenas: [
      { indice: 0, tipo: 'gancho', inicio: 0, fin: 5, frases: [{ indice: 0, texto: 'Lo que gana quien lo ve.', inicio: 0.4, fin: 3 }] },
      { indice: 1, tipo: 'portada', inicio: 5, fin: 7, frases: [] },
    ],
    subtitulos: [{ texto: 'Lo que gana quien lo ve.', inicio: 0.4, fin: 3 }],
  },
  capturas: {},
})

const medir: CalculateMetadataFunction<PropiedadesVideo> = ({ props }) => {
  const f = formatos[props.formato]
  return { width: f.ancho, height: f.alto, fps: f.fps, durationInFrames: Math.ceil(props.linea.duracion * f.fps) }
}

export function Raiz() {
  return (
    <>
      {(Object.keys(formatos) as Formato[]).map((formato) => (
        <Composition
          key={formato}
          id={formatos[formato].nombre}
          component={Video}
          width={formatos[formato].ancho}
          height={formatos[formato].alto}
          fps={formatos[formato].fps}
          durationInFrames={formatos[formato].fps * 7}
          defaultProps={deMuestra(formato)}
          calculateMetadata={medir}
        />
      ))}
    </>
  )
}

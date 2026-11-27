/** Lo que un video le da a la plantilla: su guion, sus tiempos y sus capturas. */

export type Formato = 'horizontal' | 'vertical'

/** Una frase de la voz. Con `vertical`, lo que se dice en el vertical ("" = no se dice). */
export type Frase = string | { texto: string; vertical?: string }

/** Una pantalla dentro de un paso: qué captura y qué se resalta (uno o varios recuadros que se unen). */
/** Una toma de un paso. Con `solo`, la toma es de ese formato nada más (en el teléfono no hay menú que mostrar). */
export type Toma = { captura: string; resalte?: string | string[]; desdeFrase?: number; solo?: Formato }

export type EscenaGuion =
  | { tipo: 'gancho'; titular?: string; frases: Frase[] }
  | { tipo: 'portada'; duracion?: number }
  | { tipo: 'antes-despues'; antes: string[]; ahora: { captura: string; resalte?: string | string[]; puntos: string[] }; frases: Frase[] }
  | { tipo: 'paso'; rotulo: string; tomas: Toma[]; frases: Frase[] }
  | { tipo: 'porque'; titulo: string; puntos: string[]; lema: string; frases: Frase[] }
  | { tipo: 'cierre'; titulo: string; puntos: string[]; frases: Frase[] }

export type Guion = {
  id: string
  /** El título del video es la tarea: «Cómo pedir un RQ». */
  tarea: string
  puesto: string
  voz: { nombre: string; velocidad: string }
  pronunciacion?: Record<string, string>
  pista_whisper?: string
  escenas: EscenaGuion[]
}

/** `generado/<formato>/linea.json`, que escribe `scripts/voz.py`. Todo en segundos. */
export type FraseLinea = { indice: number; texto: string; inicio: number; fin: number }
export type EscenaLinea = { indice: number; tipo: EscenaGuion['tipo']; inicio: number; fin: number; frases: FraseLinea[] }
export type Subtitulo = { texto: string; inicio: number; fin: number }
export type Linea = { video: string; formato: Formato; duracion: number; escenas: EscenaLinea[]; subtitulos: Subtitulo[] }

/** `capturas/<formato>/capturas.json`, que escribe `scripts/captura.mjs`. En píxeles de CSS. */
export type Caja = { x: number; y: number; ancho: number; alto: number }
/** `sha256`: la huella de la imagen al tomarla; la comprueba la revisión automática. */
export type Captura = { archivo: string; ancho: number; alto: number; resaltes: Record<string, Caja>; sha256?: string }
export type Capturas = Record<string, Captura>

export type PropiedadesVideo = {
  formato: Formato
  guion: Guion
  linea: Linea
  capturas: Capturas
}

/** Lo que recibe cada escena: sus cuadros y cuándo empieza cada frase, contados desde su propio inicio. */
export type TiemposEscena = {
  /** Cuadros que dura la escena, sin contar los fundidos. */
  duracion: number
  /** Las frases que se dicen en este formato, con su cuadro de inicio y de fin. */
  frases: { indice: number; inicio: number; fin: number }[]
}

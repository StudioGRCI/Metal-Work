/**
 * El tema de la plantilla: colores, letras y medidas. Es LO FIJO de todos los
 * videos; un video nuevo no toca este archivo.
 *
 * Los colores son los del sistema (`src/app/globals.css`, tema claro), que a
 * su vez salen del Manual de Identidad: azul corporativo #13467F y rojo
 * #FD0002. El azul manda; el rojo se reserva para el toque de marca y para el
 * recuadro que dice «mira aquí». Si cambia un token en `globals.css`, se
 * cambia aquí el mismo valor.
 */
import formatos from './formatos.json'
import type { Formato } from './tipos'

export const COLOR = {
  azul: '#13467f', // --marca-azul · --acento
  azulFuerte: '#0e3560', // --acento-fuerte
  azulNoche: '#081f3b', // el fondo: el azul de marca llevado a la sombra
  azulSuave: '#e4ecf7', // --acento-suave
  rojo: '#fd0002', // --marca-rojo
  fondo: '#f6f7f9', // --fondo
  superficie: '#ffffff', // --superficie
  borde: '#e2e5ea', // --borde
  texto: '#14181f', // --texto
  textoSuave: '#4e5766', // --texto-suave
  exito: '#15803d', // --exito
  exitoSuave: '#dcfce7', // --exito-suave
  peligro: '#c40004', // --peligro
  peligroSuave: '#ffe4e4', // --peligro-suave
  blanco: '#ffffff',
  blancoSuave: 'rgba(255,255,255,0.78)',
} as const

/** Jost para titulares y Arimo para el texto, como en la aplicación (`src/app/layout.tsx`). */
export const LETRA = {
  titulos: "'Jost', sans-serif",
  texto: "'Arimo', sans-serif",
} as const

/** Los fundidos entre escenas y entre tomas: de 0,3 a 0,5 s, sin efectos. */
export const TRANSICION = { escena: 0.4, toma: 0.3 } as const

type Caja = { x: number; y: number; ancho: number; alto: number }

export type Medidas = {
  ancho: number
  alto: number
  fps: number
  margen: number
  /** La franja de arriba, con el logo y la tarea. */
  cabecera: { alto: number; logo: number; letra: number }
  /** Donde va la pantalla real del sistema. */
  ventana: Caja & { radio: number }
  /** El rótulo corto de cada paso. */
  rotulo: { y: number; alto: number; letra: number }
  /** Los subtítulos: siempre visibles, siempre en el mismo sitio. La franja está en `formatos.json`: la revisión automática la lee de ahí. */
  subtitulos: { y: number; alto: number; letra: number; ancho: number }
  /** Tamaños de letra de las escenas de texto. */
  letra: { gancho: number; titulo: number; punto: number; lema: number; etiqueta: number }
  /** Cuánto se acerca la cámara a lo que se resalta, respecto de la vista de partida. */
  zoom: { minimo: number; maximo: number; ocupa: number }
}

export const MEDIDAS: Record<Formato, Medidas> = {
  horizontal: {
    ...dimensiones('horizontal'),
    margen: 72,
    cabecera: { alto: 84, logo: 50, letra: 26 },
    ventana: { x: 272, y: 92, ancho: 1376, alto: 774, radio: 14 },
    rotulo: { y: 882, alto: 66, letra: 34 },
    subtitulos: { ...formatos.horizontal.subtitulos, letra: 38, ancho: 1560 },
    letra: { gancho: 100, titulo: 64, punto: 60, lema: 72, etiqueta: 30 },
    zoom: { minimo: 1.3, maximo: 2.1, ocupa: 0.46 },
  },
  // Para WhatsApp: letra grande, zoom más cerrado y nada pegado al borde de
  // abajo, que es donde la aplicación pone sus botones.
  vertical: {
    ...dimensiones('vertical'),
    margen: 56,
    cabecera: { alto: 150, logo: 78, letra: 34 },
    ventana: { x: 48, y: 170, ancho: 984, alto: 1180, radio: 26 },
    rotulo: { y: 1376, alto: 132, letra: 44 },
    subtitulos: { ...formatos.vertical.subtitulos, letra: 60, ancho: 980 },
    letra: { gancho: 110, titulo: 82, punto: 68, lema: 88, etiqueta: 40 },
    zoom: { minimo: 1.0, maximo: 1.25, ocupa: 0.84 },
  },
}

function dimensiones(formato: Formato) {
  const f = formatos[formato]
  return { ancho: f.ancho, alto: f.alto, fps: f.fps }
}

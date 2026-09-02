/**
 * De dónde salen las pantallas que se recorren.
 *
 * Estaban escritas a mano en cada recorrido, así que una pantalla nueva no
 * entraba hasta que alguien se acordaba de agregarla a la lista — y nadie se
 * acuerda. El menú lateral (`src/lib/navegacion.ts`) ya sabe cuáles son: se
 * leen de ahí.
 *
 * Se **lee** el archivo y se saca con una expresión regular; no se importa. Es
 * TypeScript con JSX y componentes de iconos: importarlo desde node exigiría un
 * compilador entero para averiguar seis rutas.
 *
 * La lista a mano se queda como respaldo por dos motivos: si el archivo cambia
 * de forma y la expresión regular no encuentra nada, el recorrido sigue
 * funcionando; y trae las pantallas que el menú no nombra —los formularios de
 * alta y las subpantallas de almacén—, que también hay que mirar.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const ARCHIVO_NAVEGACION = join(AQUI, '..', '..', 'src', 'lib', 'navegacion.ts')

/** El respaldo: lo que se recorría antes de leer el menú. */
export const RUTAS_A_MANO = [
  ['tablero', '/'],
  ['ordenes', '/ordenes'],
  ['orden-nueva', '/ordenes/nueva'],
  ['clientes', '/clientes'],
  ['cliente-nuevo', '/clientes/nuevo'],
  ['unidades', '/unidades'],
  ['cotizaciones', '/cotizaciones'],
  ['cotizacion-nueva', '/cotizaciones/nueva'],
  ['cotizacion-trabajo', '/cotizaciones/trabajo'],
  ['avance-taller', '/avance'],
  ['produccion', '/produccion'],
  ['parte-nuevo', '/produccion/nuevo'],
  ['almacen', '/almacen'],
  ['almacen-movimientos', '/almacen/movimientos'],
  ['almacen-requerimientos', '/almacen/requerimientos'],
  ['almacen-compras', '/almacen/compras'],
  ['almacen-materiales', '/almacen/materiales'],
  ['almacen-proveedores', '/almacen/proveedores'],
  ['servicios', '/servicios'],
  ['costos', '/costos'],
  ['documentos', '/documentos'],
  ['firmas', '/firmas'],
  ['informes', '/informes'],
  ['garantias', '/garantias'],
  ['configuracion', '/configuracion'],
  ['personal', '/personal'],
]

/** Un nombre de archivo a partir de la ruta: `/cotizaciones/trabajo` → `cotizaciones-trabajo`. */
export function nombreDeRuta(ruta) {
  const limpio = ruta.replace(/^\/+|\/+$/g, '').replace(/\//g, '-')
  return limpio === '' ? 'tablero' : limpio
}

/**
 * Las rutas que declara el menú lateral. Devuelve [] si no encuentra ninguna,
 * que es la señal de que el archivo cambió de forma.
 */
export function rutasDelMenu(archivo = ARCHIVO_NAVEGACION) {
  let texto
  try {
    texto = readFileSync(archivo, 'utf8')
  } catch {
    return []
  }

  // `ruta: '/plazos'` es como se llama hoy; `href` queda contemplado por si el
  // menú se renombra al vocabulario de Next.
  const patron = /\b(?:ruta|href)\s*:\s*['"`]([^'"`]+)['"`]/g
  const encontradas = [...texto.matchAll(patron)]

  const rutas = []
  for (let i = 0; i < encontradas.length; i++) {
    const ruta = encontradas[i][1]
    if (!ruta.startsWith('/')) continue

    // Los módulos marcados `disponible: false` se muestran atenuados y sin
    // enlace: visitarlos sería mirar un 404. El bloque de cada entrada va desde
    // su `ruta:` hasta la `ruta:` siguiente.
    const desde = encontradas[i].index
    const hasta = i + 1 < encontradas.length ? encontradas[i + 1].index : texto.length
    if (/disponible\s*:\s*false/.test(texto.slice(desde, hasta))) continue

    rutas.push([nombreDeRuta(ruta), ruta])
  }
  return rutas
}

/**
 * Lo que de verdad se recorre: lo que dice el menú más lo que la lista a mano
 * añade, sin repetidos y en el orden en que aparecen.
 *
 * `avisar` recibe una línea cuando el menú no dio nada, para que el recorrido
 * lo diga en voz alta en vez de callarse y mirar de menos.
 */
export function rutasDelRecorrido(avisar = () => {}) {
  const delMenu = rutasDelMenu()
  if (delMenu.length === 0) {
    avisar(`no se pudo leer ninguna ruta de ${ARCHIVO_NAVEGACION}: se recorre solo la lista a mano`)
  }

  const vistas = new Set()
  const rutas = []
  for (const [nombre, ruta] of [...delMenu, ...RUTAS_A_MANO]) {
    if (vistas.has(ruta)) continue
    vistas.add(ruta)
    rutas.push([nombre, ruta])
  }
  return { rutas, delMenu: delMenu.length, aMano: RUTAS_A_MANO.length }
}

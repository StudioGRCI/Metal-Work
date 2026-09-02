/**
 * Visita las pantallas con sesión iniciada y guarda una captura de cada una.
 *
 * `herramientas/banco/recorrer.mjs` hace esto contra el banco local, que en
 * algunas máquinas no se puede levantar (hace falta Postgres). Este visita el
 * sitio de verdad: entra una sola vez —el ingreso es lo más lento y lo más
 * frágil de todo el recorrido— y después navega sin volver a autenticarse.
 *
 * Junta lo que no se ve en una captura: errores de consola, respuestas 4xx y 5xx
 * y textos de error dentro de la página. Una pantalla puede verse perfecta y
 * estar diciendo «no se pudo» en un rincón.
 *
 *   URL=https://... USUARIO=... CLAVE=... \
 *   node herramientas/recorrido/recorrer-produccion.mjs [ancho]
 *
 * El ancho por omisión es de monitor (1440). Con `390` recorre como teléfono,
 * que es como lo usa el taller.
 *
 * Las rutas salen del menú lateral (`src/lib/navegacion.ts`), así que una
 * pantalla nueva entra sola en el recorrido; la lista a mano se conserva como
 * respaldo y para las subpantallas que el menú no nombra. Y al terminar **sale
 * con código 1 si alguna pantalla dio errores**: antes salía con 0 siempre, y
 * un recorrido con seis pantallas rotas se leía igual que uno limpio.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { navegadorDelSistema, sesionGuardada } from './sesion.mjs'
import { rutasDelRecorrido } from './rutas.mjs'

const URL_BASE = process.env.URL ?? 'http://localhost:3111'
const USUARIO = process.env.USUARIO ?? ''
const CLAVE = process.env.CLAVE ?? ''
const ANCHO = Number(process.argv[2]) || 1440
const CAPTURAS = join(process.env.CAPTURAS ?? 'capturas/produccion', String(ANCHO))

const { rutas: RUTAS, delMenu, aMano } = rutasDelRecorrido((aviso) => console.log(`  ! ${aviso}`))

// La sesión se reutiliza entre recorridos: entrar es lo más frágil de todo
// esto y no tiene nada que ver con lo que se quiere mirar.
const estado = await sesionGuardada({
  urlBase: URL_BASE,
  usuario: USUARIO,
  clave: CLAVE,
  archivo: join(tmpdir(), 'metal-work-sesion.json'),
})

const navegador = await chromium.launch({ executablePath: navegadorDelSistema() })
const contexto = await navegador.newContext({
  viewport: { width: ANCHO, height: ANCHO < 600 ? 844 : 1000 },
  locale: 'es-PE',
  storageState: estado,
})
const pagina = await contexto.newPage()

let errores = []
let avisos = []

// Los prefetch de Next se cancelan solos al navegar y una imagen que no carga
// deja la pantalla fea pero funcionando: se anotan como aviso y no cuentan.
const esPrefetch = (url) => url.includes('_rsc=')

pagina.on('console', (m) => {
  if (m.type() === 'error') errores.push(`consola: ${m.text().slice(0, 160)}`)
})
pagina.on('response', (r) => {
  if (r.status() < 400) return
  const linea = `${r.status()} ${r.url().replace(URL_BASE, '').slice(0, 90)}`
  if (esPrefetch(r.url())) avisos.push(linea)
  else errores.push(linea)
})
pagina.on('requestfailed', (p) => {
  const linea = `${p.method()} ${p.url().replace(URL_BASE, '').slice(0, 90)} — ${p.failure()?.errorText}`
  if (esPrefetch(p.url()) || p.resourceType() === 'image') avisos.push(linea)
  else errores.push(linea)
})

mkdirSync(CAPTURAS, { recursive: true })

let conErrores = 0
let avisosTotales = 0

try {
  console.log(`\nRecorrido a ${ANCHO}px · ${URL_BASE}`)
  console.log(`${RUTAS.length} rutas (${delMenu} del menú, ${aMano} de la lista a mano)\n`)

  for (const [nombre, ruta] of RUTAS) {
    errores = []
    avisos = []
    let estado = '?'
    // Lo que tarda desde que se pide la pantalla hasta que hay algo que leer.
    // Es la cifra que importa: el usuario no espera al `load` del navegador,
    // espera a ver su lista.
    const arranque = process.hrtime.bigint()
    let tarda = 0
    try {
      const respuesta = await pagina.goto(URL_BASE + ruta, { waitUntil: 'commit', timeout: 90000 })
      estado = respuesta?.status() ?? '?'
      // La pantalla llega en dos tiempos y el esqueleto de carga no tiene ni una
      // letra. Contar las letras del cuerpo no sirve: el menú lateral solo ya
      // pasa de doscientas, así que la cuenta se cumplía con la pantalla todavía
      // en gris y las capturas salían del esqueleto. Se espera al título dentro
      // del contenido, que es lo primero que escribe la pantalla de verdad.
      await pagina.locator('main h1').first().waitFor({ state: 'visible', timeout: 60000 })
      tarda = Number(process.hrtime.bigint() - arranque) / 1e6
    } catch {
      tarda = Number(process.hrtime.bigint() - arranque) / 1e6
      errores.push('no terminó de cargar')
    }

    await pagina.screenshot({
      path: join(CAPTURAS, `${nombre}.png`),
      fullPage: true,
      animations: 'disabled',
      timeout: 60000,
    })

    const segundos = tarda / 1000
    const cuerpo = await pagina.locator('body').innerText()
    const roto = /Ocurrió un error inesperado|Application error|no se pudo|No se pudieron/i.test(cuerpo)
    if (roto) errores.push('la pantalla dice que algo falló')

    if (errores.length > 0) conErrores += 1
    avisosTotales += avisos.length

    const marca = errores.length > 0 ? '✗' : segundos > 4 ? '⏳' : '·'
    console.log(
      `  ${marca} ${nombre.padEnd(24)} ${String(estado).padEnd(4)} ${segundos.toFixed(1)}s` +
        (errores.length ? ' — ' + errores.join(' | ') : ''),
    )
  }
} finally {
  await navegador.close()
}

console.log(`\n${RUTAS.length} rutas · ${conErrores} con errores`)
if (avisosTotales > 0) {
  console.log(`${avisosTotales} aviso(s) de red que no cuentan: prefetch de Next e imágenes`)
}
console.log(`Capturas en ${CAPTURAS}`)

process.exit(conErrores > 0 ? 1 : 0)

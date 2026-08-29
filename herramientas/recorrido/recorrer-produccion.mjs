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
 */
import { chromium } from 'playwright-core'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const URL_BASE = process.env.URL ?? 'http://localhost:3111'
const USUARIO = process.env.USUARIO ?? ''
const CLAVE = process.env.CLAVE ?? ''
const ANCHO = Number(process.argv[2]) || 1440
const CAPTURAS = join(process.env.CAPTURAS ?? 'capturas/produccion', String(ANCHO))

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('No hay Chrome ni Edge en esta máquina')

const RUTAS = [
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

const navegador = await chromium.launch({ executablePath: exe })
const contexto = await navegador.newContext({
  viewport: { width: ANCHO, height: ANCHO < 600 ? 844 : 1000 },
  deviceScaleFactor: 2,
  locale: 'es-PE',
})
const pagina = await contexto.newPage()

let errores = []
pagina.on('console', (m) => {
  if (m.type() === 'error') errores.push(`consola: ${m.text().slice(0, 160)}`)
})
pagina.on('response', (r) => {
  // Los prefetch de Next se cancelan solos al navegar: eso no es un fallo.
  if (r.status() >= 400 && !r.url().includes('_rsc=')) {
    errores.push(`${r.status()} ${r.url().replace(URL_BASE, '').slice(0, 90)}`)
  }
})

mkdirSync(CAPTURAS, { recursive: true })

try {
  await pagina.goto(`${URL_BASE}/ingresar`, { waitUntil: 'networkidle', timeout: 60000 })
  await pagina.fill('input[type="email"], input[name="correo"]', USUARIO)
  await pagina.fill('input[type="password"]', CLAVE)
  await pagina.click('button[type="submit"]')
  await pagina
    .waitForURL((u) => !u.pathname.includes('/ingresar'), { timeout: 90000 })
    .catch(() => {})

  if (pagina.url().includes('/ingresar')) throw new Error('no se pudo entrar')
  console.log(`\nRecorrido a ${ANCHO}px · ${URL_BASE}\n`)

  for (const [nombre, ruta] of RUTAS) {
    errores = []
    let estado = '?'
    try {
      const respuesta = await pagina.goto(URL_BASE + ruta, { waitUntil: 'networkidle', timeout: 60000 })
      estado = respuesta?.status() ?? '?'
      // La pantalla llega en dos tiempos y el esqueleto de carga no tiene ni
      // una letra: capturarlo sería fotografiar el cargando, no la pantalla.
      await pagina.waitForFunction(() => document.body.innerText.trim().length > 200, {
        timeout: 25000,
      })
    } catch {
      errores.push('no terminó de cargar')
    }

    await pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: true })

    const cuerpo = await pagina.locator('body').innerText()
    const roto = /Ocurrió un error inesperado|Application error|no se pudo|No se pudieron/i.test(cuerpo)
    if (roto) errores.push('la pantalla dice que algo falló')

    const marca = errores.length > 0 ? '✗' : '·'
    console.log(`  ${marca} ${nombre.padEnd(24)} ${estado}${errores.length ? ' — ' + errores.join(' | ') : ''}`)
  }
} finally {
  await navegador.close()
}

console.log(`\nCapturas en ${CAPTURAS}`)

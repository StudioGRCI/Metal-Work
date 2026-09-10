import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { navegadorDelSistema } from '../recorrido/sesion.mjs'

/**
 * Los íconos de la aplicación instalada, sacados del isotipo de la marca.
 *
 * El isotipo es apaisado (casi 2 a 1) y los íconos son cuadrados, así que va
 * centrado sobre blanco con su margen. El «maskable» lleva más margen porque
 * Android lo recorta en círculo o en gota según el teléfono: la zona que nunca
 * se corta es el círculo del 80 % central, y un logo ancho tiene que caber ahí.
 * El de Apple va sin transparencia: iOS pinta de negro lo transparente.
 *
 *   node herramientas/marca/iconos-app.mjs
 *
 * Rehacerlos solo hace falta si cambia el logo. Salen a public/iconos/.
 */

const RAIZ = new URL('../../', import.meta.url)
const isotipo = readFileSync(new URL('public/marca/isotipo.png', RAIZ)).toString('base64')
const salida = new URL('public/iconos/', RAIZ)
mkdirSync(salida, { recursive: true })

// [archivo, lado en px, ancho del logo como fracción del lado]
const ICONOS = [
  ['icono-192.png', 192, 0.78],
  ['icono-512.png', 512, 0.78],
  ['icono-maskable-512.png', 512, 0.58],
  ['apple-touch-icon.png', 180, 0.74],
]

const navegador = await chromium.launch({ executablePath: navegadorDelSistema() })
try {
  for (const [archivo, lado, fraccion] of ICONOS) {
    const pagina = await navegador.newPage({ viewport: { width: lado, height: lado }, deviceScaleFactor: 1 })
    await pagina.setContent(`<!doctype html><html><body style="margin:0;width:${lado}px;height:${lado}px;background:#ffffff;display:grid;place-items:center">
      <img src="data:image/png;base64,${isotipo}" style="width:${Math.round(lado * fraccion)}px;height:auto;display:block">
    </body></html>`)
    await pagina.locator('img').evaluate((img) => img.decode())
    const destino = join(salida.pathname.replace(/^\/([A-Za-z]:)/, '$1'), archivo)
    await pagina.screenshot({ path: destino, omitBackground: false })
    await pagina.close()
    console.log(`${archivo}  ${lado}×${lado}`)
  }
} finally {
  await navegador.close()
}

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { navegadorDelSistema, sesionGuardada } from './sesion.mjs'

/**
 * Mirar pantallas como las ve el taller: en un teléfono de 390 × 844, con la
 * cuenta de quien las usa.
 *
 * Por cada ruta dice el título, lo que tiene la barra de pestañas de abajo, los
 * selectores que se le pidan (contados y listados por texto, que es la prueba:
 * la captura sola no vale) y si la pantalla se sale de costado —en el teléfono
 * nada tiene que deslizarse de lado salvo las fotos—. Guarda una captura por
 * ruta en CAPTURAS.
 *
 *   MSYS_NO_PATHCONV=1 URL=https://metal-work-sandy.vercel.app \
 *   USUARIO=supervisor@metalworkperusac.com CLAVE='…' CAPTURAS=… \
 *   node herramientas/recorrido/mirar-telefono.mjs "/avance|h1,section h2" "/avance/diario|li"
 *
 * Cada argumento es «ruta|selector,selector». Sin selectores, solo título,
 * pestañas y desborde.
 */

const URL_BASE = process.env.URL
const USUARIO = process.env.USUARIO
const CLAVE = process.env.CLAVE
const CAPTURAS = process.env.CAPTURAS ?? join(tmpdir(), 'metalwork-telefono')
mkdirSync(CAPTURAS, { recursive: true })

const pedidos = process.argv.slice(2).map((a) => {
  const [ruta, sel = ''] = a.split('|')
  return { ruta, selectores: sel.split(',').map((s) => s.trim()).filter(Boolean) }
})

const archivo = join(tmpdir(), `metalwork-sesion-${USUARIO.replace(/[^a-z0-9]/gi, '_')}.json`)
const estado = await sesionGuardada({ urlBase: URL_BASE, usuario: USUARIO, clave: CLAVE, archivo })

const navegador = await chromium.launch({ executablePath: navegadorDelSistema() })
const contexto = await navegador.newContext({
  storageState: estado,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})

let fallas = 0
try {
  for (const [n, { ruta, selectores }] of pedidos.entries()) {
    const pagina = await contexto.newPage()
    const errores = []
    pagina.on('pageerror', (e) => errores.push(e.message.slice(0, 160)))
    const respuesta = await pagina.goto(`${URL_BASE}${ruta}`, { waitUntil: 'commit', timeout: 60000 })
    await pagina.locator('h1').first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
    await pagina.waitForTimeout(1500)

    const final = new URL(pagina.url()).pathname + new URL(pagina.url()).search
    const titulo = (await pagina.locator('h1').first().innerText().catch(() => '(sin h1)')).trim()
    const pestanas = await pagina.locator('nav[aria-label="Secciones"] li').allInnerTexts().catch(() => [])
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

    console.log(`\n=== ${ruta}${final !== ruta ? `  →  ${final}` : ''}  (${respuesta?.status() ?? '?'})`)
    console.log(`  h1: ${titulo}`)
    console.log(`  pestañas: ${pestanas.map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ') || '(ninguna)'}`)
    console.log(`  desborde de costado: ${desborde > 0 ? `${desborde}px — MAL` : 'ninguno'}`)
    if (desborde > 0) fallas++

    for (const sel of selectores) {
      const textos = await pagina.locator(sel).allInnerTexts().catch(() => [])
      console.log(`  ${sel} → ${textos.length}`)
      for (const t of textos.slice(0, 8)) console.log(`    · ${t.replace(/\s+/g, ' ').trim().slice(0, 140)}`)
    }
    if (errores.length) {
      fallas++
      console.log(`  ERRORES: ${errores.join(' | ')}`)
    }

    await pagina.screenshot({ path: join(CAPTURAS, `telefono-${n + 1}.png`), fullPage: true })
    await pagina.close()
  }
} finally {
  await navegador.close()
}

console.log(`\n${pedidos.length} rutas · ${fallas ? `${fallas} con fallas` : 'sin fallas'} · capturas en ${CAPTURAS}`)
process.exitCode = fallas ? 1 : 0

/**
 * Entrar y mirar una pantalla, sin recorrer todo el circuito.
 *
 * Cuando se agrega algo pequeño —un tipo de documento, una opción en un
 * desplegable— comprobarlo con el recorrido completo cuesta tres minutos y
 * ensucia la base con documentos de prueba. Esto entra, abre la pantalla que se
 * le pida, guarda la captura y, si se le pasan selectores, cuenta qué hay.
 *
 *   URL=... USUARIO=... CLAVE=... \
 *   node herramientas/recorrido/mirar.mjs /documentos captura [selector...]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const URL_BASE = process.env.URL ?? 'http://localhost:3111'
const USUARIO = process.env.USUARIO ?? ''
const CLAVE = process.env.CLAVE ?? ''
const CAPTURAS = process.env.CAPTURAS ?? 'capturas/circuito'

const [ruta = '/', nombre = 'pantalla', ...selectores] = process.argv.slice(2)

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('No hay Chrome ni Edge en esta máquina')

const navegador = await chromium.launch({ executablePath: exe })
const pagina = await navegador.newPage({ viewport: { width: 1440, height: 1000 } })

// Cuando el ingreso se queda girando sin decir nada, lo único que lo explica es
// mirar la red y la consola: el botón no distingue «no contestó» de «contestó
// que no».
pagina.on('requestfailed', (p) => console.log(`  ✗ ${p.method()} ${p.url()} — ${p.failure()?.errorText}`))
pagina.on('console', (m) => {
  if (m.type() === 'error') console.log(`  ✗ consola: ${m.text().slice(0, 200)}`)
})
pagina.on('response', async (r) => {
  if (r.status() >= 400) console.log(`  ✗ ${r.status()} ${r.url().slice(0, 120)}`)
})

try {
  await pagina.goto(`${URL_BASE}/ingresar`, { waitUntil: 'networkidle', timeout: 60000 })
  await pagina.fill('input[type="email"], input[name="correo"]', USUARIO)
  await pagina.fill('input[type="password"]', CLAVE)
  await pagina.click('button[type="submit"]')
  // Entrar es una acción de servidor: no siempre cambia la dirección de forma
  // que `waitForURL` alcance a ver. Si no la ve, no es motivo para abortar —se
  // comprueba después si de verdad se entró o no.
  await pagina
    .waitForURL((u) => !u.pathname.includes('/ingresar'), { timeout: 90000 })
    .catch(() => {})

  if (pagina.url().includes('/ingresar')) {
    mkdirSync(CAPTURAS, { recursive: true })
    await pagina.screenshot({ path: join(CAPTURAS, 'ingreso-FALLO.png'), fullPage: true })
    const avisos = await pagina.locator('[role="alert"], [role="status"]').allTextContents()
    throw new Error(`no se pudo entrar: ${avisos.join(' · ') || 'sin mensaje en pantalla'}`)
  }

  await pagina.goto(`${URL_BASE}${ruta}`, { waitUntil: 'networkidle' })
  // La pantalla llega en dos tiempos: el esqueleto de carga no tiene ni una
  // letra, así que preguntarle enseguida contesta «no hay nada» sobre algo que
  // sí está. Se espera a que aparezca texto de verdad.
  await pagina.waitForFunction(() => document.body.innerText.trim().length > 200, {
    timeout: 30000,
  })

  mkdirSync(CAPTURAS, { recursive: true })
  await pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: true })
  console.log(`captura · ${join(CAPTURAS, `${nombre}.png`)}`)

  for (const selector of selectores) {
    const textos = await pagina.locator(selector).allTextContents()
    console.log(`\n${selector} → ${textos.length}`)
    for (const t of textos) {
      const limpio = t.replace(/\s+/g, ' ').trim()
      if (limpio) console.log(`  · ${limpio}`)
    }
  }
} finally {
  await navegador.close()
}

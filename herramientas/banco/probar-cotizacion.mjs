/**
 * El recorrido de una cotización con clic real: emitirla, bajarla en PDF,
 * anularla con motivo y volver a bajarla con el sello puesto.
 *
 * El recorrido general (recorrer.mjs) mira pantallas; esto mira lo que pasa
 * cuando alguien aprieta los botones. Se escribió porque el botón de descargar
 * documentos «funcionaba» en la revisión de código y no descargaba nada en el
 * navegador: hay cosas que solo se ven haciéndolas.
 *
 *   BANCO_CLAVE='la-que-quieras' node herramientas/banco/probar-cotizacion.mjs
 *
 * Termina con código distinto de cero si algo falló.
 */

import { chromium } from 'playwright-core'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BANCO_URL ?? 'http://localhost:3111'
const CORREO = process.env.BANCO_CORREO ?? 'studiogrci@gmail.com'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR =
  process.env.NAVEGADOR ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

if (!CLAVE) {
  console.error('Falta BANCO_CLAVE: la contraseña de la cuenta con la que se prueba.')
  process.exit(1)
}

const fallos = []
const carpeta = await mkdtemp(join(tmpdir(), 'cotizacion-'))

function comprobar(condicion, texto) {
  console.log(`${condicion ? '✔' : '✗'} ${texto}`)
  if (!condicion) fallos.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const contexto = await navegador.newContext({ acceptDownloads: true })
const pagina = await contexto.newPage()

const erroresConsola = []
pagina.on('console', (m) => m.type() === 'error' && erroresConsola.push(m.text()))
pagina.on('pageerror', (e) => erroresConsola.push(String(e)))

// ------------------------------------------------------------------ ingreso
await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
await pagina.fill('input[type="email"]', CORREO)
await pagina.fill('input[type="password"]', CLAVE)
await Promise.all([
  pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
  pagina.click('button[type="submit"]'),
])
await pagina.waitForLoadState('networkidle')

if (pagina.url().includes('/ingresar')) {
  console.error('No se pudo entrar con la cuenta indicada.')
  await navegador.close()
  process.exit(1)
}

// -------------------------------------------------------- emitir y descargar
await pagina.goto(`${BASE}/cotizaciones/nueva`, { waitUntil: 'networkidle' })
await pagina.selectOption('#cliente_id', { index: 1 })
await pagina.getByRole('button', { name: /Crear|Guardar|Emitir/i }).first().click()
await pagina.waitForTimeout(4000)

comprobar(
  /\/cotizaciones\/[0-9a-f-]{36}/.test(pagina.url()),
  'la cotización se emite y el sistema le pone número',
)

const titulo = await pagina.locator('h1').innerText()
comprobar(/Borrador/i.test(titulo), 'nace en borrador')

const [descarga] = await Promise.all([
  pagina.waitForEvent('download', { timeout: 45000 }),
  pagina.getByRole('link', { name: /Descargar cotización/i }).click(),
])
const archivo = join(carpeta, 'cotizacion.pdf')
await descarga.saveAs(archivo)

comprobar(descarga.suggestedFilename().startsWith('COT-'), 'el archivo baja con el nombre del documento')

// Al descargar un borrador, el documento sale al cliente.
await pagina.waitForTimeout(2500)
await pagina.reload({ waitUntil: 'networkidle' })
comprobar(
  /Enviada/i.test(await pagina.locator('h1').innerText()),
  'descargar un borrador lo deja marcado como enviado',
)

// ------------------------------------------------------------------- anular
await pagina.getByRole('button', { name: /Volver a borrador/i }).click()
await pagina.waitForTimeout(2500)
await pagina.getByRole('button', { name: /^Anular$/ }).click()
await pagina.waitForTimeout(600)

await pagina.getByRole('button', { name: 'Confirmar' }).click()
await pagina.waitForTimeout(1200)
comprobar(await pagina.locator('#motivo').isVisible(), 'sin motivo no se puede anular')

await pagina.fill('#motivo', 'Prueba automática del banco')
await pagina.getByRole('button', { name: 'Confirmar' }).click()
await pagina.waitForTimeout(3500)
await pagina.reload({ waitUntil: 'networkidle' })

comprobar(/Anulada/i.test(await pagina.locator('h1').innerText()), 'queda anulada')
comprobar(
  (await pagina.locator('body').innerText()).includes('Prueba automática del banco'),
  'el motivo queda a la vista',
)
comprobar(
  !(await pagina.getByRole('button', { name: /^Anular$/ }).isVisible().catch(() => false)),
  'una anulada ya no ofrece más cambios de estado',
)

const [descargaAnulada] = await Promise.all([
  pagina.waitForEvent('download', { timeout: 45000 }),
  pagina.getByRole('link', { name: /Descargar cotización/i }).click(),
])
await descargaAnulada.saveAs(join(carpeta, 'anulada.pdf'))
comprobar(true, 'la anulada se sigue pudiendo descargar como evidencia')

comprobar(erroresConsola.length === 0, `sin errores de consola${erroresConsola.length ? `: ${erroresConsola[0]}` : ''}`)

await navegador.close()

console.log(`\n${fallos.length === 0 ? 'Todo bien' : `${fallos.length} fallos`} · archivos en ${carpeta}`)
process.exit(fallos.length === 0 ? 0 : 1)

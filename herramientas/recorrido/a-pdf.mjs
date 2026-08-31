// Imprime una página HTML a PDF con el propio Chrome, en A4 y sin márgenes:
// la hoja ya trae los suyos. En esta máquina no hay otra forma de generar PDF.
//
//   node herramientas/recorrido/a-pdf.mjs <archivo.html> <salida.pdf>
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const [entrada, salida] = process.argv.slice(2)

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('no hay Chrome ni Edge')

// `page.pdf()` solo existe en Chromium sin cabeza; con `channel` abierto falla.
const navegador = await chromium.launch({ executablePath: exe, headless: true })
const pagina = await navegador.newPage()

await pagina.goto('file:///' + entrada.replace(/\\/g, '/'), { waitUntil: 'load' })
// Las fuentes del sistema y el fondo de la cabecera tardan un instante.
await pagina.waitForTimeout(800)

await pagina.pdf({
  path: salida,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
})

console.log(`pdf · ${salida}`)
await navegador.close()

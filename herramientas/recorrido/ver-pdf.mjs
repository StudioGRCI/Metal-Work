// Convierte un PDF en imágenes para poder mirarlo. En esta máquina no hay
// poppler, así que se usa el propio Chrome con pdf.js: la misma cañería que
// usa el navegador del cliente para ver el papel.
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const pdf = process.argv[2]
const salida = process.argv[3] ?? dirname(pdf)

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('no hay Chrome ni Edge')

const datos = readFileSync(pdf).toString('base64')

const navegador = await chromium.launch({ executablePath: exe })
const pagina = await navegador.newPage({ viewport: { width: 1000, height: 1400 } })

await pagina.setContent(`
  <body style="margin:0;background:#fff">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  </body>`)
await pagina.waitForFunction(() => typeof window.pdfjsLib !== 'undefined', { timeout: 30000 })

const cuantas = await pagina.evaluate(async (b64) => {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  window.__doc = await window.pdfjsLib.getDocument({ data: bytes }).promise
  return window.__doc.numPages
}, datos)

for (let n = 1; n <= cuantas; n++) {
  const png = await pagina.evaluate(async (n) => {
    const p = await window.__doc.getPage(n)
    const vista = p.getViewport({ scale: 1.6 })
    const lienzo = document.createElement('canvas')
    lienzo.width = vista.width
    lienzo.height = vista.height
    await p.render({ canvasContext: lienzo.getContext('2d'), viewport: vista }).promise
    return lienzo.toDataURL('image/png').split(',')[1]
  }, n)
  const ruta = join(salida, `papel-${n}.png`)
  writeFileSync(ruta, Buffer.from(png, 'base64'))
  console.log(ruta)
}

await navegador.close()

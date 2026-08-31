// Recorta un pedazo de una página de PDF a PNG, en alta resolución.
// Sirve para sacar un logo vectorial, que no se puede extraer como imagen.
//
//   node herramientas/recorrido/recortar-pdf.mjs <pdf> <salida.png> x1 y1 x2 y2 [escala]
//
// Las coordenadas van en fracción de la página (0 a 1), medidas desde arriba a
// la izquierda, para no depender del tamaño del papel.
//
// El recorte se hace dentro del lienzo y no con una captura: `locator.screenshot`
// ignora el `clip` y devuelve la página entera.
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [pdf, salida, x1, y1, x2, y2, escalaTxt] = process.argv.slice(2)
const escala = Number(escalaTxt ?? 4)
mkdirSync(dirname(salida), { recursive: true })

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('no hay Chrome ni Edge')

const datos = readFileSync(pdf).toString('base64')

const navegador = await chromium.launch({ executablePath: exe })
const pagina = await navegador.newPage({ viewport: { width: 900, height: 700 } })

await pagina.setContent(`
  <body style="margin:0;background:#fff">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  </body>`)
await pagina.waitForFunction(() => typeof window.pdfjsLib !== 'undefined', { timeout: 30000 })

const salidaB64 = await pagina.evaluate(
  async ({ b64, escala, r }) => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise
    const p = await doc.getPage(1)
    const vista = p.getViewport({ scale: escala })

    const hoja = document.createElement('canvas')
    hoja.width = vista.width
    hoja.height = vista.height
    await p.render({ canvasContext: hoja.getContext('2d'), viewport: vista }).promise

    const sx = Math.round(r.x1 * vista.width)
    const sy = Math.round(r.y1 * vista.height)
    const sw = Math.round((r.x2 - r.x1) * vista.width)
    const sh = Math.round((r.y2 - r.y1) * vista.height)

    const recorte = document.createElement('canvas')
    recorte.width = sw
    recorte.height = sh
    recorte.getContext('2d').drawImage(hoja, sx, sy, sw, sh, 0, 0, sw, sh)

    return { png: recorte.toDataURL('image/png').split(',')[1], sw, sh }
  },
  { b64: datos, escala, r: { x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) } },
)

writeFileSync(salida, Buffer.from(salidaB64.png, 'base64'))
console.log(`recorte ${salidaB64.sw}x${salidaB64.sh} · ${salida}`)

await navegador.close()

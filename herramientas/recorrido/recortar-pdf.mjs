// Recorta un pedazo de una página de PDF a PNG, en alta resolución.
// Sirve para sacar un logo vectorial, que no se puede extraer como imagen.
//
//   node herramientas/recorrido/recortar-pdf.mjs <pdf> <salida.png> x1 y1 x2 y2 [escala] [ajustar]
//
// Las coordenadas van en fracción de la página (0 a 1), desde arriba a la
// izquierda, para no depender del tamaño del papel.
//
// Con `ajustar`, la zona pedida es solo una red de pesca: después se recorta
// sola al contorno de la tinta. Adivinar coordenadas exactas de un logo a ojo
// sale mal —se corta un borde o sobra media pulgada de blanco— y el contorno
// real lo sabe la imagen, no yo.
//
// El recorte se hace dentro del lienzo y no con una captura: `locator.screenshot`
// ignora el `clip` y devuelve la página entera.
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [pdf, salida, x1, y1, x2, y2, escalaTxt, ajustarTxt] = process.argv.slice(2)
const escala = Number(escalaTxt ?? 4)
const ajustar = ajustarTxt === 'ajustar'
mkdirSync(dirname(salida), { recursive: true })

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('no hay Chrome ni Edge')

const datos = readFileSync(pdf).toString('base64')

const navegador = await chromium.launch({ executablePath: exe, headless: true })
const pagina = await navegador.newPage({ viewport: { width: 900, height: 700 } })

await pagina.setContent(`
  <body style="margin:0;background:#fff">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  </body>`)
await pagina.waitForFunction(() => typeof window.pdfjsLib !== 'undefined', { timeout: 30000 })

const r = await pagina.evaluate(
  async ({ b64, escala, zona, ajustar }) => {
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
    const ctx = hoja.getContext('2d')
    // Fondo blanco explícito: el PDF no lo pinta y el lienzo nace transparente,
    // así que sin esto el contorno de tinta abarcaría toda la zona.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, hoja.width, hoja.height)
    await p.render({ canvasContext: ctx, viewport: vista }).promise

    let sx = Math.round(zona.x1 * vista.width)
    let sy = Math.round(zona.y1 * vista.height)
    let sw = Math.round((zona.x2 - zona.x1) * vista.width)
    let sh = Math.round((zona.y2 - zona.y1) * vista.height)

    if (ajustar) {
      const d = ctx.getImageData(sx, sy, sw, sh).data
      let iz = sw, de = -1, ar = sh, ab = -1
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const i = (y * sw + x) * 4
          const luz = (d[i] + d[i + 1] + d[i + 2]) / 3
          if (luz > 245) continue
          if (x < iz) iz = x
          if (x > de) de = x
          if (y < ar) ar = y
          if (y > ab) ab = y
        }
      }
      if (de < 0) return { error: 'la zona pedida está en blanco' }
      const aire = Math.round(escala * 1.5)
      sx += Math.max(0, iz - aire)
      sy += Math.max(0, ar - aire)
      sw = Math.min(sw - Math.max(0, iz - aire), de - iz + 1 + aire * 2)
      sh = Math.min(sh - Math.max(0, ar - aire), ab - ar + 1 + aire * 2)
    }

    const recorte = document.createElement('canvas')
    recorte.width = sw
    recorte.height = sh
    const rc = recorte.getContext('2d')
    rc.fillStyle = '#fff'
    rc.fillRect(0, 0, sw, sh)
    rc.drawImage(hoja, sx, sy, sw, sh, 0, 0, sw, sh)

    return { png: recorte.toDataURL('image/png').split(',')[1], sw, sh }
  },
  {
    b64: datos,
    escala,
    ajustar,
    zona: { x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) },
  },
)

if (r.error) {
  console.error(r.error)
  await navegador.close()
  process.exit(1)
}

writeFileSync(salida, Buffer.from(r.png, 'base64'))
console.log(`recorte ${r.sw}x${r.sh} · ${salida}`)

await navegador.close()

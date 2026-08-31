// Comprueba que cada hoja de un documento HTML cabe en una página A4 al
// imprimir. Se mide a 794 px de ancho —210 mm a 96 dpi— porque a lo ancho de
// pantalla el texto ocupa menos alto y parece que entra cuando no entra.
//
//   node herramientas/recorrido/medir-hojas.mjs <archivo.html>
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('no hay Chrome ni Edge')

const nav = await chromium.launch({ executablePath: exe, headless: true })
const pag = await nav.newPage({ viewport: { width: 794, height: 1123 } })

await pag.goto('file:///' + process.argv[2].split('\\').join('/'), { waitUntil: 'load' })
await pag.emulateMedia({ media: 'print' })
await pag.waitForTimeout(500)

console.log(
  JSON.stringify(
    await pag.evaluate(() => {
      const mm = 96 / 25.4
      return {
        hojas: [...document.querySelectorAll('section.hoja')].map((s, i) => ({
          hoja: i + 1,
          altoMm: +(s.getBoundingClientRect().height / mm).toFixed(1),
          sobraMm: +(s.getBoundingClientRect().height / mm - 297).toFixed(1),
        })),
        imagenes: [...document.querySelectorAll('img')].map((l) => ({
          clase: l.className,
          anchoMm: +(l.getBoundingClientRect().width / mm).toFixed(1),
          cargada: l.complete && l.naturalWidth > 0,
        })),
      }
    }),
    null,
    1,
  ),
)

await nav.close()

/**
 * Lo que comparten los `capturar.mjs` de cada video: entrar al banco local con
 * la cuenta de prueba del puesto y tomar cada pantalla con el lugar exacto de
 * lo que se va a resaltar.
 *
 * Las capturas salen SIEMPRE del banco de pruebas (`herramientas/banco/`), con
 * las cuentas `*.local@metalwork.test` y los datos de demostración: nunca de
 * metalworkperu.app. Por eso `BASE` solo acepta una dirección local.
 *
 *   import { abrir } from '../../scripts/captura.mjs'
 *   const { pagina, tomar, cerrar } = await abrir({ video: import.meta.url, formato, cuenta: 'sup.mtz' })
 *   await tomar('02-unidad', { nuevo: pagina.getByRole('button', { name: 'Nuevo RQ para SR-101' }) })
 *
 * Cada `tomar` guarda `capturas/<formato>/<nombre>.png` y anota en
 * `capturas/<formato>/capturas.json` el tamaño de la pantalla y el recuadro de
 * cada resalte, en píxeles de CSS. La plantilla hace el zoom y dibuja el
 * recuadro con esos números: no se mide nada a ojo.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const FORMATOS = JSON.parse(readFileSync(join(AQUI, '..', 'src', 'plantilla', 'formatos.json'), 'utf8'))

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`BASE=${BASE} no es el banco local. Los videos se capturan solo en el banco de pruebas, nunca en producción.`)
  process.exit(2)
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE: la clave local con que se preparó el banco (herramientas/banco/preparar.sh).')
  process.exit(2)
}

/** El formato que se pidió por la línea de órdenes: `horizontal` o `vertical`. */
export function formatoPedido() {
  const formato = process.argv[2]
  if (!FORMATOS[formato]) {
    console.error(`Di el formato: ${Object.keys(FORMATOS).join(' o ')}.`)
    process.exit(2)
  }
  return formato
}

let navegador
async function elNavegador() {
  navegador ??= await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
  return navegador
}

/** Entra con la cuenta de prueba de un puesto, sin tomar nada: para lo que otro puesto hace fuera de cámara. */
export async function entrar(cuenta, formato = 'horizontal') {
  const f = FORMATOS[formato].captura
  const contexto = await (await elNavegador()).newContext({
    viewport: { width: f.ancho, height: f.alto },
    deviceScaleFactor: f.densidad,
    isMobile: f.telefono,
    hasTouch: f.telefono,
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const pagina = await contexto.newPage()
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', `${cuenta}.local@metalwork.test`)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }),
    pagina.click('button[type="submit"]'),
  ])
  await pagina.waitForLoadState('networkidle')
  return { pagina, contexto, ir: (ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' }) }
}

/**
 * Un PDF de una página con estas líneas de texto, para la tarea que pide subir
 * un documento. Es un documento inventado: lo que diga se escribe en el
 * `capturar.mjs` del video, nunca se copia de uno real.
 */
export function pdfConTexto(lineas) {
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = []
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/**
 * Entra con la cuenta del puesto del video y devuelve `tomar` para sus capturas.
 *
 * `montosInventados`: los montos que este video inventó y escribió él mismo en
 * el banco (una cotización de prueba no se entiende sin su total). La revisión
 * automática deja pasar esos y ninguno más; un RUC, un DNI, un teléfono o una
 * clave no se pueden declarar: no salen en pantalla.
 */
export async function abrir({ video, formato, cuenta, montosInventados = [] }) {
  const carpeta = join(dirname(fileURLToPath(video)), 'capturas', formato)
  mkdirSync(carpeta, { recursive: true })
  const f = FORMATOS[formato].captura
  const sesion = await entrar(cuenta, formato)
  // De dónde salieron: la revisión automática no deja pasar capturas que no sean del banco local.
  writeFileSync(join(carpeta, 'origen.json'), `${JSON.stringify({ base: BASE, cuenta: `${cuenta}.local@metalwork.test`, tomadas: new Date().toISOString(), montosInventados }, null, 2)}\n`)
  const { pagina } = sesion
  const tomadas = {}

  /**
   * Toma la pantalla como está. `resaltes` es `{ nombre: locator }`: lo que la
   * plantilla puede encuadrar y enmarcar. El primero se trae a la vista antes
   * de tomar —o `arriba`, si se da, se sube hasta debajo de la barra—; un
   * resalte que no se ve entero en la captura es un error, no un recuadro vacío.
   */
  async function tomar(nombre, resaltes = {}, { arriba } = {}) {
    const primero = Object.values(resaltes).map((lugar) => lugar.cenido ?? lugar)[0]
    if (arriba) {
      await arriba.evaluate((el) => {
        el.scrollIntoView({ block: 'start' })
        window.scrollBy(0, -76)
      })
    } else if (primero) await primero.scrollIntoViewIfNeeded()
    // El cursor de texto parpadea: sin él, dos corridas dan la misma imagen.
    await pagina.addStyleTag({ content: '*{caret-color:transparent!important}' }).catch(() => {})
    await pagina.waitForTimeout(350)
    const cajas = {}
    for (const [clave, lugar] of Object.entries(resaltes)) {
      const caja = lugar.cenido ? await cajaDelTexto(lugar.cenido.first()) : await lugar.first().boundingBox()
      if (!caja || caja.y < 0 || caja.y + caja.height > f.alto || caja.x < 0 || caja.x + caja.width > f.ancho) {
        throw new Error(`«${nombre}»: el resalte «${clave}» no se ve entero en la pantalla.`)
      }
      cajas[clave] = { x: Math.round(caja.x), y: Math.round(caja.y), ancho: Math.round(caja.width), alto: Math.round(caja.height) }
    }
    await pagina.screenshot({ path: join(carpeta, `${nombre}.png`) })
    tomadas[nombre] = { archivo: `${nombre}.png`, ancho: f.ancho, alto: f.alto, resaltes: cajas }
    writeFileSync(join(carpeta, 'capturas.json'), `${JSON.stringify(tomadas, null, 2)}\n`)
    console.log(`  ${formato} · ${nombre}${Object.keys(cajas).length ? ` (${Object.keys(cajas).join(', ')})` : ''}`)
  }

  return { ...sesion, tomar }
}

/**
 * Para resaltar solo lo escrito de un renglón que ocupa todo el ancho: con el
 * renglón entero, la cámara no se acerca y la letra queda chica.
 *
 *   await tomar('08-tarjeta', { unidades: cenido(tarjeta.getByText('3 unidades').locator('xpath=..')) })
 */
export const cenido = (lugar) => ({ cenido: lugar })

async function cajaDelTexto(lugar) {
  return lugar.evaluate((el) => {
    const cajas = []
    const camina = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let nodo = camina.nextNode(); nodo; nodo = camina.nextNode()) {
      if (!nodo.textContent.trim()) continue
      const rango = document.createRange()
      rango.selectNodeContents(nodo)
      cajas.push(...rango.getClientRects())
    }
    for (const dibujo of el.querySelectorAll('svg, img')) cajas.push(dibujo.getBoundingClientRect())
    const visibles = cajas.filter((c) => c.width > 0 && c.height > 0)
    if (!visibles.length) return null
    const margen = 6
    const x = Math.min(...visibles.map((c) => c.left)) - margen
    const y = Math.min(...visibles.map((c) => c.top)) - margen
    return { x, y, width: Math.max(...visibles.map((c) => c.right)) + margen - x, height: Math.max(...visibles.map((c) => c.bottom)) + margen - y }
  })
}

export async function cerrar() {
  await navegador?.close()
  navegador = undefined
}

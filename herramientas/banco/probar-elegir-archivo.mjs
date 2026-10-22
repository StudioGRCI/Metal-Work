/**
 * El campo para elegir un archivo (`ElegirArchivo`) dice en castellano qué
 * pide y qué se eligió. Antes era el `<input type="file">` del navegador:
 * «Choose File» y el nombre cortado a la mitad, sin decir que pedía un Excel
 * (DKS, 2026-10-21). Con la cuenta de RR. HH., en «Importar del Excel»:
 *
 *   1. Antes de elegir dice qué pide y hasta cuánto pesa, y no queda a la vista
 *      el botón del navegador.
 *   2. Sin archivo, «Leer y comprobar» no sale: el `required` sigue valiendo,
 *      y el globo dice «Falta el Excel de la planilla.», no «Please select a file.».
 *   3. Con el teclado, la caja lleva el anillo de foco de 3 px de todo control.
 *   4. Un .txt muestra su nombre entero y avisa que no es un Excel antes de
 *      enviar; al enviarlo, el servidor lo recibe y responde que no es un
 *      libro de Excel —el archivo viajó en el formulario—. Un .xlsx dañado
 *      vuelve con el motivo en castellano, no con el «invalid zip data» de la
 *      librería, y la caja se pone en rojo. Elegir otro borra ese rechazo.
 *   5. Un archivo que pasa de 5 MB avisa su peso antes de enviar.
 *   6. Cancelar y volver a abrir deja el campo como nuevo.
 *   7. En el teléfono y en el monitor, sin desbordar la ventana.
 *
 * Necesita una planilla en preparación en soles: si no hay, la crea a nombre
 * de RR. HH. («Banco: elegir archivo»).
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CORREO = 'rrhh.local@metalwork.test'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const NO_EXCEL = join(CAPTURAS, 'PLANILLA-OCTUBRE-2026-ESTO-NO-ES-UN-EXCEL-DE-VERDAD.txt')
writeFileSync(NO_EXCEL, 'Esto es texto, no un libro de Excel.\n')
const DANADO = join(CAPTURAS, 'planilla-danada.xlsx')
writeFileSync(DANADO, Buffer.concat([Buffer.from('PK'), Buffer.from('esto no es un zip')]))
const PESADO = join(CAPTURAS, 'planilla-pesada.xlsx')
writeFileSync(PESADO, Buffer.concat([Buffer.from('PK'), Buffer.alloc(6 * 1024 * 1024)]))

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const { rows: abiertas } = await base.query(`select id from public.planillas where estado = 'BORRADOR' and moneda = 'PEN' limit 1`)
if (abiertas.length === 0) {
  await base.query(`insert into public.planillas (tipo, periodo, moneda, observacion, registrado_por)
    values ('TALLER', date_trunc('month', now())::date, 'PEN', 'Banco: elegir archivo',
            (select id from auth.users where email = $1))`, [CORREO])
}
await base.end()

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  const movil = viewport.width < 500
  console.log(movil ? 'Teléfono, 390 × 844' : 'Monitor, 1440 × 900')
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  const acciones = []
  pagina.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) acciones.push(r.url())
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', CORREO)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${CORREO}`)
  await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })

  const ventana = () => pagina.getByRole('dialog')
  const caja = () => ventana().locator('#pl-excel').locator('xpath=..')
  const texto = async () => (await caja().innerText()).replace(/\s+/g, ' ').trim()
  const abrir = async () => {
    await pagina.getByRole('button', { name: /importar del excel/i }).first().click()
    await ventana().waitFor()
    await pagina.waitForTimeout(300)
  }

  // 1. Qué pide, antes de elegir.
  await abrir()
  const antes = await texto()
  console.log(`     antes: «${antes}»`)
  comprobar(antes.includes('Elegir el Excel de la planilla'), 'dice qué pide: «Elegir el Excel de la planilla»')
  comprobar(antes.includes('Solo Excel (.xlsx), hasta 5 MB'), 'dice el formato y el tope: «Solo Excel (.xlsx), hasta 5 MB»')
  const campo = ventana().locator('#pl-excel')
  comprobar(await campo.evaluate((e) => getComputedStyle(e).opacity === '0'), 'el botón del navegador («Choose File») no se ve')
  // Por dentro del borde de 1 px: `inset-0` mide desde ahí.
  const tapa = await campo.evaluate((e) => {
    const a = e.getBoundingClientRect(), c = e.parentElement.getBoundingClientRect()
    return { ancho: c.width - a.width, alto: c.height - a.height }
  })
  comprobar(tapa.ancho <= 2 && tapa.alto <= 2, `el campo de verdad tapa toda la caja: se toca en cualquier parte (le faltan ${tapa.ancho} × ${tapa.alto} px, el borde)`)
  const nombreAccesible = await campo.evaluate((e) => [...e.labels].map((l) => l.textContent.trim()).join(' '))
  comprobar(nombreAccesible.startsWith('Excel de la planilla del mes'), `el lector de pantalla lo nombra por su etiqueta («${nombreAccesible}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, `elegir-archivo-1-antes-${viewport.width}.png`) })

  // 2. Sin archivo no se envía.
  const enviadasAntes = acciones.length
  await ventana().getByRole('button', { name: /leer y comprobar/i }).click()
  await pagina.waitForTimeout(500)
  comprobar(acciones.length === enviadasAntes, 'sin archivo, «Leer y comprobar» no llega al servidor')
  comprobar(await campo.evaluate((e) => e.validity.valueMissing), 'y el navegador lo marca como obligatorio')
  const globo = await campo.evaluate((e) => e.validationMessage)
  comprobar(globo === 'Falta el Excel de la planilla.', `el globo de obligatorio está en castellano («${globo}»)`)

  // 3. El foco con el teclado se ve en la caja.
  await ventana().getByRole('button', { name: /^cancelar$/i }).focus()
  await pagina.keyboard.press('Shift+Tab')
  const foco = await campo.evaluate((e) => {
    const s = getComputedStyle(e.parentElement)
    return { enfocado: document.activeElement === e, ancho: s.outlineWidth, estilo: s.outlineStyle }
  })
  comprobar(foco.enfocado && foco.ancho === '3px' && foco.estilo === 'solid', `con el teclado, la caja lleva el anillo de 3 px (${foco.ancho} ${foco.estilo})`)

  // 4. Un archivo que no es Excel.
  await campo.setInputFiles(NO_EXCEL)
  await pagina.waitForTimeout(200)
  const conTxt = await texto()
  console.log(`     con el .txt: «${conTxt}»`)
  comprobar(conTxt.includes('PLANILLA-OCTUBRE-2026-ESTO-NO-ES-UN-EXCEL-DE-VERDAD.txt'), 'muestra el nombre entero del archivo')
  comprobar(conTxt.includes('No es un Excel (.xlsx)'), 'avisa que no es un Excel antes de enviar')
  await pagina.screenshot({ path: join(CAPTURAS, `elegir-archivo-2-no-es-excel-${viewport.width}.png`) })
  await ventana().getByRole('button', { name: /leer y comprobar/i }).click()
  const alerta = ventana().locator('p[role="alert"]')
  await alerta.waitFor({ timeout: 30000 }).catch(() => {})
  const error = (await alerta.innerText().catch(() => '')).trim()
  console.log(`     el servidor: «${error}»`)
  comprobar(/no es un libro de Excel/i.test(error), 'el archivo viajó: el servidor responde que no es un libro de Excel')
  comprobar(await campo.evaluate((e) => e.files.length === 1), 'tras el rechazo el archivo sigue elegido')
  comprobar(await campo.getAttribute('aria-invalid') === 'true', 'y el campo queda marcado como inválido para el lector')

  // Un .xlsx dañado: el servidor lo rechaza en castellano y la caja no queda en verde.
  await campo.setInputFiles(DANADO)
  await ventana().getByRole('button', { name: /leer y comprobar/i }).click()
  await pagina.waitForFunction(() => /No se pudo leer|no es un libro|invalid/i.test(document.querySelector('[role="dialog"] p[role="alert"]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {})
  const danado = (await alerta.innerText().catch(() => '')).trim()
  console.log(`     el servidor, con el dañado: «${danado}»`)
  comprobar(danado.startsWith('No se pudo leer el Excel'), 'un .xlsx dañado vuelve con el motivo en castellano')
  comprobar(await campo.getAttribute('aria-invalid') === 'true', 'y la caja queda marcada como inválida, no en verde')

  // 5. Uno que pasa del tope; elegirlo borra el rechazo del anterior.
  await campo.setInputFiles(PESADO)
  await pagina.waitForTimeout(200)
  comprobar(await alerta.count() === 0, 'al elegir otro archivo se va el rechazo del anterior')
  const conPesado = await texto()
  console.log(`     con el pesado: «${conPesado}»`)
  comprobar(/Pesa 6\.0 MB y el tope es 5 MB/.test(conPesado), 'avisa el peso de uno que pasa de 5 MB')

  // 6. Cancelar y volver a abrir.
  await ventana().getByRole('button', { name: /^cancelar$/i }).click()
  await ventana().waitFor({ state: 'detached' })
  await abrir()
  const reabierta = await texto()
  comprobar(reabierta === antes, `al volver a abrir queda como nuevo («${reabierta}»)`)
  comprobar(await ventana().locator('#pl-excel').evaluate((e) => e.files.length === 0), 'y sin archivo elegido')

  // 7. Sin desbordar.
  const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  comprobar(desborde <= 0, `la página no se desborda a lo ancho (${desborde} px)`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

await navegador.close()
if (fallas.length) {
  console.log(`\n${fallas.length} falla(s).`)
  process.exit(1)
}
console.log('\nTodo bien.')

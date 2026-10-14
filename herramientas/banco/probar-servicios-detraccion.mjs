/**
 * Clic real sobre la orden de servicio con código interno y detracción
 * (migración 20261015141000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Logística emite tres OS: una de S/ 1,000 sin IGV de fabricación por
 *      encargo (10 %: se depositan S/ 118), otra de S/ 500 que no pasa de
 *      S/ 700 con IGV, y otra no sujeta, que no entra sin su motivo. El
 *      formulario dice la detracción antes de guardar; la fila, después.
 *   2. Logística busca por código interno, escrito en minúsculas.
 *   3. Gerencia ve el código y la detracción en la bandeja de aprobación, y
 *      las OS en los documentos del código en «Códigos internos».
 *   4. Contabilidad tiene «Órdenes de servicio» en su menú, no emite ni cambia
 *      el código, y corrige la detracción; en el teléfono la fila dice el código.
 *   5. Un supervisor no abre la pantalla.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111) y los correos de cada
 * cuenta si no son `*@local.test`.
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  logistica: process.env.LOGISTICA ?? 'comprador@local.test',
  gerencia: process.env.GERENCIA ?? 'gerente@local.test',
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad@local.test',
  supervisor: process.env.SUPERVISOR ?? 'supervisor@local.test',
}
const CODIGO = 'PLA_SR_O4_1_26/28'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
const fila = (pagina, numero) => pagina.locator(`tr[data-servicio="${numero}"]`)

/** Llena la OS y devuelve el texto de la detracción que muestra el formulario antes de guardar. */
async function emitir(pagina, { codigo, monto, detraccion, motivo, descripcion }) {
  await pagina.getByRole('button', { name: 'Nueva orden de servicio' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#os-proveedor').click()
  await pagina.locator('[role="option"]').first().click()
  await ventana.locator('#os-descripcion').fill(descripcion)
  if (codigo) await ventana.locator('#os-codigo').fill(codigo)
  await ventana.locator('#os-monto').fill(String(monto))
  await ventana.locator('#os-detraccion').selectOption(detraccion)
  if (motivo) await ventana.locator('#os-detraccion-motivo').fill(motivo)
  const previa = await ventana
    .locator('[data-detraccion]')
    .innerText()
    .catch(() => '')
  return { ventana, previa: previa.replace(/\s+/g, ' ') }
}

async function guardar(pagina, ventana) {
  await ventana.getByRole('button', { name: 'Emitir orden de servicio' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  const aviso = await pagina.locator('[role="status"]').first().innerText()
  return (aviso.match(/OS-\d+-MW/) ?? [''])[0]
}

let os1 = ''
let os2 = ''
let os3 = ''
// Las OS que el código ya tenía de una corrida anterior: la prueba cuenta las dos nuevas encima.
let previas = 0

// ============================================ 1 y 2. Logística emite y busca
{
  const { pagina, errores } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/servicios?codigo=${encodeURIComponent(CODIGO)}`, { waitUntil: 'networkidle' })
  previas = await pagina.locator('tr[data-servicio]').count()
  await pagina.goto(`${BASE}/compras/servicios`, { waitUntil: 'networkidle' })

  let r = await emitir(pagina, {
    codigo: CODIGO,
    monto: 1000,
    detraccion: '025',
    descripcion: 'Torneado de 4 ejes de 2 in con el material que entrega Metal Work',
  })
  comprobar(r.previa.includes('S/ 1,180.00') && r.previa.includes('S/ 118.00'), `el formulario anticipa la detracción: «${r.previa}»`)
  os1 = await guardar(pagina, r.ventana)
  await pagina.waitForTimeout(500)
  let t = await texto(fila(pagina, os1))
  comprobar(os1 !== '' && t.includes(CODIGO) && t.includes('Detracción 10 %: S/ 118.00'), `${os1}: código y detracción de S/ 118 en la fila`)

  r = await emitir(pagina, { codigo: CODIGO, monto: 500, detraccion: '037', descripcion: 'Pintura del guardafango derecho, una mano' })
  comprobar(r.previa.includes('no pasa de S/ 700.00'), `la de S/ 500 no llega al mínimo: «${r.previa}»`)
  os2 = await guardar(pagina, r.ventana)
  await pagina.waitForTimeout(500)
  t = await texto(fila(pagina, os2))
  comprobar(t.includes('Sin detracción: no pasa de S/ 700.00') && t.includes('037'), `${os2}: sin detracción y con su tipo`)

  // No sujeta sin motivo: el navegador no deja enviar.
  r = await emitir(pagina, { codigo: 'PLANTA', monto: 2000, detraccion: 'NO_SUJETA', descripcion: 'Traslado de la plataforma a la planta del cliente' })
  await r.ventana.getByRole('button', { name: 'Emitir orden de servicio' }).click()
  await pagina.waitForTimeout(800)
  comprobar(await r.ventana.isVisible(), 'no sujeta sin motivo no se envía')
  await r.ventana.locator('#os-detraccion-motivo').fill('El transportista no cobra IGV: está en el RUS')
  os3 = await guardar(pagina, r.ventana)
  await pagina.waitForTimeout(500)
  t = await texto(fila(pagina, os3))
  comprobar(t.includes('No sujeta a detracción') && t.includes('RUS') && t.includes('PLANTA'), `${os3}: no sujeta con su motivo`)

  // Sin código interno tampoco: el campo es obligatorio.
  r = await emitir(pagina, { codigo: '', monto: 300, detraccion: '025', descripcion: 'Doblado de dos planchas de 3 mm según plano' })
  await r.ventana.getByRole('button', { name: 'Emitir orden de servicio' }).click()
  await pagina.waitForTimeout(800)
  comprobar(await r.ventana.isVisible(), 'sin código interno no se envía')
  await r.ventana.getByRole('button', { name: 'Cerrar' }).first().click().catch(() => pagina.keyboard.press('Escape'))

  await pagina.goto(`${BASE}/compras/servicios?codigo=${encodeURIComponent('pla_sr_o4_1_26/28')}`, { waitUntil: 'networkidle' })
  const filas = await pagina.locator('tr[data-servicio]').count()
  comprobar(filas === previas + 2 && (await fila(pagina, os3).count()) === 0, `buscar el código en minúsculas trae sus 2 OS nuevas (trajo ${filas}, ya tenía ${previas})`)
  comprobar((await fila(pagina, os1).getByRole('button', { name: 'Código y detracción' }).count()) === 1, 'Logística corrige código y detracción')
  await pagina.screenshot({ path: `${CAPTURAS}/servicios-logistica.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Logística${errores.length ? `: ${errores[0]}` : ''}`)
}

// ============================================ 3. Gerencia: aprobación y Códigos internos
{
  const { pagina, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  const t = await texto(pagina.locator('main'))
  const carta = t.slice(t.indexOf(`${os1} ·`), t.indexOf('Rechazar', t.indexOf(`${os1} ·`)))
  comprobar(carta.includes('Detracción 10 %: S/ 118.00'), 'en la bandeja, la OS dice su detracción')
  comprobar(carta.includes(`Para ${CODIGO}`), 'en la bandeja, la OS dice su código interno')

  await pagina.goto(`${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent(CODIGO)}&vista=documentos`, { waitUntil: 'networkidle' })
  const servicios = pagina.locator('[data-tipo="SERVICIO"]')
  const ts = await texto(servicios)
  comprobar(ts.includes(`Órdenes de servicio (${previas + 2})`) && ts.includes(os1) && ts.includes(os2) && ts.includes('Por aprobar'), `Códigos internos lista las 2 OS del código: «${ts.slice(0, 160)}»`)
  comprobar((await texto(pagina.locator('main'))).includes(`${previas + 2} OS`), `el código dice que aparece en ${previas + 2} OS`)
  await pagina.screenshot({ path: `${CAPTURAS}/servicios-codigo.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Gerencia${errores.length ? `: ${errores[0]}` : ''}`)
}

// ============================================ 4. Contabilidad corrige la detracción
{
  const { pagina, errores } = await entrar(CUENTAS.contabilidad)
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('nav a[href="/compras/servicios"]').count()) > 0, 'Contabilidad tiene «Órdenes de servicio» en su menú')
  await pagina.goto(`${BASE}/compras/servicios`, { waitUntil: 'networkidle' })
  comprobar((await pagina.getByRole('button', { name: 'Nueva orden de servicio' }).count()) === 0, 'Contabilidad no emite')
  comprobar((await fila(pagina, os2).getByRole('button', { name: 'Código y detracción' }).count()) === 0, 'Contabilidad no cambia el código')

  await fila(pagina, os2).getByRole('button', { name: 'Detracción' }).click()
  let ventana = pagina.locator('[role="dialog"]')
  comprobar((await ventana.locator('#os-detraccion-' + (await ventana.locator('input[name="id"]').inputValue())).inputValue()) === '037', 'el diálogo abre con el tipo que tiene')
  await ventana.locator('select[name="detraccion"]').selectOption('020')
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  await fila(pagina, os2).getByText(/^020 ·/).first().waitFor({ timeout: 10000 }).catch(() => {})
  let t = await texto(fila(pagina, os2))
  comprobar(t.includes('020') && t.includes('12 %') && t.includes('Sin detracción'), `Contabilidad cambia el tipo de ${os2}: «${t.slice(-140)}»`)

  await fila(pagina, os1).getByRole('button', { name: 'Detracción' }).click()
  ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('select[name="detraccion"]').selectOption('NO_SUJETA')
  await ventana.locator('input[name="motivo_detraccion"]').fill('El servicio se prestó fuera del país')
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  await fila(pagina, os1).getByText('No sujeta a detracción').first().waitFor({ timeout: 10000 }).catch(() => {})
  t = await texto(fila(pagina, os1))
  comprobar(t.includes('No sujeta a detracción') && t.includes('fuera del país'), `Contabilidad marca ${os1} como no sujeta`)
  comprobar(errores.length === 0, `sin errores de consola como Contabilidad${errores.length ? `: ${errores[0]}` : ''}`)

  const telefono = await entrar(CUENTAS.contabilidad, 390)
  await telefono.pagina.goto(`${BASE}/compras/servicios`, { waitUntil: 'networkidle' })
  const codigoMovil = telefono.pagina.locator(`tr[data-servicio="${os2}"] [data-codigo]`)
  comprobar((await codigoMovil.isVisible()) && (await codigoMovil.innerText()).includes(CODIGO), 'en el teléfono la fila dice el código interno')
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `sin desborde lateral en el teléfono (${ancho}px)`)
  await telefono.pagina.screenshot({ path: `${CAPTURAS}/servicios-contabilidad-telefono.png`, fullPage: true })
}

// ============================================ 5. Un supervisor no entra
{
  const { pagina } = await entrar(CUENTAS.supervisor)
  await pagina.goto(`${BASE}/compras/servicios`, { waitUntil: 'networkidle' })
  comprobar(!pagina.url().endsWith('/compras/servicios'), `un supervisor no abre las órdenes de servicio (${new URL(pagina.url()).pathname})`)
}

await navegador.close()
console.log(fallas.length ? `\n${fallas.length} falla(s)` : '\nTodo en verde')
process.exit(fallas.length ? 1 : 0)

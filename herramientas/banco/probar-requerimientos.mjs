/**
 * Recorre con clic real lo del área de Requerimientos, con la cuenta de cada
 * puesto (nunca ADMIN):
 *
 *   1. Requerimientos registra un RQ con dos insumos y lo ve en su lista.
 *   2. Logística ve el RQ por atender, sin el botón de registrar.
 *
 * Los vehículos, que desde el 2026-10-15 entran y salen con fotos, los recorre
 * `probar-gasto-y-fotos.mjs`.
 *
 * Variables: BANCO_CLAVE (la clave local de las cuentas), BASE
 * (http://localhost:3111), y los correos REQUERIMIENTOS y LOGISTICA
 * si no son los de `*.local@metalwork.test`.
 */
import { chromium } from 'playwright-core'

import { escribirCodigo } from './campo-codigo.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } })
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

const sello = Date.now().toString().slice(-6)
const codigo = `PLA_SR_O4_1_26/${sello.slice(-2)}`

// ------------------------------------------------ 1. Requerimientos: el RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  const menu = await pagina.locator('nav a[href="/requerimientos"], nav a[href="/vehiculos"]').count()
  comprobar(menu >= 2, `el menú de Requerimientos trae RQ y Vehículos (${menu} enlaces)`)

  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const filasRq = pagina.locator('tbody tr', { hasText: /RQ-\d/ })
  const antes = await filasRq.count()
  await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-area').selectOption({ label: 'Maestranza' })
  await escribirCodigo(ventana.locator('#rq-codigo'), codigo)
  await ventana.locator('#rq-justificacion').fill('Armado del chasis de la plataforma; no hay planchas en almacén.')
  // Primer insumo
  const descs = ventana.locator('input[name="descripcion"]')
  await descs.nth(0).fill('Plancha LAF 2 mm 4x8')
  await ventana.locator('input[name="cantidad"]').nth(0).fill('3')
  await ventana.locator('select[name="categoria_id"]').nth(0).selectOption({ index: 1 })
  // Segundo insumo
  await ventana.getByRole('button', { name: 'Agregar insumo' }).click()
  await descs.nth(1).fill('Soldadura MIG 0.9 mm')
  await ventana.locator('input[name="cantidad"]').nth(1).fill('12.5')
  await ventana.locator('select[name="unidad_medida_id"]').nth(1).selectOption({ label: 'KG' })
  await ventana.locator('select[name="categoria_id"]').nth(1).selectOption({ index: 2 })
  // Tres toques: un solo RQ.
  const enviar = ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' })
  await enviar.click()
  await enviar.click({ timeout: 1000 }).catch(() => {})
  await enviar.click({ timeout: 1000 }).catch(() => {})
  await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().waitFor({ timeout: 20000 })
  const aviso = await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().innerText()
  comprobar(/Requerimiento RQ-\d{4}-\d{4} registrado/.test(aviso), `aviso: «${aviso}»`)
  await filasRq.nth(antes).waitFor({ timeout: 20000 })
  // Un momento más por si un segundo envío colado tardara en pintarse.
  await pagina.waitForTimeout(1500)
  const despues = await filasRq.count()
  comprobar(despues === antes + 1, `la lista suma un solo RQ aunque se tocó tres veces (${antes} → ${despues})`)
  const fila = await pagina.locator('tbody tr').first().innerText()
  comprobar(fila.includes(codigo) && fila.includes('Maestranza') && fila.includes('Plancha LAF') && fila.includes('Soldadura MIG') && fila.includes('Por atender'),
    `la fila trae código, área, los dos insumos y «Por atender»: ${fila.replace(/\s+/g, ' ').slice(0, 220)}`)
  await pagina.screenshot({ path: `${CAPTURAS}/requerimientos.png`, fullPage: true })

  // El ingreso y la salida de vehículos, con sus fotos, los recorre
  // `probar-gasto-y-fotos.mjs` desde el 2026-10-15.
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 2. Logística
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.count()) === 1, 'Logística ve el RQ recién registrado')
  comprobar((await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).count()) === 0, 'Logística no tiene «Nuevo requerimiento»')
  comprobar((await fila.getByRole('button', { name: 'Anular' }).count()) === 0, 'ni «Anular»')
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes('Requerimiento por atender'), 'a Logística le llegó el aviso')
  comprobar(errores.length === 0, `sin errores de consola como Logística ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: RQ con clic real.')

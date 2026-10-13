/**
 * Recorre con clic real el circuito del RQ después de emitido, con la cuenta
 * de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos registra un RQ; su menú tiene «Requerimientos» y «Vehículos».
 *   2. Almacén lo ve en «Atención de requerimiento» y lo marca sin stock.
 *   3. Logística lo ve sin stock y lo marca en compra; su menú arranca por Atención.
 *   4. Almacén lo deja listo en almacén y lo entrega; pasa al historial.
 *   5. El supervisor del área ve el RQ en Requerimientos, sin botones.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111) y los correos
 * REQUERIMIENTOS, ALMACEN, LOGISTICA y SUPERVISOR si no son `*.local@metalwork.test`.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  almacen: process.env.ALMACEN ?? 'almacen.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
  supervisor: process.env.SUPERVISOR ?? 'supervisor.local@metalwork.test',
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

/** Los títulos de grupo del menú y, por grupo, sus entradas. */
async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim()) })),
  )
}

/** Abre la ventana del paso y la manda con la nota. */
async function paso(pagina, fila, boton, nota) {
  await fila.getByRole('button', { name: boton, exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  if (nota) await v.locator('textarea[name="nota"]').fill(nota)
  await v.getByRole('button', { name: /Marcar|Dejar listo|Registrar entrega/ }).click()
  await v.waitFor({ state: 'detached', timeout: 20000 })
  await pagina.waitForTimeout(800)
}

const sello = Date.now().toString().slice(-6)
const codigo = `PLA_SR_O4_1_26/${sello.slice(-2)}`

// ------------------------------------------------ 1. Requerimientos emite
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  const m = await menu(pagina)
  const req = m.find((g) => g.grupo === 'Requerimientos')
  comprobar(req && req.items.join(',') === 'Requerimientos,Vehículos', `menú de Requerimientos: ${JSON.stringify(req?.items)}`)
  // Hereda el kardex de Costos (almacen.ver), pero la bandeja de atención no es suya.
  comprobar(!m.some((g) => g.items.includes('Atención de requerimiento')), 'Requerimientos no ve «Atención de requerimiento»')

  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-area').selectOption({ label: 'Maestranza' })
  await ventana.locator('#rq-codigo').fill(codigo)
  await ventana.locator('#rq-justificacion').fill('Armado del chasis de la plataforma; no hay planchas en almacén.')
  await ventana.locator('input[name="descripcion"]').first().fill('Plancha LAF 2 mm 4x8')
  await ventana.locator('input[name="cantidad"]').first().fill('3')
  await ventana.locator('select[name="categoria_id"]').first().selectOption({ index: 1 })
  await ventana.getByRole('button', { name: 'Registrar y mandar a Logística' }).click()
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  await fila.waitFor({ timeout: 20000 })
  comprobar((await fila.innerText()).includes('Por revisar'), 'el RQ nace «Por revisar» (Almacén)')
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 2. Almacén: sin stock
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  const m = await menu(pagina)
  const alm = m.find((g) => g.grupo === 'Almacén')
  comprobar(alm && alm.items[0] === 'Atención de requerimiento', `menú de Almacén arranca por Atención: ${JSON.stringify(alm?.items)}`)
  comprobar(!m.some((g) => g.grupo === 'Requerimientos'), 'Almacén no ve el grupo de Requerimientos')
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes('Requerimiento por revisar'), 'a Almacén le llegó el aviso de revisar')

  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.count()) === 1, 'Almacén ve el RQ por atender')
  comprobar((await fila.getByRole('button', { name: 'Listo en almacén' }).count()) === 1 && (await fila.getByRole('button', { name: 'Sin stock' }).count()) === 1,
    'con los botones «Listo en almacén» y «Sin stock»')
  await paso(pagina, fila, 'Sin stock', 'No queda plancha de 2 mm')
  comprobar((await pagina.locator('tbody tr', { hasText: codigo }).innerText()).includes('Sin stock'), 'queda «Sin stock»')
  await pagina.screenshot({ path: `${CAPTURAS}/atencion-almacen.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 3. Logística: en compra
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  const m = await menu(pagina)
  const log = m.find((g) => g.grupo === 'Logística')
  comprobar(log && log.items[0] === 'Atención de requerimiento' && log.items.includes('Órdenes de compra'), `menú de Logística: ${JSON.stringify(log?.items)}`)
  comprobar(!m.some((g) => g.grupo === 'Requerimientos'), 'Logística no ve el grupo de Requerimientos')
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes('Requerimiento sin stock'), 'a Logística le llegó el aviso de sin stock')

  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.getByRole('button', { name: 'Lo estoy comprando' }).count()) === 1, 'Logística tiene «Lo estoy comprando»')
  comprobar((await fila.getByRole('button', { name: 'Listo en almacén' }).count()) === 0, 'y no los botones de Almacén')
  await paso(pagina, fila, 'Lo estoy comprando', 'Cotizando con Aceros Arequipa')
  comprobar((await pagina.locator('tbody tr', { hasText: codigo }).innerText()).includes('En compra'), 'queda «En compra»')
  comprobar(errores.length === 0, `sin errores de consola como Logística ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Almacén: recepciona y entrega
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  let fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.getByRole('button', { name: 'Listo en almacén' }).count()) === 1, 'en compra, Almacén puede dejarlo listo')
  await paso(pagina, fila, 'Listo en almacén', 'Llegó con el conductor, 3 planchas')
  fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.innerText()).includes('Listo en almacén'), 'queda «Listo en almacén»')
  await paso(pagina, fila, 'Entregado', 'Supervisor de Maestranza')
  await pagina.locator('tbody tr', { hasText: codigo }).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  comprobar((await pagina.locator('tbody tr', { hasText: codigo }).count()) === 0, 'entregado, sale de «Por atender»')
  await pagina.goto(`${BASE}/requerimientos/atencion?vista=todos`, { waitUntil: 'networkidle' })
  const hist = await pagina.locator('tbody tr', { hasText: codigo }).innerText()
  comprobar(hist.includes('Entregado') && hist.includes('Supervisor de Maestranza'), `en el historial, entregado: ${hist.replace(/\s+/g, ' ').slice(0, 160)}`)
  await pagina.screenshot({ path: `${CAPTURAS}/atencion-historial.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Almacén (entrega) ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 5. Supervisión solo mira
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.supervisor)
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes('Listo en almacén'), 'al supervisor de Maestranza le llegó «Listo en almacén»')
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.count()) === 1, 'el supervisor ve el RQ')
  comprobar((await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).count()) === 0 && (await fila.getByRole('button').count()) === 0, 'sin botones')
  comprobar(errores.length === 0, `sin errores de consola como Supervisión ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: el circuito del RQ con clic real.')

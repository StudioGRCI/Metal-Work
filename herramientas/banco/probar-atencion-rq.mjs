/**
 * Recorre con clic real el circuito del RQ después de emitido, con la cuenta
 * de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos registra un RQ; su menú tiene «Requerimientos» y «Vehículos», y el gasto en «Consultas».
 *   2. Almacén lo ve en «Atención de requerimiento» y revisa el stock: no tiene nada.
 *      A Requerimientos le llega «Por comprar» (DKS, 26/10/2026).
 *   3. Logística lo ve por comprar y lo marca en compra; su menú arranca por Atención.
 *   4. Almacén lo deja listo en almacén y lo entrega con faltante (no hay salida
 *      en el kardex de un material nuevo sin stock); pasa al historial.
 *   5. El supervisor del área ve el RQ en Requerimientos, sin botones.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111) y los correos
 * REQUERIMIENTOS, ALMACEN, LOGISTICA y SUPERVISOR si no son `*.local@metalwork.test`.
 */
import { chromium } from 'playwright-core'

import { escribirCodigo } from './campo-codigo.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  almacen: process.env.ALMACEN ?? 'almacen.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
  supervisor: process.env.SUPERVISOR ?? 'sup.mtz.local@metalwork.test', // el del área del RQ: Maestranza
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
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim().replace(/\d+$/, '')) })),
  )
}

/**
 * Espera a que la fila deje de decir lo que decía antes del paso. Cada paso
 * revalida la bandeja en el servidor, y con muchas filas eso pasa del segundo
 * (2,8 s en el banco del hilo con 113 RQ): una espera fija de 800 ms daba un
 * FALLA que no era del código. Si la fila sale de la vista, también vale.
 */
async function esperarFila(pagina, fila, antes) {
  for (let i = 0; i < 80; i++) {
    const ahora = await fila.innerText().catch(() => null)
    if (ahora === null || ahora !== antes) return
    await pagina.waitForTimeout(250)
  }
}

/** Abre la ventana del paso y la manda con la nota. */
async function paso(pagina, fila, boton, nota) {
  const antes = await fila.innerText().catch(() => null)
  await fila.getByRole('button', { name: boton, exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  if (nota) await v.locator('textarea[name="nota"]').fill(nota)
  await v.getByRole('button', { name: /Marcar|Dejar listo|Registrar entrega/ }).click()
  await v.waitFor({ state: 'detached', timeout: 20000 })
  await esperarFila(pagina, fila, antes)
}

/**
 * «Revisar stock» del RQ: anota cuánto tiene Almacén de cada insumo. `todo` y
 * `nada` usan los atajos de la ventana; un arreglo pone cada cantidad a mano.
 */
async function revisarStock(pagina, fila, cuanto, nota) {
  const antes = await fila.innerText().catch(() => null)
  await fila.getByRole('button', { name: 'Revisar stock' }).click()
  const v = pagina.locator('[role="dialog"]')
  if (cuanto === 'todo') await v.getByRole('button', { name: 'Tengo todo' }).click()
  else if (cuanto === 'nada') await v.getByRole('button', { name: 'No tengo nada' }).click()
  else for (const [i, c] of cuanto.entries()) await v.locator('input[type="number"]').nth(i).fill(String(c))
  if (nota) await v.locator('textarea[name="nota"]').fill(nota)
  await v.getByRole('button', { name: 'Guardar la revisión' }).click()
  await v.waitFor({ state: 'detached', timeout: 20000 })
  await esperarFila(pagina, fila, antes)
}

const sello = Date.now().toString().slice(-6)
const codigo = `PLA_SR_O4_1_26/${sello.slice(-2)}`

// ------------------------------------------------ 1. Requerimientos emite
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  const m = await menu(pagina)
  const req = m.find((g) => g.grupo === 'Requerimientos')
  comprobar(req && req.items.join(',') === 'Requerimientos,Vehículos', `menú de Requerimientos: ${JSON.stringify(req?.items)}`)
  // El gasto por código es una consulta: va con el stock en «Consultas».
  comprobar(m.find((g) => g.grupo === 'Consultas')?.items.includes('Gasto por código interno'), 'el gasto por código está en «Consultas»')
  // Hereda el kardex de Costos (almacen.ver), pero la bandeja de atención no es suya.
  comprobar(!m.some((g) => g.items.includes('Atención de requerimiento')), 'Requerimientos no ve «Atención de requerimiento»')

  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-area').selectOption({ label: 'Maestranza' })
  await escribirCodigo(ventana.locator('#rq-codigo'), codigo)
  await ventana.locator('#rq-justificacion').fill('Armado del chasis de la plataforma; no hay planchas en almacén.')
  // Desde #98 el insumo se elige del catálogo de Almacén; este es inventado, así
  // que se pide como material nuevo, como en probar-dos-requerimientos.
  await ventana.getByRole('button', { name: 'Pedirlo como material nuevo' }).click()
  await ventana.locator('[id^="rq-desc-"]').fill('Plancha LAF 2 mm 4x8')
  await ventana.locator('[id^="rq-cant-"]').fill('3')
  await ventana.locator('[id^="rq-cat-"]').selectOption({ index: 1 })
  await ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })
  const fila = pagina.locator('[data-rq]', { hasText: codigo })
  await fila.waitFor({ timeout: 20000 })
  comprobar((await fila.innerText()).includes('Por revisar'), 'el RQ nace «Por revisar» (Almacén)')
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 2. Almacén: revisa el stock, no tiene nada
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  const m = await menu(pagina)
  // El número de lo pendiente va pegado al nombre; menu() se lo quita. Lo que Almacén
  // tiene por atender va arriba, en «Por atender», y el kardex en «Almacén».
  const pendiente = m.find((g) => g.grupo === 'Por atender')
  comprobar(m.findIndex((g) => g.grupo === 'Por atender') < m.findIndex((g) => g.grupo === 'Almacén') && pendiente?.items[0] === 'Atención de requerimiento',
    `menú de Almacén arranca por Atención: ${JSON.stringify(m)}`)
  comprobar(!m.some((g) => g.grupo === 'Requerimientos'), 'Almacén no ve el grupo de Requerimientos')
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes('Requerimiento por revisar'), 'a Almacén le llegó el aviso de revisar')

  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.count()) === 1, 'Almacén ve el RQ por atender')
  comprobar((await fila.getByRole('button', { name: 'Revisar stock' }).count()) === 1 && (await fila.getByRole('button', { name: 'Listo en almacén' }).count()) === 0,
    'con el botón «Revisar stock»')
  await revisarStock(pagina, fila, 'nada', 'No queda plancha de 2 mm')
  // Como con «En compra»: se espera la fila con el estado nuevo, no la pausa fija.
  const porComprar = pagina.locator('tbody tr', { hasText: codigo }).filter({ hasText: 'Por comprar' })
  comprobar(await porComprar.waitFor({ timeout: 15000 }).then(() => true, () => false), 'queda «Por comprar»')
  await pagina.screenshot({ path: `${CAPTURAS}/atencion-almacen.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 2b. Requerimientos: le llegó «Por comprar»
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' })
  const aviso = pagina.locator('li, tr, a', { hasText: codigo }).filter({ hasText: /Por comprar: RQ-/ }).first()
  const texto = (await aviso.innerText().catch(() => '')).replace(/\s+/g, ' ')
  comprobar(texto.includes('Almacén no tiene nada; Logística compra 1 de 1 insumo'), `a Requerimientos le llegó «Por comprar» con lo que se compra: «${texto.slice(0, 200)}»`)
  comprobar(errores.length === 0, `sin errores de consola en los avisos de Requerimientos ${errores.join(' | ')}`)
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
  comprobar(avisos.includes('Requerimiento por comprar'), 'a Logística le llegó el aviso de lo que hay que comprar')

  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.getByRole('button', { name: 'Lo estoy comprando' }).count()) === 1, 'Logística tiene «Lo estoy comprando»')
  comprobar((await fila.getByRole('button', { name: 'Listo en almacén' }).count()) === 0, 'y no los botones de Almacén')
  await paso(pagina, fila, 'Lo estoy comprando', 'Cotizando con Aceros Arequipa')
  // Se espera la fila con el estado nuevo, no una pausa fija: con 800 ms fallaba a ratos.
  const enCompra = pagina.locator('tbody tr', { hasText: codigo }).filter({ hasText: 'En compra' })
  comprobar(await enCompra.waitFor({ timeout: 15000 }).then(() => true, () => false), 'queda «En compra»')
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
  // Desde la 20261020196000 «Entregado» sale solo cuando todo salió del kardex, y
  // esta plancha es un material nuevo sin stock: aquí se entrega con faltante. La
  // salida por el kardex la recorre probar-circuito-rq.
  comprobar((await fila.getByRole('button', { name: 'Entregado', exact: true }).count()) === 0, 'sin la salida en el kardex no ofrece «Entregado»')
  await fila.getByRole('button', { name: 'Entregar con faltante' }).click()
  const v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('[data-faltante]').innerText()).includes('Plancha LAF 2 mm 4x8'), 'la ventana dice qué no salió del kardex')
  await v.locator('textarea[name="nota"]').fill('Supervisor de Maestranza')
  await v.locator('textarea[name="motivo"]').fill('Se compró en otra unidad; el área ya no necesita la plancha.')
  await v.getByRole('button', { name: 'Entregar con faltante' }).click()
  await v.waitFor({ state: 'detached', timeout: 20000 })
  await pagina.waitForTimeout(800)
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
  const fila = pagina.locator('[data-rq]', { hasText: codigo })
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

/**
 * Clic real sobre la migración 20261016950000 y el RQ desplegable por insumo.
 * Con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El supervisor de Maestranza tiene «Stock en almacén» después de sus
 *      requerimientos, en el monitor y en el teléfono. Ve cada material en su
 *      almacén con lo que dice el kardex, los accesorios por código interno, lo
 *      que está bajo el mínimo y lo que se acabó, sin precios ni kardex. Busca
 *      por código interno y filtra por almacén.
 *   2. En Requerimientos ve primero los de su área. Cada RQ en camino llega
 *      desplegado (tarjetas del 2026-10-20): arriba cuántos insumos se pueden
 *      recoger en Almacén y cuántos faltan que lleguen, y cada insumo con su
 *      barra, lo que se recoge, lo que falta de Logística, su OC y en qué va.
 *      Ve también los de todas las áreas y los de un código interno.
 *   3. Requerimientos, que los lleva, los ve desplegados como siempre. Desde el
 *      2026-10-20 entra también al stock (lo libre y lo de cada código lo
 *      prueba `probar-stock-libre.mjs`).
 *   4. Almacén abre el stock con el enlace a su kardex.
 *
 * Necesita las cuentas `supervisor.mtz@`, `requerimientos@` y `almacen@local.test`,
 * y lo que siembra el hilo: un disco con 34 en Consumibles, un faro con 8 en
 * Accesorios (3 de MW-0123, 2 de MW-0130 y 3 libres), una plancha con 12 bajo
 * su mínimo de 15, guantes en EPP, una lija en cero; RQ-0001 (Maestranza,
 * MW-0123: el disco lo da Almacén, la plancha en parte, el faro va a compra con
 * su OC), RQ-0002 (Producción, MW-0130, listo en almacén) y RQ-0003
 * (Maestranza, MW-0130, por revisar).
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
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

async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim()) })),
  )
}
async function pestanas(pagina) {
  return pagina.locator('nav[aria-label="Secciones"] a').evaluateAll((as) => as.map((a) => a.textContent?.trim()))
}
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
// Las fichas del resumen («2 para recoger») solo se ven con los insumos cerrados:
// abiertos, cada insumo lo dice en su unidad.
const resumenCerrado = async (detalles) => {
  if (await detalles.evaluate((d) => d.open)) await detalles.locator('summary').click()
  return texto(detalles.locator('summary'))
}
const ir = (pagina, ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })

// ============================================ 1. El supervisor ve el stock
{
  const { pagina, contexto, errores } = await entrar('supervisor.mtz@local.test')
  const suMenu = await menu(pagina)
  const supervision = suMenu.find((g) => g.grupo === 'Supervisión')?.items ?? []
  console.log('    menú de Supervisión:', supervision.join(' · '))
  comprobar(supervision.at(-1) === 'Stock en almacén' && supervision.indexOf('Requerimientos') === supervision.length - 2,
    'el supervisor tiene «Stock en almacén» después de Requerimientos')

  await ir(pagina, '/almacen/stock')
  comprobar((await texto(pagina.locator('h1'))) === 'Stock en almacén', 'abre «Stock en almacén»')
  const almacenes = await pagina.locator('[data-almacen]').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-almacen')))
  console.log('    almacenes:', almacenes.join(' · '))
  comprobar(['CONSUMIBLES', 'ACCESORIOS', 'MATERIA_PRIMA', 'EPP'].every((a) => almacenes.includes(a)), 've los cuatro almacenes')
  const fila = (codigo) => pagina.locator(`tr[data-material="${codigo}"]`)
  const disco = await texto(fila('BCO-DIS'))
  console.log('    disco:', disco)
  // Desde el 2026-10-20 el número grande es lo libre y el kardex va en «de 34 UND en almacén» si algo está separado.
  comprobar(/(^| )34 UND|de 34 UND en almacén/.test(disco), 'el disco: 40 que entraron menos 6 que salieron')
  const faro = await texto(fila('BCO-FAR'))
  console.log('    faro:', faro)
  comprobar(faro.includes('3 UND de 8 UND en almacén') && faro.includes('MW-0123 3 UND') && faro.includes('MW-0130 2 UND'),
    'el faro: 8, de ellos 3 de MW-0123 y 2 de MW-0130, y 3 libres')
  const plancha = await texto(fila('BCO-PLA'))
  comprobar(plancha.includes('12 UND') && plancha.includes('Bajo el mínimo de 15'), 'la plancha avisa que está bajo su mínimo')
  const lija = await texto(fila('BCO-LIJ'))
  comprobar(lija.includes('Sin stock'), 'la lija que se acabó dice «Sin stock»')
  const todo = await texto(pagina.locator('main'))
  comprobar(!todo.includes('S/') && !/precio/i.test(todo), 'sin precios')
  comprobar((await pagina.getByRole('link', { name: 'Abrir el kardex' }).count()) === 0, 'sin enlace al kardex')
  await pagina.screenshot({ path: `${CAPTURAS}/stock-supervisor.png`, fullPage: true })

  // Por código interno: el accesorio que entró para MW-0130.
  await ir(pagina, '/almacen/stock?q=mw-0130')
  const conCodigo = await pagina.locator('tr[data-material]').evaluateAll((fs) => fs.map((f) => f.getAttribute('data-material')))
  comprobar(conCodigo.length === 1 && conCodigo[0] === 'BCO-FAR', 'buscar «mw-0130» encuentra el faro que entró para esa unidad')
  await ir(pagina, '/almacen/stock?almacen=ACCESORIOS')
  const soloAcc = await pagina.locator('[data-almacen]').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-almacen')))
  comprobar(soloAcc.length === 1 && soloAcc[0] === 'ACCESORIOS', 'la pastilla Accesorios deja solo ese almacén')

  await ir(pagina, '/almacen/kardex')
  comprobar(pagina.url().includes('/sin-permiso'), 'el kardex le sigue cerrado')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()

  const telefono = await entrar('supervisor.mtz@local.test', 390)
  // Sin el número del aviso que lleva al lado («1Reporte»).
  const tabs = (await pestanas(telefono.pagina)).map((t) => t?.replace(/^\d+/, ''))
  console.log('    pestañas del teléfono:', tabs.join(' · '))
  comprobar(tabs.join('|') === 'Reporte|Planos|RQ|Stock', 'en el teléfono: Reporte, Planos, RQ y Stock')
  await ir(telefono.pagina, '/almacen/stock')
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `la pantalla entra en el teléfono sin correrse de costado (${ancho} px)`)
  await telefono.pagina.screenshot({ path: `${CAPTURAS}/stock-telefono.png`, fullPage: true })
  await telefono.contexto.close()
}

// ============================================ 2. El supervisor despliega los insumos del RQ
{
  const { pagina, contexto, errores } = await entrar('supervisor.mtz@local.test')
  await ir(pagina, '/requerimientos')
  const numeros = async () => pagina.locator('[data-insumos]').evaluateAll((ds) => ds.map((d) => d.getAttribute('data-insumos')))
  const deSuArea = await numeros()
  console.log('    de su área:', deSuArea.join(' · '))
  comprobar(deSuArea.includes('RQ-0001-2026') && deSuArea.includes('RQ-0003-2026') && !deSuArea.includes('RQ-0002-2026'),
    've primero los RQ de Maestranza, sin el de Producción')

  const rq1 = pagina.locator('[data-insumos="RQ-0001-2026"]')
  comprobar(await rq1.evaluate((d) => d.open), 'el RQ en camino llega desplegado')
  const resumen = await texto(rq1.locator('summary'))
  console.log('    arriba:', resumen)
  comprobar(resumen.includes('3 insumos'), 'arriba dice cuántos insumos lleva')
  comprobar(await rq1.locator('li[data-insumo]').first().isVisible(), 'los insumos se ven sin presionar')
  const insumo = async (n) => texto(rq1.locator(`li[data-insumo="${n}"]`))
  const [i1, i2, i3] = [await insumo(1), await insumo(2), await insumo(3)]
  console.log('    1:', i1)
  console.log('    2:', i2)
  console.log('    3:', i3)
  comprobar(i1.includes('Disco de corte') && i1.includes('para recoger en Almacén') && !/faltan? de/.test(i1), 'el disco se recoge entero en Almacén')
  comprobar(i2.includes('Plancha') && i2.includes('12 UND para recoger en Almacén') && i2.includes('8 UND faltan de Logística') && i2.includes('Por comprar'),
    'la plancha: 12 para recoger en Almacén y 8 que faltan de Logística, por comprar')
  comprobar(i3.includes('Faro') && /faltan? de Logística/.test(i3) && /OC-\d+/.test(i3) && !i3.includes('para recoger'), 'el faro falta entero, con su OC')
  await pagina.screenshot({ path: `${CAPTURAS}/rq-desplegado.png`, fullPage: true })
  const cerrado = await resumenCerrado(rq1)
  comprobar(cerrado.includes('2 para recoger') && cerrado.includes('2 por llegar'),
    `cerrado, dice cuántos se pueden recoger en Almacén y cuántos faltan que lleguen («${cerrado}»)`)

  const rq3 = await resumenCerrado(pagina.locator('[data-insumos="RQ-0003-2026"]'))
  comprobar(rq3.includes('2 por revisar'), 'el RQ que Almacén no revisa dice «por revisar»')

  await pagina.getByRole('link', { name: /Todas las áreas/ }).click()
  await pagina.waitForURL(/area=todas/)
  await pagina.waitForLoadState('networkidle')
  const todas = await numeros()
  comprobar(todas.length === 3 && todas.includes('RQ-0002-2026'), 'con «Todas las áreas» ve también el de Producción')
  const rq2 = await resumenCerrado(pagina.locator('[data-insumos="RQ-0002-2026"]'))
  comprobar(rq2.includes('1 para recoger'), 'el de Producción está listo para recoger en Almacén')

  await pagina.locator('[data-rq="RQ-0002-2026"]').getByRole('link', { name: 'MW-0130' }).click()
  await pagina.waitForURL(/codigo=MW-0130/)
  await pagina.waitForLoadState('networkidle')
  const delCodigo = await numeros()
  comprobar(delCodigo.length === 2 && delCodigo.includes('RQ-0002-2026') && delCodigo.includes('RQ-0003-2026'),
    'al presionar el código interno ve solo los RQ de MW-0130')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 3. Requerimientos los ve abiertos y, desde el 2026-10-20, entra al stock
{
  const { pagina, contexto, errores } = await entrar('requerimientos@local.test')
  await ir(pagina, '/requerimientos')
  const abiertos = await pagina.locator('[data-insumos]').evaluateAll((ds) => ds.map((d) => d.open))
  comprobar(abiertos.length === 3 && abiertos.every(Boolean), 'Requerimientos los ve desplegados, como siempre')
  await ir(pagina, '/almacen/stock')
  comprobar((await texto(pagina.locator('h1'))) === 'Stock en almacén', 'Requerimientos entra al stock (migración 20261020195000)')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 4. Almacén lo abre con su kardex a mano
{
  const { pagina, contexto, errores } = await entrar('almacen@local.test')
  await ir(pagina, '/almacen/stock')
  comprobar((await texto(pagina.locator('h1'))) === 'Stock en almacén', 'Almacén abre el stock')
  comprobar((await pagina.getByRole('link', { name: 'Abrir el kardex' }).count()) === 1, 'con el enlace a su kardex')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)

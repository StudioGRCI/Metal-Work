/**
 * Clic real sobre el RQ del área (gasto operativo), con la cuenta de cada
 * puesto (nunca ADMIN). DKS, 2026-11-27: Producción, Maestranza y Acabados
 * piden herramientas e insumos para el área, y ese costo va como gasto
 * operativo, no a una OT.
 *
 *   1. El supervisor de Producción abre «Nuevo requerimiento»: «Es para» sale
 *      con «Una unidad u OT» y «El área: gasto operativo». Con la unidad pide
 *      el código interno; con el área no lo pide.
 *   2. Registra el del área con una herramienta: en la base queda de
 *      operación, de Producción y con el código PLANTA, que no carga a
 *      ninguna OT. Su tarjeta dice «Gasto operativo».
 *   3. Almacén lo recibe en Atención de requerimiento con la misma insignia.
 *   4. Gerencia lo consulta con la insignia y sin «Nuevo requerimiento».
 *
 * Capturas a 390 y 1440 del formulario y la tarjeta en CAPTURAS/rq-del-area.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => `${puesto}.local@metalwork.test`
const CUENTAS = { produccion: cuenta('sup.prd'), almacen: cuenta('almacen'), gerencia: cuenta('gerencia') }
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'rq-del-area')
mkdirSync(carpeta, { recursive: true })

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1440) {
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

const sello = Date.now().toString().slice(-6)
const herramienta = `Amoladora angular 4 1/2 del banco ${sello}`
let numero = ''

// ------------------------------------------------ 1 y 2. El supervisor de Producción
for (const ancho of [390, 1440]) {
  const { pagina, contexto, errores } = await entrar(CUENTAS.produccion, ancho)
  await ir(pagina, `${BASE}/requerimientos`)
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const ventana = pagina.locator('[role="dialog"]')
  const destino = ventana.locator('#rq-destino')
  await destino.waitFor({ timeout: 15000 })
  const opciones = (await destino.locator('option').allInnerTexts()).map((t) => t.trim())
  comprobar(opciones.join(' | ') === 'Una unidad u OT | El área: gasto operativo', `«Es para» ofrece la unidad y el área (${ancho}): ${opciones.join(' | ')}`)
  comprobar((await ventana.locator('#rq-codigo').count()) === 1, `con «Una unidad u OT» pide el código interno (${ancho})`)
  await destino.selectOption('AREA')
  comprobar((await ventana.locator('#rq-codigo').count()) === 0, `con «El área» ya no pide el código (${ancho})`)
  comprobar(limpio(await ventana.innerText()).includes('No se carga a ninguna OT'), `la ayuda dice que no se carga a ninguna OT (${ancho})`)
  await pagina.screenshot({ path: join(carpeta, `formulario-produccion-${ancho}.png`), fullPage: false })

  if (ancho === 1440) {
    await ventana.locator('#rq-justificacion').fill('Herramienta para el área de Producción: la amoladora del banco se quemó.')
    await ventana.getByRole('button', { name: 'Pedirlo como material nuevo' }).last().click()
    await ventana.locator('[id^="rq-desc-"]').first().fill(herramienta)
    await ventana.locator('[id^="rq-cant-"]').first().fill('1')
    await ventana.locator('[id^="rq-cat-"]').first().selectOption({ index: 1 })
    const und = ventana.locator('select[id^="rq-und-"]').first()
    if ((await und.count()) === 1 && !(await und.inputValue())) await und.selectOption({ index: 1 })
    await ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
    const aviso = pagina.locator('[role="status"]').filter({ hasText: /RQ-\d{4}-\d{4}/ }).first()
    await aviso.waitFor({ timeout: 20000 }).catch(() => {})
    const texto = limpio(await aviso.innerText().catch(() => ''))
    numero = (texto.match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
    comprobar(Boolean(numero), `registrado: «${texto}»`)

    const [fila] = await consulta(
      `select r.tipo, r.codigo_interno, a.nombre as area from public.requerimientos r join public.areas a on a.id = r.area_id where r.numero = $1`,
      [numero],
    )
    comprobar(fila?.tipo === 'OPERACION' && fila?.codigo_interno === 'PLANTA' && fila?.area === 'Producción',
      `en la base: de operación, de Producción y con PLANTA (${JSON.stringify(fila)})`)
    await ir(pagina, `${BASE}/requerimientos?rq=${encodeURIComponent(numero)}`)
  }
  comprobar(errores.length === 0, `sin errores de consola como Producción (${ancho}) ${errores.join(' | ')}`)
  await contexto.close()
}

// La tarjeta, con la cuenta de Producción, a 390 y 1440.
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar(CUENTAS.produccion, ancho)
  await ir(pagina, `${BASE}/requerimientos`)
  const tarjeta = pagina.locator(`[data-rq="${numero}"]`)
  await tarjeta.waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await tarjeta.locator('[data-gasto-operativo]').count()) === 1, `su tarjeta dice «Gasto operativo» (${ancho})`)
  await tarjeta.screenshot({ path: join(carpeta, `tarjeta-produccion-${ancho}.png`) }).catch(() => {})
  await contexto.close()
}

// ------------------------------------------------ 3. Almacén
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/requerimientos/atencion`)
  const fila = pagina.locator('tbody tr', { hasText: numero }).first()
  await fila.waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await fila.locator('[data-gasto-operativo]').count()) === 1, `en Atención, el ${numero} dice «Gasto operativo»`)
  await fila.screenshot({ path: join(carpeta, 'atencion-almacen-1440.png') }).catch(() => {})
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await ir(pagina, `${BASE}/requerimientos?tipo=todos`)
  const tarjeta = pagina.locator(`[data-rq="${numero}"]`)
  await tarjeta.waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await tarjeta.locator('[data-gasto-operativo]').count()) === 1, 'Gerencia lo ve con «Gasto operativo»')
  comprobar((await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).count()) === 0, 'Gerencia no registra RQ')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallas.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

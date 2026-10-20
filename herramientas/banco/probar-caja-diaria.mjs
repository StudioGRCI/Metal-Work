/**
 * Recorre con clic real la caja diaria de Tesorería (migración 20261017200000),
 * con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Tesorería tiene «Caja diaria» en su menú, después de Adquisiciones
 *      (2026-10-20). Da de alta tres cuentas que empiezan ayer: un banco en
 *      soles y uno en dólares, cada uno con la captura de su saldo, y la caja
 *      chica en efectivo. Lo propio de la captura, en probar-captura-del-saldo.mjs.
 *   2. Ayer: un egreso escrito «1,250.50» con su código interno, un ingreso,
 *      la reposición de la caja chica y una compra de dólares. Los saldos de la
 *      tabla salen de esos movimientos; el consolidado pasa los dólares a soles.
 *   3. Hoy: el saldo final de ayer es el inicial de hoy, y avisa que ayer está
 *      sin cerrar. Tres toques a «Registrar» dejan un solo movimiento.
 *   4. Cierra ayer: el banco cuadra; la caja chica no, y sin observaciones no
 *      la deja cerrar. Cerrado, el día ya no ofrece registrar ni anular.
 *   5. Hoy anula un egreso con su motivo, cierra el día y lo reabre: el cierre
 *      queda tachado con quién y por qué.
 *   6. Una cuenta con movimientos ya no cambia de saldo inicial al corregirla.
 *   7. En el teléfono la pantalla entra sin desbordarse.
 *   8. Gerencia y Contabilidad no la tienen en el menú ni entran por enlace.
 *
 * Necesita en la base del banco las cuentas `*.local@metalwork.test` de
 * Tesorería, Gerencia y Contabilidad, y el tipo de cambio de ayer o de algún
 * día de los diez anteriores. Las cuentas de la caja las crea el script, con
 * un nombre distinto en cada corrida.
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
const CUENTAS = {
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })
// La captura del aplicativo con el saldo, que todo banco nuevo lleva (migración 20261020170000).
const CAPTURA_SALDO = join(CAPTURAS, 'saldo-del-banco.png')
writeFileSync(CAPTURA_SALDO, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

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
/** Lee hasta que cumpla o pasen 15 s: la pantalla se repinta un momento después de cerrar la ventana. */
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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

/** Espera a que la ventana abierta se cierre (la acción salió bien) o muestre su error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([
    v.waitFor({ state: 'hidden', timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  await pagina.waitForLoadState('networkidle')
  return error
}

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
const sello = Date.now().toString().slice(-6)
const BCP = `BCP soles ${sello}`
const USD = `BCP dólares ${sello}`
const CHICA = `Caja chica ${sello}`
const codigo = `prb_caja_${sello}`
const ids = {}

const RUTA = `${BASE}/tesoreria/caja-diaria`
const delDia = (dia) => (dia === hoy ? RUTA : `${RUTA}?fecha=${dia}`)
/** Las celdas de la fila de una cuenta en la tabla de saldos, sin la primera. */
async function saldos(pagina, nombre) {
  const celdas = pagina.locator('table').first().locator('tr', { hasText: nombre }).locator('td')
  return (await celdas.allTextContents()).map(limpio).slice(1)
}

async function darDeAlta(pagina, { nombre, tipo, banco, moneda, saldo }) {
  // Con la primera ya dada de alta, «Agregar cuenta» vive en la sección desplegable del pie.
  const seccion = pagina.locator('details', { hasText: 'Cuentas de Tesorería' })
  if (await seccion.count()) await seccion.evaluate((d) => (d.open = true))
  await pagina.locator('[data-agregar-cuenta]:visible').first().click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="nombre"]').fill(nombre)
  await v.locator('select[name="tipo"]').selectOption(tipo)
  if (banco) await v.locator('input[name="banco"]').fill(banco)
  await v.locator('select[name="moneda"]').selectOption(moneda)
  await v.locator('input[name="saldo_inicial"]').fill(saldo)
  await v.locator('input[name="fecha_inicio"]').fill(ayer)
  if (tipo === 'BANCO') await v.locator('input[name="captura"]').setInputFiles(CAPTURA_SALDO)
  await v.getByRole('button', { name: 'Agregar la cuenta' }).click()
  const error = await esperarVentana(pagina)
  if (!error) await pagina.locator('details', { hasText: nombre }).waitFor({ timeout: 15000 }).catch(() => {})
  return error
}

async function registrar(pagina, cuenta, { tipo, descripcion, monto, codigoInterno, operacion }) {
  await pagina.locator(`[data-registrar-movimiento="${cuenta}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('select[name="tipo"]').selectOption(tipo)
  await v.locator('input[name="descripcion"]').fill(descripcion)
  await v.locator('input[name="monto"]').fill(monto)
  if (codigoInterno) await v.locator('input[name="codigo_interno"]').fill(codigoInterno)
  if (operacion) await v.locator('input[name="operacion"]').fill(operacion)
  await v.getByRole('button', { name: 'Registrar', exact: true }).click()
  return esperarVentana(pagina)
}

async function transferir(pagina, { origen, destino, monto, montoDestino, descripcion }) {
  await pagina.locator('[data-transferir]').click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('select[name="origen"]').selectOption(ids[origen])
  await v.locator('select[name="destino"]').selectOption(ids[destino])
  await v.locator('input[name="monto"]').fill(monto)
  const pide = await v.locator('input[name="monto_destino"]').count()
  if (montoDestino) await v.locator('input[name="monto_destino"]').fill(montoDestino)
  if (descripcion) await v.locator('input[name="descripcion"]').fill(descripcion)
  await v.getByRole('button', { name: 'Registrar la transferencia' }).click()
  return { error: await esperarVentana(pagina), pide: pide > 0 }
}

async function cerrar(pagina, cuenta, saldoBanco, observaciones) {
  await pagina.locator(`[data-cerrar-dia="${cuenta}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="saldo_banco"]').fill(saldoBanco)
  const aviso = limpio(await v.locator('[role="status"]').textContent().catch(() => ''))
  if (observaciones) await v.locator('textarea[name="observaciones"]').fill(observaciones)
  await v.getByRole('button', { name: 'Cerrar el día' }).click()
  return { aviso, error: await esperarVentana(pagina) }
}

const movimientos = (caja, fecha) =>
  consulta(
    `select tipo, monto::float as monto, descripcion, codigo_interno, origen, anulado_en is not null as anulado
       from movimientos_caja where caja_id = $1 and fecha = $2 order by creado_en`,
    [caja, fecha],
  )

// ------------------------------------------- 1. el menú y las tres cuentas
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  const rutas = await pagina.locator('nav a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  const caja = rutas.indexOf('/tesoreria/caja-diaria')
  comprobar(caja >= 0 && caja === rutas.indexOf('/adquisiciones') + 1, `«Caja diaria» va justo después de Adquisiciones en el menú de Tesorería (${rutas.slice(0, 4).join(', ')})`)

  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  comprobar(limpio(await pagina.locator('h1').textContent()) === 'Caja diaria', 'la pantalla abre con su título')
  for (const c of [
    { nombre: BCP, tipo: 'BANCO', banco: 'BCP', moneda: 'PEN', saldo: '10000' },
    { nombre: USD, tipo: 'BANCO', banco: 'BCP', moneda: 'USD', saldo: '2000' },
    { nombre: CHICA, tipo: 'EFECTIVO', moneda: 'PEN', saldo: '500' },
  ]) {
    const error = await darDeAlta(pagina, c)
    comprobar(!error, `da de alta «${c.nombre}»${error ? `: ${error}` : ''}`)
  }
  for (const r of await consulta('select id, nombre, tipo, moneda, saldo_inicial::float as s, fecha_inicio::text as f from cajas where nombre like $1', [`%${sello}`])) {
    ids[r.nombre] = r.id
    comprobar(r.f === ayer, `«${r.nombre}» empieza ayer (${r.f}) con ${r.s} en ${r.moneda}`)
  }
  comprobar(Object.keys(ids).length === 3, 'las tres cuentas quedan en la base')
  const repetida = await darDeAlta(pagina, { nombre: BCP.toUpperCase(), tipo: 'BANCO', banco: 'BCP', moneda: 'PEN', saldo: '1' })
  comprobar(repetida.includes('Ya hay una cuenta'), `no deja dos cuentas con el mismo nombre, y lo dice con su mensaje (${repetida})`)
  await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Cancelar' }).click()
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------ 2. lo de ayer
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(delDia(ayer), { waitUntil: 'networkidle' })
  let error = await registrar(pagina, BCP, { tipo: 'EGRESO', descripcion: `OC de prueba ${sello}`, monto: '1,250.50', codigoInterno: codigo, operacion: `OP-${sello}` })
  comprobar(!error, `registra un egreso escrito «1,250.50» con código interno${error ? `: ${error}` : ''}`)
  error = await registrar(pagina, BCP, { tipo: 'INGRESO', descripcion: `Cobro de prueba ${sello}`, monto: '5000' })
  comprobar(!error, `registra un ingreso${error ? `: ${error}` : ''}`)
  const enLetras = await registrar(pagina, BCP, { tipo: 'EGRESO', descripcion: `Monto en letras ${sello}`, monto: 'diez' })
  comprobar(enLetras.length > 0, `un monto en letras no entra (${enLetras})`)
  await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Cancelar' }).click()

  const t1 = await transferir(pagina, { origen: BCP, destino: CHICA, monto: '300', descripcion: 'Reposición de caja chica' })
  comprobar(!t1.error && !t1.pide, `repone la caja chica sin pedir otro monto, las dos en soles${t1.error ? `: ${t1.error}` : ''}`)
  const t2 = await transferir(pagina, { origen: BCP, destino: USD, monto: '3745', montoDestino: '1000', descripcion: 'Compra de dólares' })
  comprobar(!t2.error && t2.pide, `compra dólares: pide lo que entra en dólares${t2.error ? `: ${t2.error}` : ''}`)

  const [egreso] = (await movimientos(ids[BCP], ayer)).filter((m) => m.descripcion.startsWith('OC de prueba'))
  comprobar(egreso?.monto === 1250.5 && egreso?.codigo_interno === codigo.toUpperCase() && egreso?.origen === 'MANUAL',
    `en la base: 1250.50, el código en mayúsculas y de origen manual (${egreso?.monto}, ${egreso?.codigo_interno})`)
  const [compra] = await consulta(
    "select tipo_cambio::float as tc, monto::float as monto from movimientos_caja where caja_id = $1 and fecha = $2 and origen = 'TRANSFERENCIA'",
    [ids[USD], ayer],
  )
  comprobar(compra?.monto === 1000 && compra?.tc === 3.745, `la compra de dólares guarda el cambio que sale del voucher (${compra?.tc})`)

  const bcp = await hasta(() => saldos(pagina, BCP), (c) => c[3] === 'S/ 9,704.50')
  comprobar(bcp[0] === 'S/ 10,000.00' && bcp[1] === 'S/ 5,295.50' && bcp[2] === 'S/ 5,000.00' && bcp[3] === 'S/ 9,704.50',
    `BCP soles: 10,000 − 5,295.50 + 5,000 = 9,704.50 (${bcp.slice(0, 4).join(' | ')})`)
  const usd = await hasta(() => saldos(pagina, USD), (c) => c[3] === 'US$ 3,000.00')
  comprobar(usd[3] === 'US$ 3,000.00', `BCP dólares termina con US$ 3,000 (${usd[3]})`)
  const chica = await hasta(() => saldos(pagina, CHICA), (c) => c[3] === 'S/ 800.00')
  comprobar(chica[3] === 'S/ 800.00', `la caja chica termina con S/ 800 (${chica[3]})`)
  // El cambio de compra de la base, no uno fijo: el banco local puede tener otro.
  const [{ c: compraDelDia } = {}] = await consulta("select public.cambio_del_dia($1::date, 'COMPRA')::float as c", [ayer])
  const pie = limpio(await pagina.locator('main').textContent())
  comprobar(pie.includes('Todo en soles') && !!compraDelDia && pie.includes(`dólar a ${compraDelDia.toFixed(3)}`),
    `el consolidado pasa los dólares a soles con el cambio de compra (${compraDelDia})`)

  const fila = limpio(await pagina.locator(`#cuenta-${ids[BCP]} tr`, { hasText: 'Compra de dólares' }).textContent())
  comprobar(fila.includes(`Transferencia a ${USD}`), `la transferencia dice a qué cuenta fue (${fila.slice(0, 90)})`)
  const conCodigo = limpio(await pagina.locator(`#cuenta-${ids[BCP]} tr`, { hasText: `OC de prueba ${sello}` }).textContent())
  comprobar(conCodigo.includes(codigo.toUpperCase()) && conCodigo.includes(`OP-${sello}`), `el egreso muestra su código interno y su operación (${conCodigo.slice(0, 120)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'caja-01-ayer.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------ 3. hoy, sin cerrar ayer
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  const bcp = await saldos(pagina, BCP)
  comprobar(bcp[0] === 'S/ 9,704.50', `el saldo inicial de hoy es el final de ayer (${bcp[0]})`)
  const aviso = limpio(await pagina.locator('[role="status"]', { hasText: 'Días sin cerrar' }).textContent().catch(() => ''))
  comprobar(aviso.includes(`${BCP} tiene movimientos sin cerrar`), 'avisa que ayer quedó sin cerrar')
  const bloque = limpio(await pagina.locator(`#cuenta-${ids[BCP]}`).textContent())
  comprobar(bloque.includes('primero cierra el') && (await pagina.locator(`[data-cerrar-dia="${BCP}"]`).count()) === 0, 'hoy no se cierra antes que ayer')

  // Tres toques seguidos a «Registrar»: un solo movimiento.
  await pagina.locator(`[data-registrar-movimiento="${BCP}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('select[name="tipo"]').selectOption('EGRESO')
  await v.locator('input[name="descripcion"]').fill(`ITF de prueba ${sello}`)
  await v.locator('input[name="monto"]').fill('15.20')
  const boton = v.getByRole('button', { name: 'Registrar', exact: true })
  await boton.click({ noWaitAfter: true })
  await boton.click({ force: true, noWaitAfter: true, timeout: 2000 }).catch(() => {})
  await boton.click({ force: true, noWaitAfter: true, timeout: 2000 }).catch(() => {})
  await esperarVentana(pagina)
  const itf = (await movimientos(ids[BCP], hoy)).filter((m) => m.descripcion === `ITF de prueba ${sello}`)
  comprobar(itf.length === 1, `tres toques a «Registrar» dejan un solo movimiento (${itf.length})`)
  const error = await registrar(pagina, BCP, { tipo: 'EGRESO', descripcion: `Egreso equivocado ${sello}`, monto: '99' })
  comprobar(!error, `registra un egreso que después se anula${error ? `: ${error}` : ''}`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------ 4. cierra ayer
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(delDia(ayer), { waitUntil: 'networkidle' })
  // Con coma decimal, como lo copian del estado de cuenta: la vista previa y la base leen lo mismo.
  let r = await cerrar(pagina, BCP, '9704,50')
  comprobar(r.aviso === 'Cuadra con la caja.' && !r.error, `con coma decimal, el banco cuadra y cierra (${r.aviso}${r.error ? `: ${r.error}` : ''})`)
  // Sin observaciones, o muy cortas, el navegador no deja enviar: la ventana sigue abierta.
  await pagina.locator(`[data-cerrar-dia="${CHICA}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="saldo_banco"]').fill('790')
  const aviso = limpio(await v.locator('[role="status"]').textContent())
  const obs = v.locator('textarea[name="observaciones"]')
  await v.getByRole('button', { name: 'Cerrar el día' }).click()
  comprobar(aviso.includes('Diferencia de S/ -10.00') && aviso.includes('10 caracteres') && (await obs.evaluate((e) => e.validity.valueMissing)) && (await v.isVisible()),
    `con S/ 10 de menos y sin observaciones no cierra (${aviso})`)
  await obs.fill('vale')
  await v.getByRole('button', { name: 'Cerrar el día' }).click()
  comprobar((await obs.evaluate((e) => e.validity.tooShort)) && (await v.isVisible()), 'con una observación de cuatro letras tampoco')
  await obs.fill('Faltan S/ 10 de un vale sin rendir.')
  await v.getByRole('button', { name: 'Cerrar el día' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `con observaciones, cierra la caja chica con su diferencia${error ? `: ${error}` : ''}`)
  r = await cerrar(pagina, USD, '3000')
  comprobar(!r.error, `cierra los dólares${r.error ? `: ${r.error}` : ''}`)

  const bcp = await hasta(() => saldos(pagina, BCP), (c) => c[6] === 'Cerrado')
  comprobar(bcp[4] === 'S/ 9,704.50' && bcp[5] === 'S/ 0.00' && bcp[6] === 'Cerrado', `la tabla dice según el banco, sin diferencia y cerrado (${bcp.slice(4).join(' | ')})`)
  // Cada lectura espera a que la pantalla traiga lo último: el refresco llega después de cerrar la ventana.
  const chica = await hasta(() => saldos(pagina, CHICA), (c) => c[6] === 'Cerrado')
  await hasta(() => saldos(pagina, USD), (c) => c[6] === 'Cerrado')
  comprobar(chica[5] === 'S/ -10.00', `la caja chica muestra su diferencia (${chica[5]})`)
  const bloque = pagina.locator(`#cuenta-${ids[BCP]}`)
  comprobar(limpio(await bloque.textContent()).includes('Cerrado por'), 'el bloque dice quién lo cerró')
  comprobar((await bloque.locator('[data-registrar-movimiento], [data-anular-movimiento]').count()) === 0, 'un día cerrado no ofrece registrar ni anular')
  // Las cuentas de corridas anteriores pueden seguir abiertas: las cerradas no se ofrecen para transferir.
  if (await pagina.locator('[data-transferir]').count()) {
    await pagina.locator('[data-transferir]').click()
    const opciones = await pagina.locator('[role="dialog"] select[name="origen"] option').evaluateAll((os) => os.map((o) => o.value))
    comprobar(!opciones.includes(ids[BCP]) && !opciones.includes(ids[CHICA]), 'ni se ofrece para transferir')
    await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Cancelar' }).click()
  } else comprobar(true, 'ni transferir')
  await pagina.screenshot({ path: join(CAPTURAS, 'caja-02-ayer-cerrado.png'), fullPage: true })
  const [cierre] = await consulta('select saldo_final::float as f, saldo_banco::float as b, diferencia::float as d, observaciones from cierres_caja where caja_id = $1 and fecha = $2', [ids[CHICA], ayer])
  comprobar(cierre?.f === 800 && cierre?.d === -10 && cierre?.observaciones?.includes('vale'), `en la base: la caja chica cerró con 800, -10 y su observación (${cierre?.d})`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 5. hoy: anular, cerrar y reabrir
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[role="status"]', { hasText: BCP }).count()) === 0, 'ayer cerrado, ya no sale en «Días sin cerrar»')
  const bloque = pagina.locator(`#cuenta-${ids[BCP]}`)
  await bloque.locator(`[data-anular-movimiento="Egreso equivocado ${sello}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('Se registró en la cuenta equivocada.')
  await v.getByRole('button', { name: 'Anular' }).click()
  let error = await esperarVentana(pagina)
  comprobar(!error, `anula el egreso con su motivo${error ? `: ${error}` : ''}`)
  const fila = await hasta(() => bloque.locator('tr', { hasText: `Egreso equivocado ${sello}` }).textContent().then(limpio), (t) => t.includes('Anulado por'))
  comprobar(fila.includes('Anulado por') && fila.includes('cuenta equivocada'), `queda a la vista, anulado con su motivo (${fila.slice(0, 120)})`)
  const bcp = await hasta(() => saldos(pagina, BCP), (c) => c[3] === 'S/ 9,689.30')
  comprobar(bcp[1] === 'S/ 15.20' && bcp[3] === 'S/ 9,689.30', `lo anulado ya no suma: sale solo el ITF (${bcp[1]}, ${bcp[3]})`)

  const r = await cerrar(pagina, BCP, '9689.30')
  comprobar(!r.error, `cierra hoy${r.error ? `: ${r.error}` : ''}`)
  await pagina.locator(`[data-reabrir-dia="${BCP}"]`).waitFor({ timeout: 15000 }).catch(() => {})
  await pagina.locator(`[data-reabrir-dia="${BCP}"]`).click()
  await v.locator('textarea[name="motivo"]').fill('Faltó registrar la comisión del día.')
  await v.getByRole('button', { name: 'Reabrir el día' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `reabre hoy con su motivo${error ? `: ${error}` : ''}`)
  const texto = await hasta(() => bloque.textContent().then(limpio), (t) => t.includes('reabierto por'))
  comprobar(texto.includes('reabierto por') && texto.includes('Faltó registrar la comisión'), 'el cierre reabierto queda tachado con quién y por qué')
  comprobar((await bloque.locator('[data-registrar-movimiento]').count()) === 1, 'reabierto, vuelve a recibir movimientos')
  await pagina.screenshot({ path: join(CAPTURAS, 'caja-03-hoy-reabierto.png'), fullPage: true })
  const cierres = await consulta('select fecha::text, anulado_en is not null as anulado from cierres_caja where caja_id = $1 order by fecha', [ids[BCP]])
  comprobar(cierres.length === 2 && !cierres[0].anulado && cierres[1].anulado, `en la base: ayer sigue cerrado y el de hoy quedó anulado, no borrado (${cierres.length})`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 6. el saldo inicial ya no cambia
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  await pagina.locator('summary', { hasText: 'Cuentas de Tesorería' }).click()
  await pagina.locator(`[data-editar-cuenta="${CHICA}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  comprobar(await v.locator('input[inputmode="decimal"]').isDisabled(), 'con movimientos, el saldo inicial está bloqueado')
  await v.locator('input[name="nombre"]').fill(`${CHICA} planta`)
  await v.getByRole('button', { name: 'Guardar' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `corrige el nombre${error ? `: ${error}` : ''}`)
  const [c] = await consulta('select nombre, saldo_inicial::float as s from cajas where id = $1', [ids[CHICA]])
  comprobar(c?.nombre === `${CHICA} planta` && c?.s === 500, `en la base: nombre nuevo y el mismo saldo inicial (${c?.s})`)
  // Con plata adentro no se desactiva: saldría del consolidado sin que nadie la moviera.
  await pagina.locator(`[data-editar-cuenta="${CHICA} planta"]`).click()
  await v.locator('select[name="activa"]').selectOption('no')
  await v.getByRole('button', { name: 'Guardar' }).click()
  const rechazo = await esperarVentana(pagina)
  comprobar(rechazo.includes('todavía tiene S/ ') && rechazo.includes('transferencia'), `con saldo no se desactiva (${rechazo})`)
  await v.getByRole('button', { name: 'Cancelar' }).click()
  const [sigue] = await consulta('select activa from cajas where id = $1', [ids[CHICA]])
  comprobar(sigue?.activa === true, 'en la base sigue activa')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------ 7. en el teléfono
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria, CELULAR)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= CELULAR.width, `en el teléfono no se desborda (${ancho}px)`)
  comprobar((await pagina.locator(`[data-registrar-movimiento="caja"]`).count()) === 1, 'y tiene a mano «Registrar ingreso o egreso»')
  const pestanas = await pagina.locator('nav[aria-label="Secciones"] a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  comprobar(pestanas[1] === '/tesoreria/caja-diaria', `la caja es la segunda pestaña del teléfono, después de Adquisiciones (${pestanas.join(', ')})`)
  // Ayer tiene egresos, ingresos y una transferencia: cada monto se ve, con su signo, y nada queda fuera de la tabla.
  await pagina.goto(delDia(ayer), { waitUntil: 'networkidle' })
  const anchoAyer = await pagina.evaluate(() => document.documentElement.scrollWidth)
  const tablas = await pagina.locator('table').evaluateAll((ts) => ts.map((t) => [t.scrollWidth, t.parentElement.clientWidth]))
  comprobar(anchoAyer <= CELULAR.width && tablas.every(([t, caja]) => t <= caja + 1), `ninguna tabla se corta en el teléfono (${JSON.stringify(tablas)})`)
  const ingreso = pagina.locator(`#cuenta-${ids[BCP]} tr`, { hasText: `Cobro de prueba ${sello}` }).locator('[data-monto-telefono]')
  comprobar((await ingreso.isVisible()) && limpio(await ingreso.textContent()).startsWith('+S/ 5,000.00'), `un ingreso muestra su monto en el teléfono (${limpio(await ingreso.textContent())})`)
  const saldoFinal = pagina.locator('table').first().locator('tr', { hasText: BCP }).locator('td').nth(4)
  comprobar((await saldoFinal.isVisible()) && limpio(await saldoFinal.textContent()).startsWith('S/ 9,704.50'), 'y la tabla de saldos deja ver el saldo final')
  await pagina.screenshot({ path: join(CAPTURAS, 'caja-05-telefono-ayer.png'), fullPage: true })
  // Un día que no existe no tumba la pantalla: abre hoy.
  for (const raro of ['2026-02-30', '0000-01-01']) {
    await pagina.goto(`${RUTA}?fecha=${raro}`, { waitUntil: 'networkidle' })
    comprobar(limpio(await pagina.locator('h1').first().textContent()) === 'Caja diaria' && (await pagina.locator('#caja-dia').inputValue()) === hoy,
      `un día que no existe en la URL (${raro}) abre la caja de hoy`)
  }
  await pagina.screenshot({ path: join(CAPTURAS, 'caja-04-telefono.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------- 8. los que no la llevan
for (const puesto of ['gerencia', 'contabilidad']) {
  const { pagina, contexto } = await entrar(CUENTAS[puesto])
  comprobar((await pagina.locator('nav a[href="/tesoreria/caja-diaria"]').count()) === 0, `${puesto} no tiene «Caja diaria» en su menú`)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), `${puesto} no entra por enlace`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)

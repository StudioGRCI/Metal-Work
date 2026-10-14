/**
 * Clic real sobre el recojo y el avance del requerimiento (migración
 * 20261013121000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos registra un RQ con dos insumos: 10 %, Almacén revisa.
 *   2. Almacén lo deja sin stock y Logística genera una OC para los dos.
 *   3. Requerimientos ve «OC por aprobar» con el número de la OC (no lee la
 *      tabla de compras: lo trae el avance).
 *   4. Gerencia aprueba: Supervisión ve el RQ «Pendiente de recojo», y
 *      Logística la pone en la lista del conductor con su peso.
 *   5. El conductor toca «Salgo a recoger»: la tarjeta dice «En recojo» y el
 *      botón pasa a «Ya la recogí». Supervisión ve «En recojo» y el porcentaje
 *      sube; Logística lo ve por insumo en Atención.
 *   6. «Ya la recogí» y «La dejé en almacén»: el RQ sube a 70 % y a 80 %.
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
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos@local.test',
  almacen: process.env.ALMACEN ?? 'almacen@local.test',
  logistica: process.env.LOGISTICA ?? 'logistica@local.test',
  gerencia: process.env.GERENCIA ?? 'gerencia@local.test',
  supervisor: process.env.SUPERVISOR ?? 'supervisor@local.test',
  conductor: process.env.CONDUCTOR ?? 'conductor@local.test',
}
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

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
/** La tarjeta de la OC en Recojos (una por compra, dentro de su sección). */
const tarjetaDe = (pagina) => pagina.locator('main section > div', { hasText: oc })
const porcentaje = async (fila) => Number(await fila.getByRole('progressbar').getAttribute('aria-valuenow'))
const sello = Date.now().toString().slice(-6)
let numeroRq = ''
let oc = ''

/** Mira el RQ en una pantalla con una cuenta y devuelve el texto de su fila y su porcentaje. */
async function mirarRq(cuenta, ruta, captura) {
  const { pagina, contexto, errores } = await entrar(cuenta)
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  const t = (await fila.count()) === 1 ? await texto(fila) : ''
  const pct = (await fila.count()) === 1 ? await porcentaje(fila) : NaN
  const resumen = await texto(pagina.locator('main'))
  if (captura) await pagina.screenshot({ path: `${CAPTURAS}/${captura}.png`, fullPage: true })
  comprobar(errores.length === 0, `${cuenta} en ${ruta}: sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
  return { t, pct, resumen }
}

// ------------------------------------------------ 1. Requerimientos registra el RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-area').selectOption({ index: 1 })
  await ventana.locator('#rq-codigo').fill(`PLA_SR_O4_1_26/${sello.slice(-2)}`)
  await ventana.locator('#rq-justificacion').fill('Armado del chasis de la plataforma; no hay planchas en almacén.')
  const descs = ventana.locator('input[name="descripcion"]')
  await descs.nth(0).fill(`Plancha LAF 2 mm 4x8 ${sello}`)
  await ventana.locator('input[name="cantidad"]').nth(0).fill('3')
  await ventana.locator('select[name="categoria_id"]').nth(0).selectOption({ index: 1 })
  await ventana.getByRole('button', { name: 'Agregar insumo' }).click()
  await descs.nth(1).fill(`Guantes de cuero ${sello}`)
  await ventana.locator('input[name="cantidad"]').nth(1).fill('6')
  await ventana.locator('select[name="categoria_id"]').nth(1).selectOption({ index: 1 })
  await ventana.getByRole('button', { name: /Registrar/ }).click()
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })
  const aviso = await pagina.locator('[role="status"]').innerText()
  numeroRq = (aviso.match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
  comprobar(numeroRq !== '', `RQ registrado: «${aviso}»`)
  await pagina.waitForTimeout(800)
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  comprobar((await porcentaje(fila)) === 10 && (await texto(fila)).includes('Almacén revisa el stock'), 'recién registrado: 10 %, Almacén revisa el stock')
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 2. Sin stock y la OC desde el RQ
{
  const { pagina, contexto } = await entrar(CUENTAS.almacen)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  await fila.getByRole('button', { name: 'Sin stock' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('textarea[name="nota"]').fill('No queda plancha de 2 mm')
  await ventana.getByRole('button', { name: 'Marcar sin stock' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  comprobar((await porcentaje(fila)) === 20 && (await texto(fila)).includes('Por comprar'), 'sin stock: 20 %, por comprar')
  await fila.getByRole('button', { name: 'Generar OC' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#ocd-proveedor').click()
  await pagina.locator('[role="option"]').first().click()
  await ventana.locator('[id^="ocd-mat-"]').first().click()
  await pagina.locator('[role="option"]').first().click()
  await ventana.locator('[id^="ocd-cant-"]').first().fill('3')
  await ventana.locator('[id^="ocd-precio-"]').first().fill('120.50')
  await ventana.getByRole('button', { name: 'Emitir orden de compra' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  // Con todos sus insumos cubiertos, el RQ ya no ofrece «Generar OC» y el aviso
  // se va con el botón: el número se lee entonces de la fila del RQ.
  const aviso = await pagina.locator('[role="status"]').waitFor({ timeout: 5000 }).then(() => pagina.locator('[role="status"]').innerText(), () => '')
  await pagina.waitForTimeout(800)
  oc = ((aviso || (await pagina.locator('tbody tr', { hasText: numeroRq }).innerText())).match(/OC-\d+-MW/) ?? [''])[0]
  comprobar(oc !== '', `OC ${oc} para los dos insumos`)
  await contexto.close()
}

// ------------------------------------------------ 3. Requerimientos ve la OC por aprobar
{
  const { t, pct } = await mirarRq(CUENTAS.requerimientos, '/requerimientos')
  comprobar(pct === 30, `OC por aprobar: 30 % (${pct})`)
  comprobar(t.includes(oc) && t.includes('OC por aprobar'), `Requerimientos ve la ${oc} y «OC por aprobar» en cada insumo`)
}

// ------------------------------------------------ 4. Gerencia aprueba
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.getByText(oc).first().locator('xpath=ancestor::*[.//button[contains(., "Rechazar")]][1]')
  comprobar((await tarjeta.count()) === 1, `Gerencia ve la ${oc} por aprobar`)
  await tarjeta.getByRole('button', { name: 'Aprobar' }).click()
  await pagina.getByText(oc).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(800)
  await contexto.close()
}
{
  const { t, pct, resumen } = await mirarRq(CUENTAS.supervisor, '/requerimientos', 'avance-pendiente-recojo')
  comprobar(pct === 45 && t.includes('Pendiente de recojo'), `aprobada: Supervisión ve «Pendiente de recojo» y 45 % (${pct})`)
  comprobar(t.includes(oc), `Supervisión ve con qué OC va (${oc})`)
  comprobar(/con insumos pendientes de recojo/.test(resumen), 'el resumen cuenta los pendientes de recojo')
}

// ------------------------------------------------ 4b. Logística la programa
// Desde la gestión de compras (migración 20261015140000) el conductor sale solo
// con lo que Logística le pone en su lista, con su peso.
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('section[aria-labelledby="titulo-por-programar"] > div', { hasText: oc })
  await tarjeta.locator('input[name="peso"]').fill('85')
  await tarjeta.getByRole('button', { name: 'Poner en la lista' }).click()
  await pagina.locator('section[aria-labelledby="titulo-lista"] > div', { hasText: oc }).waitFor({ timeout: 20000 })
  comprobar(true, `Logística pone la ${oc} en la lista del conductor con 85 kg`)
  await contexto.close()
}

// ------------------------------------------------ 5. «Salgo a recoger»
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const tarjeta = tarjetaDe(pagina)
  comprobar((await tarjeta.count()) === 1 && (await tarjeta.getByRole('button', { name: 'Salgo a recoger' }).count()) === 1,
    `el conductor ve la ${oc} con «Salgo a recoger»`)
  comprobar((await texto(tarjeta)).includes('Pendiente de recojo'), 'la tarjeta dice «Pendiente de recojo»')
  comprobar((await tarjeta.getByRole('button', { name: 'Ya la recogí' }).count()) === 0, 'un botón por paso: todavía no «Ya la recogí»')
  await tarjeta.getByRole('button', { name: 'Salgo a recoger' }).click()
  // El paso no muestra aviso: la tarjeta se refresca con el botón siguiente.
  await tarjeta.getByRole('button', { name: 'Ya la recogí' }).waitFor({ timeout: 20000 })
  comprobar((await tarjeta.getByRole('button', { name: 'Salgo a recoger' }).count()) === 0, 'el botón pasa a «Ya la recogí»')
  const t = await texto(tarjeta)
  comprobar(t.includes('En recojo') && t.includes('salió a recogerla'), `la tarjeta dice «En recojo» y la hora de salida: ${t.slice(-120)}`)
  await pagina.screenshot({ path: `${CAPTURAS}/recojo-en-recojo.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}
{
  const { t, pct, resumen } = await mirarRq(CUENTAS.supervisor, '/requerimientos', 'avance-en-recojo')
  comprobar(pct === 60 && t.includes('En recojo'), `Supervisión ve «En recojo» y 60 % (${pct})`)
  comprobar(/con insumos en recojo/.test(resumen), 'el resumen cuenta aparte los que están en recojo')
}
{
  const { t } = await mirarRq(CUENTAS.logistica, '/requerimientos/atencion', 'atencion-en-recojo')
  comprobar(/En recojo desde/.test(t), `Logística ve cada insumo «En recojo desde…» en Atención`)
}

// ------------------------------------------------ 6. Recogida y dejada
{
  const { pagina, contexto } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const tarjeta = tarjetaDe(pagina)
  await tarjeta.getByRole('button', { name: 'Ya la recogí' }).click()
  await tarjeta.getByRole('button', { name: 'La dejé en almacén' }).waitFor({ timeout: 20000 })
  comprobar((await texto(tarjeta)).includes('Recogida'), 'la tarjeta dice «Recogida»')
  await contexto.close()
}
{
  const { pct, t } = await mirarRq(CUENTAS.requerimientos, '/requerimientos')
  comprobar(pct === 70 && t.includes('Recogido, va al almacén'), `recogida: 70 % (${pct})`)
}
{
  const { pagina, contexto } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const tarjeta = tarjetaDe(pagina)
  await tarjeta.getByRole('button', { name: 'La dejé en almacén' }).click()
  await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Sí, la dejé' }).click()
  await pagina.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 20000 })
  await contexto.close()
}
{
  const { pct, t } = await mirarRq(CUENTAS.supervisor, '/requerimientos/atencion', 'atencion-por-validar')
  comprobar(pct === 80 && t.includes('En almacén, por validar'), `dejada: 80 %, por validar en almacén (${pct})`)
}

await navegador.close()
console.log(fallas.length === 0 ? `\nTODO EN VERDE (${numeroRq} con ${oc})` : `\n${fallas.length} FALLAS`)
process.exit(fallas.length === 0 ? 0 : 1)

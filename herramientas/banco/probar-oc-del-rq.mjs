/**
 * Clic real sobre «Generar OC» en Atención de requerimiento, con la cuenta de
 * cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos registra un RQ con dos insumos.
 *   2. Logística entra a Atención y no ve «Generar OC»: Almacén no revisó.
 *   3. Almacén lo marca sin stock.
 *   4. Logística genera la OC del insumo 1 desde el RQ: el RQ pasa a «En compra»,
 *      el insumo 1 muestra su OC, Órdenes de compra dice qué RQ atiende y la
 *      OC lleva el código interno del RQ. Vuelve a generar para el insumo 2.
 *   5. Gerencia rechaza la segunda OC: el insumo 2 se ve «rechazada» y
 *      Logística vuelve a tener «Generar OC» con solo ese insumo libre.
 *   6. Requerimientos ve las OC de cada insumo y ya no puede anular.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111) y los correos
 * REQUERIMIENTOS, ALMACEN, LOGISTICA y GERENCIA si no son `*@local.test`.
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

import { escribirCodigo } from './campo-codigo.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos@local.test',
  almacen: process.env.ALMACEN ?? 'almacen@local.test',
  logistica: process.env.LOGISTICA ?? 'logistica@local.test',
  gerencia: process.env.GERENCIA ?? 'gerencia@local.test',
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
const sello = Date.now().toString().slice(-6)
let numeroRq = ''
let oc1 = ''
let oc2 = ''

// ------------------------------------------------ 1. Requerimientos registra el RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-area').selectOption({ index: 1 })
  await escribirCodigo(ventana.locator('#rq-codigo'), `PLA_SR_O4_1_26/${sello.slice(-2)}`)
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
  await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().waitFor({ timeout: 20000 })
  const aviso = await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().innerText()
  numeroRq = (aviso.match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
  comprobar(numeroRq !== '', `RQ registrado: «${aviso}»`)
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 2. Logística todavía no genera nada
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  comprobar((await fila.count()) === 1, `Logística ve ${numeroRq} en Atención`)
  comprobar((await fila.getByRole('button', { name: 'Generar OC' }).count()) === 0, 'por revisar: sin «Generar OC»')
  await contexto.close()
}

// ------------------------------------------------ 3. Almacén no tiene nada
{
  const { pagina, contexto } = await entrar(CUENTAS.almacen)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  await fila.getByRole('button', { name: 'Revisar stock' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.getByRole('button', { name: 'No tengo nada' }).click()
  await ventana.locator('textarea[name="nota"]').fill('No queda plancha de 2 mm')
  await ventana.getByRole('button', { name: 'Guardar la revisión' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  await pagina.waitForTimeout(800)
  comprobar((await texto(fila)).includes('Por comprar'), 'queda «Por comprar»')
  comprobar((await fila.getByRole('button', { name: 'Generar OC' }).count()) === 0, 'Almacén no tiene «Generar OC»')
  await contexto.close()
}

/** Llena la OC del RQ en la ventana abierta: proveedor, material y precio. */
async function llenarOc(pagina, ventana, { desmarcar = [] } = {}) {
  // Proveedor y material son desplegables buscables: se abren y se toma la primera opción.
  await ventana.locator('#ocd-proveedor').click()
  await pagina.locator('[role="option"]').first().click()
  for (const item of desmarcar) await ventana.locator(`input[name="item"][value="${item}"]`).uncheck()
  await ventana.locator('[id^="ocd-mat-"]').first().click()
  await pagina.locator('[role="option"]').first().click()
  await ventana.locator('[id^="ocd-cant-"]').first().fill('3')
  await ventana.locator('[id^="ocd-precio-"]').first().fill('120.50')
  await ventana.getByRole('button', { name: 'Emitir orden de compra' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().waitFor({ timeout: 20000 })
  const aviso = await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().innerText()
  return { aviso, numero: (aviso.match(/OC-\d+-MW/) ?? [''])[0] }
}

// ------------------------------------------------ 4. Logística genera la OC desde el RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  comprobar((await fila.getByRole('button', { name: 'Generar OC' }).count()) === 1, 'sin stock: Logística ve «Generar OC»')
  await fila.getByRole('button', { name: 'Generar OC' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  const cabecera = await texto(ventana)
  comprobar(cabecera.includes(numeroRq) && cabecera.includes('PLA_SR_O4_1_26'), 'la ventana muestra el RQ y su código interno')
  comprobar((await ventana.locator('input[name="item"]').count()) === 2, 'ofrece los dos insumos')
  comprobar((await ventana.locator('#ocd-motivo').count()) === 0 && (await ventana.locator('#ocd-codigo').count()) === 0, 'sin motivo ni código a mano')
  const r1 = await llenarOc(pagina, ventana, { desmarcar: [2] })
  oc1 = r1.numero
  comprobar(oc1 !== '', `OC emitida desde el RQ: «${r1.aviso}»`)
  await pagina.waitForTimeout(800)
  let t = await texto(fila)
  comprobar(t.includes('En compra'), `el RQ pasa a «En compra»: ${t.slice(0, 140)}`)
  comprobar(t.includes(oc1), `el insumo 1 muestra la ${oc1}`)
  comprobar(t.includes(`Orden ${oc1}`), 'la nota de Logística dice qué orden')
  comprobar((await fila.getByRole('button', { name: 'Generar OC' }).count()) === 1, 'queda un insumo libre: sigue «Generar OC»')
  await pagina.screenshot({ path: `${CAPTURAS}/rq-con-oc.png`, fullPage: true })

  // La segunda OC, para el insumo 2: el 1 aparece ocupado.
  await fila.getByRole('button', { name: 'Generar OC' }).click()
  const ventana2 = pagina.locator('[role="dialog"]')
  comprobar(await ventana2.locator('input[name="item"][value="1"]').isDisabled(), 'el insumo 1 ya va en su OC y no se marca')
  const r2 = await llenarOc(pagina, ventana2)
  oc2 = r2.numero
  comprobar(oc2 !== '' && oc2 !== oc1, `segunda OC ${oc2} para el insumo 2`)
  await pagina.waitForTimeout(800)
  t = await texto(fila)
  comprobar(t.includes(oc2), `el insumo 2 muestra la ${oc2}`)
  comprobar((await fila.getByRole('button', { name: 'Generar OC' }).count()) === 0, 'todo comprado: ya no hay «Generar OC»')

  await pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  const filaOc = pagina.locator('tbody tr', { hasText: oc1 }).first()
  const tOc = await texto(filaOc)
  comprobar(tOc.includes(numeroRq), `Órdenes de compra: la ${oc1} dice que atiende ${numeroRq}`)
  comprobar(tOc.includes('PLA_SR_O4_1_26'), 'y lleva el código interno del RQ')
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 5. Gerencia rechaza la segunda OC
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  // La OC por aprobar es una tarjeta: se toma el bloque más cercano que lleva su botón.
  const fila = pagina.getByText(oc2).first().locator('xpath=ancestor::*[.//button[contains(., "Rechazar")]][1]')
  comprobar((await fila.count()) === 1, `Gerencia ve la ${oc2} por aprobar`)
  await fila.getByRole('button', { name: /Rechazar/ }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('textarea').fill('Precio fuera de mercado, cotiza con otro')
  await ventana.getByRole('button', { name: /Rechazar/ }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  const t = await texto(fila)
  comprobar(t.includes(`${oc2} rechazada`), `el insumo 2 se ve «${oc2} rechazada»`)
  comprobar(t.includes('En compra'), 'el RQ sigue «En compra»')
  comprobar((await fila.getByRole('button', { name: 'Generar OC' }).count()) === 1, 'vuelve «Generar OC» para comprar con otro')
  await fila.getByRole('button', { name: 'Generar OC' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  comprobar(await ventana.locator('input[name="item"][value="1"]').isDisabled(), 'el insumo 1 sigue ocupado')
  comprobar(await ventana.locator('input[name="item"][value="2"]').isChecked(), 'el insumo 2 viene marcado para volver a comprarse')
  await pagina.screenshot({ path: `${CAPTURAS}/rq-oc-rechazada.png`, fullPage: true })
  await contexto.close()
}

// ------------------------------------------------ 6. Requerimientos lo ve
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: numeroRq })
  const t = await texto(fila)
  comprobar(t.includes('En compra'), `Requerimientos ve ${numeroRq} en compra`)
  comprobar(!t.includes('Anular'), 'ya no puede anularlo')
  comprobar((await fila.getByRole('button', { name: 'Generar OC' }).count()) === 0, 'sin botones de Logística')
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

await navegador.close()
console.log(fallas.length === 0 ? `\nTODO EN VERDE (${numeroRq} con ${oc1} y ${oc2})` : `\n${fallas.length} FALLAS`)
process.exit(fallas.length === 0 ? 0 : 1)

/**
 * Recorre con clic real la factura de compra con varias OC, el aviso de monto
 * y el pago con voucher (migración 20261015122000), con la cuenta de cada
 * puesto (nunca ADMIN):
 *
 *   1. Logística tiene Adquisiciones en «Consultas», ve las OC que esperan su
 *      factura y no tiene el formulario.
 *   2. Contabilidad marca dos OC del mismo proveedor (la del otro proveedor se
 *      apaga), ve el aviso cuando el total no calza y cuando calza, y registra
 *      la factura. Registra otra a crédito que no calza: entra igual.
 *   3. Tesorería ve las dos en Cuentas por pagar (también la de contado), paga
 *      una parte con su voucher, anula ese pago con su motivo y la paga entera.
 *   4. Logística ve la factura pagada y no entra a Cuentas por pagar.
 *
 * Necesita en la base del banco las cuentas `*@banco.test` de cada puesto y las
 * OC directas QA-ADQ-1 y QA-ADQ-2 (mismo proveedor, contado, 1 180.00 y 118.00)
 * y QA-ADQ-3 (otro proveedor, crédito, 590.00). Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), CAPTURAS, BANCO_BASE, ARCHIVOS (con minimo.pdf y
 * voucher.pdf).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.ARCHIVOS ?? CAPTURAS
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

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

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await pagina.waitForLoadState('networkidle')
  return { pagina, contexto }
}

async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}

const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+$/, ''))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const [oc1, oc2, oc3] = await consulta(
  "select id, numero from ordenes_compra_materiales where referencia in ('QA-ADQ-1', 'QA-ADQ-2', 'QA-ADQ-3') order by referencia",
)
if (!oc3) throw new Error('Faltan las OC QA-ADQ-1, QA-ADQ-2 y QA-ADQ-3 en la base del banco.')

// ---------------------------------------------------------------- 1. Logística
{
  const { pagina, contexto } = await entrar('logistica@banco.test')
  const items = await menu(pagina)
  console.log('     menú de Logística:', items.join(' · '))
  comprobar(items.includes('Adquisiciones') && items.indexOf('Adquisiciones') > items.indexOf('Valorización del almacén') && items.indexOf('Valorización del almacén') > 0,
    'Logística tiene Adquisiciones en Consultas, después de su trabajo')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const cuerpo = limpio(await pagina.locator('main').textContent())
  comprobar(cuerpo.includes('OC que esperan su factura') && cuerpo.includes(oc1.numero) && cuerpo.includes(oc3.numero),
    'Logística ve las OC que esperan su factura')
  comprobar((await pagina.getByRole('button', { name: 'Registrar comprobante' }).count()) === 0, 'y no tiene el formulario de Contabilidad')
  await contexto.close()
}

// ------------------------------------------------------------- 2. Contabilidad
{
  const { pagina, contexto } = await entrar('contabilidad@banco.test')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const casilla = (oc) => pagina.locator(`input[name="ordenes_compra"][value="${oc.id}"]`)
  await casilla(oc1).check()
  comprobar(await casilla(oc3).isDisabled(), 'marcada una OC, la de otro proveedor se apaga')
  comprobar((await pagina.locator('#adq-proveedor').inputValue()) === 'FERRETERÍA DE PRUEBA S.A.C.', 'el proveedor sale solo de la OC')
  await casilla(oc2).check()
  await pagina.locator('#adq-total').fill('1300')
  const aviso = limpio(await pagina.locator('form').getByText('Las OC marcadas suman').textContent())
  console.log('     aviso:', aviso)
  comprobar(aviso.includes('1,298.00') && aviso.includes('sobran') && aviso.includes('2.00'), 'con 1 300.00 avisa que sobran 2.00 frente a las dos OC')
  await pagina.locator('#adq-total').fill('1298')
  comprobar((await pagina.locator('form').getByText('Calza con las OC marcadas').count()) === 1, 'con 1 298.00 dice que calza')
  await pagina.locator('#adq-numero').fill('F001-9001')
  await pagina.locator('#adq-emision').fill(hoy)
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await pagina.locator('#adq-pdf').setInputFiles(join(ARCHIVOS, 'minimo.pdf'))
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText('Comprobante F001-9001 registrado').waitFor({ timeout: 30000 }).catch(() => {})
  const error = limpio(await pagina.locator('form [role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  comprobar(!error && (await pagina.getByText('Comprobante F001-9001 registrado con 2 OC').count()) === 1, `la factura entra con sus dos OC${error ? ` (dijo «${error}»)` : ''}`)
  const fila = pagina.locator('article', { hasText: 'F001-9001' })
  const textoFila = limpio(await fila.textContent())
  comprobar(textoFila.includes('Calza con sus OC') && textoFila.includes('2 OC') && textoFila.includes(oc1.numero) && textoFila.includes(oc2.numero),
    'la lista la muestra con sus dos OC y «Calza con sus OC»')
  comprobar((await pagina.locator(`input[name="ordenes_compra"][value="${oc1.id}"]`).count()) === 0, 'sus OC ya no esperan factura')
  const enlaces = await consulta(
    `select count(*)::int as n from adquisiciones_ordenes_compra l join adquisiciones a on a.id = l.adquisicion_id
      where a.numero_documento = 'F001-9001' and a.estado = 'REGISTRADA'`,
  )
  comprobar(enlaces[0].n === 2, 'la base guarda la factura registrada con dos OC')

  // Otra, a crédito, que no calza: entra igual.
  await pagina.locator(`input[name="ordenes_compra"][value="${oc3.id}"]`).check()
  comprobar((await pagina.locator('#adq-condicion').inputValue()) === 'CREDITO', 'la condición de pago sale de la OC')
  await pagina.locator('#adq-numero').fill('F002-77')
  await pagina.locator('#adq-total').fill('600')
  await pagina.locator('#adq-emision').fill(hoy)
  const vence = new Date(Date.parse(`${hoy}T12:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10)
  await pagina.locator('#adq-vencimiento').fill(vence)
  await pagina.locator('#adq-pdf').setInputFiles(join(ARCHIVOS, 'minimo.pdf'))
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText('Comprobante F002-77 registrado').waitFor({ timeout: 30000 }).catch(() => {})
  const fila2 = limpio(await pagina.locator('article', { hasText: 'F002-77' }).textContent().catch(() => ''))
  comprobar(fila2.includes('No calza con sus OC') && fila2.includes('sobran') && fila2.includes('10.00'),
    'la que no calza entra igual y dice cuánto sobra')
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-contabilidad.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 3. Tesorería
{
  const { pagina, contexto } = await entrar('tesoreria@banco.test')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const factura = pagina.locator('article', { hasText: 'F001-9001' })
  const texto = limpio(await factura.textContent())
  comprobar(texto.includes('contado') && texto.includes('Saldo S/ 1,298.00') && texto.includes(oc1.numero),
    'la factura al contado le llega con su saldo y sus OC')
  comprobar((await pagina.locator('article', { hasText: 'F002-77' }).count()) === 1, 'la de crédito también')

  await factura.getByRole('button', { name: 'Registrar pago' }).click()
  let v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').fill('500')
  await v.locator('input[name="referencia"]').fill('OP-77001')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  let error = await esperarVentana(pagina)
  comprobar(!error, `paga una parte con su voucher${error ? ` (dijo «${error}»)` : ''}`)
  await factura.getByText('Saldo S/ 798.00').waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(limpio(await factura.textContent()).includes('Saldo S/ 798.00'), 'el saldo baja a 798.00')
  const voucher = await factura.getByRole('link', { name: 'Voucher' }).first().getAttribute('href').catch(() => null)
  comprobar(Boolean(voucher) && (await fetch(voucher)).status === 200, 'el voucher se abre')

  await factura.getByRole('button', { name: 'Anular' }).first().click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('El importe era el de otra factura.')
  await v.getByRole('button', { name: 'Anular' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `anula el pago con su motivo${error ? ` (dijo «${error}»)` : ''}`)
  await factura.getByText('Anulado:').waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(limpio(await factura.textContent()).includes('Saldo S/ 1,298.00') && limpio(await factura.textContent()).includes('Anulado: El importe'),
    'anulado, vuelve a su saldo y el pago queda tachado con su motivo')

  await factura.getByRole('button', { name: 'Registrar pago' }).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="referencia"]').fill('OP-77001')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `la paga entera con la misma operación${error ? ` (dijo «${error}»)` : ''}`)
  await pagina.getByText('Pagadas (1)').waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await pagina.getByText('Pagadas (1)').count()) === 1, 'pasa a «Pagadas»')
  const pagos = await consulta(
    `select count(*) filter (where p.anulado_en is null)::int as vigentes, count(*)::int as todos,
            bool_and(p.archivo_ruta is not null) as con_voucher
       from pagos_adquisicion p join adquisiciones a on a.id = p.adquisicion_id where a.numero_documento = 'F001-9001'`,
  )
  comprobar(pagos[0].vigentes === 1 && pagos[0].todos === 2 && pagos[0].con_voucher, 'la base guarda los dos pagos con su voucher, uno anulado')
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-tesoreria.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------- 4. Logística, después
{
  const { pagina, contexto } = await entrar('logistica@banco.test')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  comprobar(limpio(await pagina.locator('article', { hasText: 'F001-9001' }).textContent()).includes('Pagada'), 'Logística ve la factura pagada')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.getByRole('button', { name: 'Registrar pago' }).count()) === 0, 'Logística no paga facturas')
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length) console.log('\nErrores de consola:\n  ' + errores.join('\n  '))
console.log(`\n${fallas.length === 0 ? 'Todo bien' : `${fallas.length} fallas`} · capturas en ${CAPTURAS}`)
process.exit(fallas.length === 0 && errores.length === 0 ? 0 : 1)

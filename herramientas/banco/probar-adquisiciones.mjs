/**
 * Recorre con clic real la factura de compra con varias OC, el aviso de monto
 * y el pago con voucher (migración 20261015122000), y la tabla de
 * Adquisiciones con el enlace a cada documento, con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Logística tiene Adquisiciones en «Consultas», ve las OC que esperan su
 *      factura y no tiene el formulario.
 *   2. Contabilidad marca dos OC del mismo proveedor (la del otro proveedor se
 *      apaga), ve el aviso cuando el total no calza y cuando calza, y registra
 *      la factura. Registra otra a crédito que no calza: entra igual.
 *   3. Tesorería ve las dos en Cuentas por pagar (también la de contado), paga
 *      una parte con su voucher, anula ese pago con su motivo y la paga entera.
 *   4. Logística ve la factura pagada y no entra a Cuentas por pagar.
 *   4b. La tabla: cada fila va RQ → OC → factura (número y fecha) → pago, y cada
 *      código abre su documento (el RQ solo, el PDF de la OC, el de la factura,
 *      el voucher, el proveedor y, si falta pagarla, la factura en Cuentas por
 *      pagar). Logística
 *      no tiene el enlace a Cuentas por pagar; Ventas no entra. En el teléfono
 *      la tabla se desliza sin ensanchar la página.
 *   5. Si están las OS QA-OS-1 (afecta al 12 %, 2 000.00 sin IGV) y QA-OS-2 (no
 *      sujeta), Tesorería ve en Pagos de servicio cuánto va al Banco de la
 *      Nación (migración 20261015141000).
 *
 * Necesita en la base del banco las cuentas `*@banco.test` de cada puesto y las
 * OC directas QA-ADQ-1 y QA-ADQ-2 (mismo proveedor, contado, 1 180.00 y 118.00)
 * y QA-ADQ-3 (otro proveedor, crédito, 590.00). Si los RQ RQ-0901-2026 (con
 * QA-ADQ-1) y RQ-0902-2026 (con QA-ADQ-2 y QA-ADQ-3) están, mira también sus
 * enlaces. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), CAPTURAS, BANCO_BASE, ARCHIVOS (con minimo.pdf y
 * voucher.pdf).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba, elegirCuenta } from './caja-de-prueba.mjs'

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

/** El texto de todas las filas de una factura: la primera la nombra y las demás siguen hasta su rowspan. */
async function grupo(pagina, numero) {
  const primera = pagina.locator('tbody tr', { hasText: numero }).first()
  if ((await primera.count()) === 0) return ''
  const alto = Number((await primera.locator('td[rowspan]').first().getAttribute('rowspan').catch(() => '1')) ?? 1)
  const textos = [await primera.textContent()]
  for (let i = 1; i < alto; i++) textos.push(await primera.locator(`xpath=following-sibling::tr[${i}]`).textContent())
  return textos.join(' ')
}

/** Lo que devuelve un enlace con la sesión de la página: estado y tipo. */
async function abrir(pagina, href) {
  const r = await pagina.request.get(new URL(href, BASE).toString())
  return { estado: r.status(), tipo: r.headers()['content-type'] ?? '' }
}

const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+$/, ''))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const [oc1, oc2, oc3] = await consulta(
  "select id, numero from ordenes_compra_materiales where referencia in ('QA-ADQ-1', 'QA-ADQ-2', 'QA-ADQ-3') order by referencia",
)
if (!oc3) throw new Error('Faltan las OC QA-ADQ-1, QA-ADQ-2 y QA-ADQ-3 en la base del banco.')
// Cada pago pide la cuenta de la caja de la que salió (migración 20261019100000).
const CAJA = await crearCajaDePrueba(consulta, 'tesoreria@banco.test')

// ---------------------------------------------------------------- 1. Logística
{
  const { pagina, contexto } = await entrar('logistica@banco.test')
  const items = await menu(pagina)
  console.log('     menú de Logística:', items.join(' · '))
  // Desde #96 sus Consultas van Adquisiciones, Proveedores y Valorización, después de su trabajo.
  comprobar(items.includes('Adquisiciones') && items.indexOf('Adquisiciones') > items.indexOf('Órdenes de servicio') && items.indexOf('Órdenes de servicio') > 0,
    'Logística tiene Adquisiciones en Consultas, después de su trabajo')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const cuerpo = limpio(await pagina.locator('main').textContent())
  comprobar(cuerpo.includes('OC que esperan su factura') && cuerpo.includes(oc1.numero) && cuerpo.includes(oc3.numero),
    'Logística ve las OC que esperan su factura')
  comprobar((await pagina.getByRole('button', { name: 'Registrar comprobante' }).count()) === 0, 'y no tiene el formulario de Contabilidad')
  await contexto.close()
}

// ------------------------------------------------------------- 2. Contabilidad
{
  const { pagina, contexto } = await entrar('contabilidad@banco.test')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
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
  const textoFila = limpio(await grupo(pagina, 'F001-9001'))
  comprobar(textoFila.includes('Calza con sus OC') && textoFila.includes(oc1.numero) && textoFila.includes(oc2.numero),
    'la tabla la muestra con sus dos OC y «Calza con sus OC»')
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
  await pagina.locator('tbody tr', { hasText: 'F002-77' }).first().waitFor({ timeout: 15000 }).catch(() => {})
  const fila2 = limpio(await grupo(pagina, 'F002-77'))
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
  await elegirCuenta(v, CAJA)
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
  await elegirCuenta(v, CAJA)
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
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  comprobar(limpio(await grupo(pagina, 'F001-9001')).includes('Pagada'), 'Logística ve la factura pagada')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.getByRole('button', { name: 'Registrar pago' }).count()) === 0, 'Logística no paga facturas')
  await contexto.close()
}

// --------------------------------------------- 4b. La tabla y sus enlaces
const [rq1, rq2] = await consulta("select id, numero from requerimientos where numero in ('RQ-0901-2026', 'RQ-0902-2026') order by numero")
{
  const { pagina, contexto } = await entrar('tesoreria@banco.test')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const cabeza = (await pagina.locator('thead th').allTextContents()).map(limpio)
  console.log('     columnas:', cabeza.join(' · '))
  comprobar(cabeza.slice(0, 4).join('|') === 'RQ|OC|Factura|Fecha de factura', 'las columnas van RQ, OC, factura y su fecha')
  const primera = pagina.locator('tbody tr', { hasText: 'F001-9001' }).first()
  const celdas = (await primera.locator('td').allTextContents()).map(limpio)
  console.log('     fila de F001-9001:', celdas.join(' | '))
  comprobar(celdas[1].startsWith(oc1.numero) && celdas[2].startsWith('F001-9001') && /^\d{2}\/\d{2}\/\d{4}/.test(celdas[3]),
    'la fila va OC, factura con su número y la fecha de la factura')
  comprobar((await primera.locator('td[rowspan="2"]').count()) >= 4, 'las celdas de la factura abarcan sus dos OC')

  const ocHref = await primera.getByRole('link', { name: oc1.numero }).getAttribute('href')
  const oc = await abrir(pagina, ocHref)
  comprobar(oc.estado === 200 && oc.tipo.includes('pdf'), `la OC abre su PDF (${oc.estado} ${oc.tipo})`)
  const facturaHref = await primera.getByRole('link', { name: 'F001-9001' }).getAttribute('href')
  const factura = await abrir(pagina, facturaHref)
  comprobar(factura.estado === 200, `la factura abre su PDF (${factura.estado})`)
  const voucherHref = await primera.getByRole('link', { name: 'Voucher' }).first().getAttribute('href').catch(() => null)
  comprobar(Boolean(voucherHref) && (await abrir(pagina, voucherHref)).estado === 200, 'el voucher del pago se abre')
  comprobar(!limpio(await primera.textContent()).includes('Anulado'), 'el pago anulado no sale en la tabla')

  // La pagada ya trae sus vouchers: solo la que falta pagar lleva a Cuentas por pagar.
  comprobar((await primera.getByRole('link', { name: 'Pagar en Cuentas por pagar' }).count()) === 0, 'la factura pagada no manda a pagarla')
  const aPagar = await pagina.locator('tbody tr', { hasText: 'F002-77' }).first().getByRole('link', { name: 'Pagar en Cuentas por pagar' }).getAttribute('href')
  await pagina.goto(new URL(aPagar, BASE).toString(), { waitUntil: 'networkidle' })
  const destino = decodeURIComponent(new URL(pagina.url()).hash.slice(1))
  comprobar(destino.startsWith('factura-') && limpio(await pagina.locator(`[id="${destino}"]`).textContent().catch(() => '')).includes('F002-77'),
    'Tesorería salta a pagar la que falta en Cuentas por pagar')

  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  await pagina.locator('tbody tr', { hasText: 'F001-9001' }).first().getByRole('link', { name: 'FERRETERÍA DE PRUEBA S.A.C.' }).click()
  await pagina.getByText('RUC 20100055008').waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(limpio(await pagina.locator('main').textContent()).includes('20100055008'), 'el proveedor abre su ficha en Proveedores')

  if (rq2) {
    await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
    const texto = limpio(await grupo(pagina, 'F001-9001'))
    comprobar(texto.includes(rq1.numero) && texto.includes(rq2.numero), 'la factura muestra los dos RQ que cubre')
    const credito = pagina.locator('tbody tr', { hasText: 'F002-77' }).first()
    comprobar(limpio(await credito.locator('td').first().textContent()) === rq2.numero, 'la OC a crédito muestra su RQ')
    await pagina.locator('tbody tr', { hasText: 'F001-9001' }).first().getByRole('link', { name: rq1.numero }).click()
    await pagina.getByText(`Solo el ${rq1.numero}`).waitFor({ timeout: 15000 }).catch(() => {})
    const filas = await pagina.locator('tbody tr').count()
    const rq = limpio(await pagina.locator('main').textContent())
    comprobar(filas === 1 && rq.includes(rq1.numero) && rq.includes(`Solo el ${rq1.numero}`), `el RQ abre solo ese RQ (${filas} filas)`)
  }
  await pagina.goto(`${BASE}/adquisiciones?vista=sin-factura`, { waitUntil: 'networkidle' })
  const sinFactura = limpio(await pagina.locator('table').textContent())
  comprobar(sinFactura.includes('OC que esperan su factura') && !sinFactura.includes('F001-9001'), '«Sin factura» deja solo las OC que esperan su factura')
  await pagina.goto(`${BASE}/adquisiciones?vista=no-calzan`, { waitUntil: 'networkidle' })
  const noCalzan = limpio(await pagina.locator('table').textContent())
  comprobar(noCalzan.includes('F002-77') && !noCalzan.includes('F001-9001'), '«No calzan» deja solo la que no calza')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-tabla-tesoreria.png'), fullPage: true })
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('logistica@banco.test')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const primera = pagina.locator('tbody tr', { hasText: 'F001-9001' }).first()
  comprobar((await pagina.getByRole('link', { name: 'Pagar en Cuentas por pagar' }).count()) === 0, 'Logística no tiene el enlace a Cuentas por pagar')
  const oc = await abrir(pagina, await primera.getByRole('link', { name: oc1.numero }).getAttribute('href'))
  comprobar(oc.estado === 200 && oc.tipo.includes('pdf'), 'Logística abre el PDF de la OC')
  if (rq1) comprobar((await primera.getByRole('link', { name: rq1.numero }).count()) === 1, 'y el RQ')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('logistica@banco.test', { width: 390, height: 844 })
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  comprobar(ancho[0] <= ancho[1], `en el teléfono la página no se ensancha (${ancho[0]} de ${ancho[1]} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-tabla-telefono.png'), fullPage: true })
  await contexto.close()
}
if ((await consulta("select 1 from usuarios where correo = 'ventas@banco.test'")).length) {
  const { pagina, contexto } = await entrar('ventas@banco.test')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'Ventas no entra a Adquisiciones')
  await contexto.close()
}

// ------------------------------------------- 5. La detracción en Pagos de servicio
if ((await consulta(`select 1 from ordenes_servicio where referencia in ('QA-OS-1', 'QA-OS-2')`)).length === 2) {
  const { pagina, contexto } = await entrar('tesoreria@banco.test')
  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  const afecta = limpio(await pagina.locator('article', { hasText: 'Arenado y pintado' }).textContent().catch(() => ''))
  comprobar(afecta.includes('Detracción 12 %: S/ 283.00') && afecta.includes('Banco de la Nación') && afecta.includes('código PLANTA'),
    'Tesorería ve la detracción de la OS: 12 % de 2 360.00 con IGV, al Banco de la Nación')
  const noSujeta = limpio(await pagina.locator('article', { hasText: 'Torneado de pines' }).textContent().catch(() => ''))
  comprobar(noSujeta.includes('No sujeta a detracción') && !noSujeta.includes('Banco de la Nación'), 'y la que no está sujeta lo dice')
  await pagina.screenshot({ path: join(CAPTURAS, 'pagos-de-servicio-tesoreria.png'), fullPage: true })
  await contexto.close()
} else {
  console.log('· sin las OS QA-OS-1 y QA-OS-2: no se mira la detracción en Pagos de servicio')
}

await navegador.close()
await base.end()
if (errores.length) console.log('\nErrores de consola:\n  ' + errores.join('\n  '))
console.log(`\n${fallas.length === 0 ? 'Todo bien' : `${fallas.length} fallas`} · capturas en ${CAPTURAS}`)
process.exit(fallas.length === 0 && errores.length === 0 ? 0 : 1)

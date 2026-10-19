/**
 * Recorre con clic real la factura de venta colgada del código interno
 * (migraciones 20261015124000 y 20261015125000), con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Contabilidad tiene su menú (Facturación primero; el kardex y la
 *      cotización en Consultas; la OT ya no) y en Facturación ve cada
 *      cotización aprobada por su código interno, con el RUC y la dirección.
 *      La que espera su OT no ofrece registrar factura. Registra la factura
 *      (primero con un número mal escrito, que se rechaza); el aviso de que lo
 *      facturado pasa de la cotización sale sin impedir nada. Ve el kardex sin
 *      botones de ingreso ni salida.
 *   2. Tesorería tiene sus cuatro (Adquisiciones, Cuentas por cobrar, Cuentas
 *      por pagar y Pagos de servicio) y la cotización en Consultas; ve la
 *      factura con su código y su PDF y la cobra a cuenta con su voucher; paga
 *      la orden de servicio conforme con su voucher. En el teléfono, sus
 *      cuatro pestañas.
 *   3. Contabilidad ya no ofrece anular la factura cobrada; Gerencia ve en la
 *      cotización la factura y su estado, y no tiene la OT en su menú.
 *   4. Supervisión General ya no ve la cotización; Diseño tampoco; Logística no
 *      entra a Facturación ni a los pagos de servicio.
 *
 * Necesita en la base del banco las cuentas `*@banco.test` de cada puesto, la
 * cotización 3901-2026 aprobada con su OT y el código QA-CI 3901, la 3902-2026
 * aprobada sin OT y la OS-0001-MW aprobada y conforme. Variables: BANCO_CLAVE,
 * BASE (http://localhost:3111), CAPTURAS, BANCO_BASE, ARCHIVOS (con
 * E001-626.pdf y voucher.pdf).
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
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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
  // El dashboard llega por partes: las cifras pueden pintarse después de la URL.
  await pagina.waitForLoadState('networkidle')
  return { pagina, contexto }
}

/** Espera a que la ventana abierta se cierre (la acción salió bien) o muestre su error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}

// El globo de pendientes va pegado al nombre del módulo («Facturación1»): se quita.
const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+$/, ''))
const franja = async (pagina) => limpio(await pagina.locator('main').textContent())
// Lo que espera en un módulo ya no se lista en el Dashboard (2026-10-19): se lee
// del globo del menú, que lleva la cantidad en su etiqueta accesible.
const globo = async (pagina, ruta) => (await pagina.locator(`nav a[href="${ruta}"]`).first().getAttribute('aria-label')) ?? ''
const ruta = (pagina) => new URL(pagina.url()).pathname

// ---------------------------------------------------------- 1. Contabilidad
{
  const { pagina, contexto } = await entrar('contabilidad@banco.test')
  const items = await menu(pagina)
  console.log('     menú de Contabilidad:', items.join(' · '))
  comprobar(items.indexOf('Facturación') === 1, 'el menú de Contabilidad trae Facturación primero')
  comprobar(items.includes('Kardex') && items.includes('Cotización') && !items.includes('Órdenes de trabajo'), 'con el Kardex y la Cotización en Consultas, y sin la OT')
  comprobar(/, 1 pendiente$/.test(await globo(pagina, '/contabilidad/facturacion')), 'el menú de Contabilidad cuenta la cotización por facturar')

  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('li[data-cotizacion="3901-2026"]')
  const texto = limpio(await tarjeta.textContent())
  comprobar(texto.includes('Código QA-CI 3901') && texto.includes('Por facturar') && texto.includes('20990000345') && texto.includes('Av. de Prueba 345'),
    'Facturación trae la cotización por su código interno, con el RUC y la dirección fiscal')
  const sinCodigo = pagina.locator('li[data-cotizacion="3902-2026"]')
  const textoSin = limpio(await sinCodigo.textContent())
  comprobar(textoSin.includes('Sin código interno') && (await sinCodigo.getByRole('button', { name: 'Registrar factura' }).count()) === 0,
    'la cotización que espera su OT dice que le falta el código y no ofrece registrar factura')
  const orden = await pagina.locator('li[data-cotizacion]').evaluateAll((l) => l.map((e) => e.getAttribute('data-cotizacion')))
  comprobar(orden[0] === '3901-2026', 'la que se puede facturar va primero')
  const enlace = await tarjeta.getByRole('link', { name: 'Abrir la cotización' }).getAttribute('href')
  comprobar(Boolean(enlace) && (await fetch(enlace)).status === 200, 'Contabilidad abre el PDF de la cotización')

  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="numero"]').fill('factura 626')
  await v.locator('input[name="concepto"]').fill('Inicial 50 %')
  await v.locator('select[name="moneda"]').selectOption('USD')
  await v.locator('input[name="total"]').fill('29500')
  comprobar((await v.locator('[role="status"]').count()) === 0, 'sin aviso mientras lo facturado no pasa de la cotización')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'E001-626.pdf'))
  await v.getByRole('button', { name: 'Registrar la factura' }).click()
  const error = await esperarVentana(pagina)
  comprobar(error.includes('E001-626'), `un número mal escrito se rechaza con su ejemplo («${error}»)`)
  await v.locator('input[name="numero"]').fill('e001-00000626')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'E001-626.pdf'))
  await v.getByRole('button', { name: 'Registrar la factura' }).click()
  const error2 = await esperarVentana(pagina)
  comprobar(error2 === '', `la factura se registra${error2 ? ` (dijo: ${error2})` : ''}`)
  await tarjeta.getByText('Factura E001-626').waitFor({ timeout: 30000 }).catch(() => {})
  const despues = limpio(await tarjeta.textContent())
  comprobar(despues.includes('Facturada') && despues.includes('Por cobrar'), 'la cotización queda «Facturada» y la factura «Por cobrar»')
  const [f] = await consulta(`select numero, codigo_interno, total, moneda from facturas_venta where cotizacion_numero = '3901-2026' and anulada_en is null`)
  comprobar(f?.numero === 'E001-626' && f.codigo_interno === 'QA-CI 3901' && Number(f.total) === 29500 && f.moneda === 'USD',
    'la base guarda E001-626 por US$ 29 500 en el código QA-CI 3901')
  const huerfanos = await consulta(`select name from storage.objects o where bucket_id = 'facturas-venta' and not exists (select 1 from facturas_venta f where f.ruta_storage = o.name)`)
  comprobar(huerfanos.length === 0, 'el PDF del intento rechazado no quedó suelto en el almacenamiento')

  // Una segunda factura que pasa del total: avisa y no impide.
  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  await v.locator('select[name="moneda"]').selectOption('USD')
  await v.locator('input[name="total"]').fill('30000')
  const aviso = limpio(await v.locator('[role="status"]').textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(aviso.includes('regístrala igual'), `si lo facturado pasa de la cotización, avisa sin impedir («${aviso}»)`)
  comprobar(await v.getByRole('button', { name: 'Registrar la factura' }).isEnabled(), 'y el botón sigue disponible')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-1-contabilidad.png'), fullPage: true })

  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
  const kardex = await franja(pagina)
  comprobar(kardex.includes('GR T001-123') || kardex.includes('Plancha LAC'), 'Contabilidad ve el kardex con el ingreso y su guía')
  comprobar((await pagina.getByRole('button', { name: /Registrar (ingreso|salida)/ }).count()) === 0, 'y no tiene botones de ingreso ni salida')
  await contexto.close()
}

// -------------------------------------------------------------- 2. Tesorería
{
  // Cada pago y cada cobro pide su cuenta de la caja (migración 20261019100000): la factura es en dólares.
  const cajaSoles = await crearCajaDePrueba(consulta, 'tesoreria@banco.test')
  const cajaDolares = await crearCajaDePrueba(consulta, 'tesoreria@banco.test', 'USD')
  const { pagina, contexto } = await entrar('tesoreria@banco.test')
  const items = await menu(pagina)
  console.log('     menú de Tesorería:', items.join(' · '))
  const orden = ['Adquisiciones', 'Cuentas por cobrar', 'Cuentas por pagar', 'Pagos de servicio', 'Recibos por honorarios', 'Planilla diaria', 'Tipo de cambio']
  comprobar(orden.every((t, i) => items.indexOf(t) === i + 1), 'el menú de Tesorería va Adquisiciones, por cobrar, por pagar, pagos de servicio')
  comprobar(items.includes('Cotización') && !items.includes('Órdenes de trabajo'), 'con la Cotización en Consultas, y sin la OT')
  comprobar(
    /, 1 pendiente$/.test(await globo(pagina, '/tesoreria/por-cobrar')) && /, 1 pendiente$/.test(await globo(pagina, '/tesoreria/pagos-de-servicio')),
    'el menú de Tesorería cuenta la factura por cobrar y el servicio por pagar',
  )

  await pagina.goto(`${BASE}/tesoreria`, { waitUntil: 'networkidle' })
  comprobar(ruta(pagina) === '/tesoreria/por-cobrar', 'la dirección vieja lleva a Cuentas por cobrar')
  const factura = pagina.locator('article[data-factura="E001-626"]')
  const texto = limpio(await factura.textContent())
  comprobar(texto.includes('TRANSPORTES DE PRUEBA') && texto.includes('código QA-CI 3901') && texto.includes('cotización 3901-2026') && texto.includes('Inicial 50 %'),
    'la factura llega con cliente, código interno, cotización y concepto')
  const pdf = await factura.getByRole('link', { name: 'Abrir la factura' }).getAttribute('href')
  comprobar(Boolean(pdf) && (await fetch(pdf)).status === 200, 'Tesorería abre el PDF de la factura')

  await factura.getByRole('button', { name: 'Registrar cobro' }).click()
  const v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('input[name="monto"]').inputValue()) === '29500.00', 'el cobro propone el saldo de la factura')
  await v.locator('input[name="monto"]').fill('10000')
  await v.locator('input[name="operacion"]').fill('OP-000123')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await elegirCuenta(v, cajaDolares)
  await v.getByRole('button', { name: 'Registrar el cobro' }).click()
  const e1 = await esperarVentana(pagina)
  comprobar(e1 === '', `el cobro a cuenta entra con su voucher${e1 ? ` (dijo: ${e1})` : ''}`)
  await factura.getByText('Cobro a cuenta').waitFor({ timeout: 30000 }).catch(() => {})
  const [s] = await consulta(`select saldo, cobrado from v_facturas_venta where numero = 'E001-626'`)
  comprobar(Number(s?.saldo) === 19500 && Number(s?.cobrado) === 10000, 'el cobro baja el saldo a 19 500')
  const cobrada = limpio(await factura.textContent())
  comprobar(cobrada.includes('OP-000123') && cobrada.includes('Cobro a cuenta'), 'el cobro sale en la factura, que queda «Cobro a cuenta»')
  const voucher = await factura.getByRole('link', { name: 'Voucher' }).getAttribute('href')
  comprobar(Boolean(voucher) && (await fetch(voucher)).status === 200, 'y su voucher se abre')
  const aprobadas = limpio(await pagina.locator('[data-cotizacion="3901-2026"]').textContent())
  comprobar(aprobadas.includes('Código QA-CI 3901') && aprobadas.includes('Facturado') && aprobadas.includes('cobrado'),
    'debajo, la cotización aprobada con lo facturado y lo cobrado')
  comprobar(limpio(await pagina.locator('[data-cotizacion="3902-2026"]').textContent()).includes('Falta cargar la OT'), 'y la que espera su OT')
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-2-por-cobrar.png'), fullPage: true })

  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  const os = pagina.locator('article', { hasText: 'OS-0001-MW' })
  const textoOs = limpio(await os.textContent())
  comprobar(textoOs.includes('ARENADOS DE PRUEBA') && textoOs.includes('BCP') && textoOs.includes('código QA-CI 3901'), 'Tesorería ve la OS con su código interno y la cuenta del proveedor')
  await os.getByRole('button', { name: 'Registrar pago' }).click()
  await v.locator('input[name="monto"]').fill('500')
  await v.locator('select[name="cancela"]').selectOption('no')
  await v.locator('input[name="operacion"]').fill('OP-777')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await elegirCuenta(v, cajaSoles)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const e2 = await esperarVentana(pagina)
  comprobar(e2 === '', `el pago a cuenta de la OS entra${e2 ? ` (dijo: ${e2})` : ''}`)
  await pagina.getByText('Pagada en parte').first().waitFor({ timeout: 30000 }).catch(() => {})
  const pagos = await consulta(`select count(*)::int n, sum(monto)::numeric s from pagos_orden_servicio where anulado_en is null`)
  comprobar(pagos[0].n === 1 && Number(pagos[0].s) === 500, 'la base guarda el pago de 500')
  await contexto.close()

  const telefono = await entrar('tesoreria@banco.test', { width: 390, height: 844 })
  const pestanas = (await telefono.pagina.locator('nav[aria-label="Secciones"] li').allTextContents()).map(limpio)
  console.log('     pestañas de Tesorería:', pestanas.join(' · '))
  comprobar(['Compras', 'Por cobrar', 'Por pagar', 'Servicios'].every((t, i) => pestanas[i]?.replace(/^\d+/, '').startsWith(t)), 'en el teléfono, sus cuatro pestañas en orden')
  await telefono.pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `Cuentas por cobrar cabe en el teléfono (${ancho}px)`)
  await telefono.pagina.screenshot({ path: join(CAPTURAS, 'facturacion-3-telefono.png'), fullPage: true })
  await telefono.contexto.close()
}

// ------------------------------------------- 3. Contabilidad y Gerencia, después
{
  const { pagina, contexto } = await entrar('contabilidad@banco.test')
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const factura = pagina.locator('article[data-factura="E001-626"]')
  comprobar((await factura.getByRole('button', { name: 'Anular' }).count()) === 0, 'la factura con un cobro ya no ofrece «Anular» a Contabilidad')
  comprobar(limpio(await factura.textContent()).includes('OP-000123'), 'y Contabilidad ve el cobro con su voucher')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('gerencia@banco.test')
  const items = await menu(pagina)
  comprobar(!items.includes('Órdenes de trabajo') && items.includes('Códigos internos'), 'Gerencia sigue cada trabajo en Códigos internos, sin la OT en su menú')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const fila = limpio(await pagina.locator('li', { hasText: '3901-2026' }).first().textContent())
  comprobar(fila.includes('Factura E001-626') && fila.includes('cobro a cuenta'), 'en la cotización, Gerencia ve la factura y en qué va su cobro')
  // Gerencia ve todo por código: lo vendido junto a lo gastado, y la factura con su cobro.
  await pagina.goto(`${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent('QA-CI 3901')}`, { waitUntil: 'networkidle' })
  const linea = limpio(await pagina.locator('[data-facturado]').textContent().catch(() => ''))
  comprobar(linea.includes('Facturado') && linea.includes('cobrado'), `en Códigos internos, Gerencia ve lo facturado y lo cobrado del código («${linea.slice(0, 110)}»)`)
  await pagina.getByRole('link', { name: 'Ver factura y cobro' }).click()
  await pagina.waitForURL((u) => u.searchParams.get('vista') === 'facturacion').catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const enCodigo = pagina.locator('article[data-factura="E001-626"]')
  comprobar((await enCodigo.count()) === 1 && limpio(await enCodigo.textContent()).includes('OP-000123'), 'y en «Factura y cobro», la factura con su cobro')
  comprobar((await pagina.locator('li[data-cotizacion="3901-2026"]').count()) === 1, 'con la cotización aprobada del código')
  comprobar((await pagina.locator('main button', { hasText: /Anular|Registrar/ }).count()) === 0, 'sin botones de anular ni registrar: Gerencia solo consulta')
  const pdfFactura = await enCodigo.getByRole('link', { name: 'Abrir la factura' }).getAttribute('href').catch(() => null)
  comprobar(Boolean(pdfFactura) && (await fetch(pdfFactura)).status === 200, 'y abre el PDF de la factura')
  await pagina.screenshot({ path: join(CAPTURAS, 'gerencia-codigo-factura.png'), fullPage: true })
  await contexto.close()
}

// ------------------------------------------------- 4. Lo que no se puede
{
  const { pagina, contexto } = await entrar('general@banco.test')
  const items = await menu(pagina)
  comprobar(!items.includes('Cotización'), 'Supervisión General ya no tiene la cotización en su menú')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  comprobar(ruta(pagina) === '/sin-permiso', 'ni la abre por su dirección')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('diseno@banco.test')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  comprobar(ruta(pagina) === '/sin-permiso', 'Diseño ve la OT, no la cotización')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('logistica@banco.test')
  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  comprobar(ruta(pagina) === '/sin-permiso', 'Logística no entra a los pagos de servicio')
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  comprobar(ruta(pagina) === '/sin-permiso', 'ni a Facturación')
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)

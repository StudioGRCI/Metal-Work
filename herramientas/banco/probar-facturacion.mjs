/**
 * Recorre con clic real la OT que pasa por Contabilidad (migración
 * 20261015120000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Ventas ve que la cotización con OT espera a Administración, sin botón.
 *   2. Administración la ve en su tablero y en Cotización, y la envía a
 *      Contabilidad; la que no tiene OT no se puede enviar.
 *   3. Contabilidad tiene su menú (Facturación primero, el kardex en Consultas),
 *      ve la cotización con el RUC y la OT, anexa la factura (primero con un
 *      número mal escrito, que se rechaza) y la envía a Tesorería. Ve el kardex
 *      sin botones de ingreso ni salida.
 *   4. Tesorería tiene sus cuatro (Adquisiciones, Cuentas por cobrar, Cuentas
 *      por pagar y Pagos de servicio), ve la factura con su PDF y registra un
 *      cobro; paga la orden de servicio conforme, primero a cuenta y después la
 *      cancela, con el voucher.
 *   5. Contabilidad ya no puede anular la factura cobrada; Logística no entra a
 *      los pagos de servicio. En el teléfono, las pestañas de Tesorería.
 *
 * Necesita en la base del banco las cuentas `*@banco.test` de cada puesto, la
 * cotización 3901-2026 aprobada con su OT, la 3902-2026 sin OT y la OS-0001-MW
 * aprobada y conforme. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * CAPTURAS, BANCO_BASE, ARCHIVOS (con E001-626.pdf y voucher.pdf).
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
  // El tablero llega por partes: «Te toca» puede pintarse después de la URL.
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

// ------------------------------------------------------------- 1. Ventas
{
  const { pagina, contexto } = await entrar('ventas@banco.test')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('li', { hasText: '3901-2026' })
  comprobar((await fila.getByRole('button', { name: 'Enviar a Contabilidad' }).count()) === 0, 'Ventas no tiene «Enviar a Contabilidad»')
  comprobar((await fila.textContent()).includes('Falta que Administración la envíe a Contabilidad'), 'Ventas ve que la cotización con OT espera a Administración')
  await contexto.close()
}

// ------------------------------------------------------ 2. Administración
{
  const { pagina, contexto } = await entrar('oficina@banco.test')
  comprobar((await franja(pagina)).includes('1Cotización con OT por enviar a Contabilidad'), 'el tablero de Administración cuenta la cotización por enviar')
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=POR_ENVIAR`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('li', { hasText: '3901-2026' }).count()) === 1 && (await pagina.locator('li', { hasText: '3902-2026' }).count()) === 0,
    'el filtro «Por enviar a Contabilidad» trae solo la que tiene OT')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('li', { hasText: '3902-2026' }).getByRole('button', { name: 'Enviar a Contabilidad' }).count()) === 0, 'la cotización sin OT no tiene «Enviar a Contabilidad»')
  comprobar((await pagina.getByRole('button', { name: 'Liberar a Tesorería' }).count()) === 0, 'ya no está «Liberar a Tesorería»')
  const fila = pagina.locator('li', { hasText: '3901-2026' })
  await fila.getByRole('button', { name: 'Enviar a Contabilidad' }).click()
  await fila.getByText('Enviada a Contabilidad el').waitFor({ timeout: 30000 }).catch(() => {})
  comprobar((await fila.textContent()).includes('Enviada a Contabilidad el'), 'Administración envía la cotización y la fila lo dice')
  const [envio] = await consulta(`select e.id, o.numero from cotizaciones_envios_contabilidad e join ordenes_trabajo o on o.id = e.orden_id
                                   join cotizaciones_pdf c on c.id = e.cotizacion_pdf_id where c.numero = '3901-2026'`)
  comprobar(envio?.numero === '2990-2026', 'la base guarda el envío con su OT')
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-1-administracion.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------- 3. Contabilidad
{
  const { pagina, contexto } = await entrar('contabilidad@banco.test')
  const items = await menu(pagina)
  console.log('     menú de Contabilidad:', items.join(' · '))
  comprobar(items.indexOf('Facturación') === 1 && items.includes('Kardex') && items.indexOf('Kardex') > items.indexOf('Tipo de cambio'),
    'el menú de Contabilidad trae Facturación primero y el Kardex en Consultas')
  comprobar((await franja(pagina)).includes('1Cotización por facturar'), 'el tablero de Contabilidad cuenta la cotización por facturar')

  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('li', { hasText: 'Cotización 3901-2026' })
  const texto = limpio(await tarjeta.textContent())
  comprobar(texto.includes('RUC 20990000345') && texto.includes('Av. de Prueba 345') && texto.includes('OT 2990-2026') && texto.includes('Por facturar'),
    'Facturación trae la cotización con el RUC, la dirección fiscal y la OT')
  const enlace = await tarjeta.getByRole('link', { name: 'Abrir la cotización' }).getAttribute('href')
  comprobar(Boolean(enlace) && (await fetch(enlace)).status === 200, 'Contabilidad abre el PDF de la cotización')

  await tarjeta.getByRole('button', { name: 'Anexar factura' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="numero"]').fill('factura 626')
  await v.locator('input[name="concepto"]').fill('Inicial 50 %')
  await v.locator('input[name="total"]').fill('29500')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'E001-626.pdf'))
  await v.getByRole('button', { name: 'Anexar la factura' }).click()
  const error = await esperarVentana(pagina)
  comprobar(error.includes('E001-626'), `un número mal escrito se rechaza con su ejemplo («${error}»)`)
  await v.locator('input[name="numero"]').fill('e001-00000626')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'E001-626.pdf'))
  await v.getByRole('button', { name: 'Anexar la factura' }).click()
  const error2 = await esperarVentana(pagina)
  comprobar(error2 === '', `la factura se anexa${error2 ? ` (dijo: ${error2})` : ''}`)
  await tarjeta.getByText('Factura E001-626').waitFor({ timeout: 30000 }).catch(() => {})
  comprobar(limpio(await tarjeta.textContent()).includes('Por enviar a Tesorería'), 'la factura queda «Por enviar a Tesorería»')
  const [f] = await consulta(`select numero, estado, total, ruta_storage from facturas_venta where cotizacion_numero = '3901-2026' and estado <> 'ANULADA'`)
  comprobar(f?.numero === 'E001-626' && Number(f.total) === 29500, 'la base guarda E001-626 por 29 500')
  const huerfanos = await consulta(`select name from storage.objects o where bucket_id = 'facturas-venta' and not exists (select 1 from facturas_venta f where f.ruta_storage = o.name)`)
  comprobar(huerfanos.length === 0, 'el PDF del intento rechazado no quedó suelto en el almacenamiento')

  await tarjeta.getByRole('button', { name: 'Enviar a Tesorería' }).click()
  await tarjeta.getByText('En Tesorería', { exact: true }).first().waitFor({ timeout: 30000 }).catch(() => {})
  comprobar(limpio(await tarjeta.textContent()).includes('en Tesorería desde el'), 'Contabilidad envía la factura a Tesorería')
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-2-contabilidad.png'), fullPage: true })

  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
  const kardex = await franja(pagina)
  comprobar(kardex.includes('GR T001-123') || kardex.includes('Plancha LAC'), 'Contabilidad ve el kardex con el ingreso y su guía')
  comprobar((await pagina.getByRole('button', { name: /Registrar (ingreso|salida)/ }).count()) === 0, 'y no tiene botones de ingreso ni salida')
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-3-kardex-contabilidad.png'), fullPage: true })
  await contexto.close()
}

// -------------------------------------------------------------- 4. Tesorería
{
  const { pagina, contexto } = await entrar('tesoreria@banco.test')
  const items = await menu(pagina)
  console.log('     menú de Tesorería:', items.join(' · '))
  const orden = ['Adquisiciones', 'Cuentas por cobrar', 'Cuentas por pagar', 'Pagos de servicio', 'Planilla diaria', 'Tipo de cambio']
  comprobar(orden.every((t, i) => items.indexOf(t) === i + 1), 'el menú de Tesorería va Adquisiciones, por cobrar, por pagar, pagos de servicio')
  comprobar((await franja(pagina)).includes('1Servicio conforme por pagar'), 'el tablero de Tesorería cuenta el servicio por pagar')

  await pagina.goto(`${BASE}/tesoreria`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/tesoreria/por-cobrar', 'la dirección vieja lleva a Cuentas por cobrar')
  const cuenta = pagina.locator('article', { hasText: 'Factura E001-626' })
  const texto = limpio(await cuenta.textContent())
  comprobar(texto.includes('TRANSPORTES DE PRUEBA') && texto.includes('OT 2990-2026') && texto.includes('3901-2026') && texto.includes('Inicial 50 %'),
    'la factura llega con cliente, OT, cotización y concepto')
  const pdf = await cuenta.getByRole('link', { name: 'Abrir la factura' }).getAttribute('href')
  comprobar(Boolean(pdf) && (await fetch(pdf)).status === 200, 'Tesorería abre el PDF de la factura')
  await cuenta.getByText('Registrar cobro').click()
  await cuenta.locator('input[name="monto"]').fill('10000')
  await cuenta.locator('input[name="referencia"]').fill('OP-000123')
  await cuenta.getByRole('button', { name: 'Guardar cobro' }).click()
  await pagina.getByText('Saldo US$ 19,500.00').or(pagina.getByText(/Saldo US\$\s?19[ ,.]?500/)).first().waitFor({ timeout: 30000 }).catch(() => {})
  const [c] = await consulta(`select saldo from v_cuentas_cobrar_ot where numero_documento = 'E001-626'`)
  comprobar(Number(c?.saldo) === 19500, 'el cobro baja el saldo a 19 500')
  comprobar(limpio(await pagina.locator('article', { hasText: 'Factura E001-626' }).textContent()).includes('OP-000123'), 'y el cobro sale en la factura')
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-4-por-cobrar.png'), fullPage: true })

  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  const os = pagina.locator('article', { hasText: 'OS-0001-MW' })
  const textoOs = limpio(await os.textContent())
  comprobar(textoOs.includes('ARENADOS DE PRUEBA') && textoOs.includes('BCP') && textoOs.includes('Conforme'), 'Tesorería ve la OS conforme con la cuenta del proveedor')
  await os.getByRole('button', { name: 'Registrar pago' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').fill('500')
  await v.locator('select[name="cancela"]').selectOption('no')
  await v.locator('input[name="operacion"]').fill('OP-777')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const e1 = await esperarVentana(pagina)
  comprobar(e1 === '', `el pago a cuenta entra${e1 ? ` (dijo: ${e1})` : ''}`)
  await pagina.getByText('Pagada en parte').first().waitFor({ timeout: 30000 }).catch(() => {})
  comprobar(limpio(await pagina.locator('article', { hasText: 'OS-0001-MW' }).textContent()).includes('a cuenta'), 'el pago a cuenta sale en la OS, que sigue por pagar')
  await pagina.locator('article', { hasText: 'OS-0001-MW' }).getByRole('button', { name: 'Registrar pago' }).click()
  comprobar((await v.locator('input[name="monto"]').inputValue()) === '680.00', 'el segundo pago propone lo que falta (680)')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const e2 = await esperarVentana(pagina)
  comprobar(e2 === '', `el pago que la cancela entra${e2 ? ` (dijo: ${e2})` : ''}`)
  await pagina.getByText('Pagados (1)').waitFor({ timeout: 30000 }).catch(() => {})
  comprobar((await pagina.getByText('Pagados (1)').count()) === 1, 'la OS pasa a «Pagados»')
  const pagos = await consulta(`select count(*)::int n, sum(monto)::numeric s from pagos_orden_servicio where anulado_en is null`)
  comprobar(pagos[0].n === 2 && Number(pagos[0].s) === 1180, 'la base guarda los dos pagos por 1 180')
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-5-pagos-servicio.png'), fullPage: true })

  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  comprobar((await pagina.getByText('Documentos de compras de Logística').count()) === 1, 'Adquisiciones trae los documentos de compras de Logística')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('h1').textContent()).includes('Cuentas por pagar'), 'Cuentas por pagar abre')
  await contexto.close()

  const telefono = await entrar('tesoreria@banco.test', { width: 390, height: 844 })
  const pestanas = (await telefono.pagina.locator('nav[aria-label="Secciones"] li').allTextContents()).map(limpio)
  console.log('     pestañas de Tesorería:', pestanas.join(' · '))
  comprobar(['Compras', 'Por cobrar', 'Por pagar', 'Servicios'].every((t, i) => pestanas[i]?.replace(/^\d+/, '').startsWith(t)), 'en el teléfono, sus cuatro pestañas en orden')
  await telefono.pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `Cuentas por cobrar cabe en el teléfono (${ancho}px)`)
  await telefono.pagina.screenshot({ path: join(CAPTURAS, 'facturacion-6-telefono.png'), fullPage: true })
  await telefono.contexto.close()
}

// ------------------------------------------------- 5. Lo que no se puede
{
  const { pagina, contexto } = await entrar('contabilidad@banco.test')
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('li', { hasText: 'Cotización 3901-2026' })
  await tarjeta.getByRole('button', { name: 'Anular' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('Se emitió con el monto equivocado.')
  await v.getByRole('button', { name: 'Anular' }).click()
  const error = await esperarVentana(pagina)
  comprobar(error.includes('ya registró cobros'), `la factura cobrada no se anula («${error}»)`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('logistica@banco.test')
  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', 'Logística no entra a los pagos de servicio')
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', 'ni a Facturación')
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)

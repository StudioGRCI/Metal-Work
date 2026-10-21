/**
 * Recorre con clic real el camino de un subcontrato, con la cuenta de cada
 * puesto (nunca ADMIN):
 *
 *   1. Administración da de alta a un subcontratista: un RUC de empresa no lo
 *      deja; uno de persona natural, sí, con su cuenta.
 *   2. Registra un subcontrato con su código interno, su área (Producción; sin
 *      área el formulario no se envía) y lo pactado, y se abre.
 *   3. Sube un recibo por honorarios de S/ 2,000: la retención del 8 % se marca
 *      sola y la ventana dice que Tesorería paga S/ 1,840.
 *   4. Tesorería lo ve por pagar, con la cuenta del subcontratista, en el
 *      teléfono también; registra el pago con su voucher y pasa a pagados.
 *   5. Administración ve el recibo pagado con su voucher, y ya no puede
 *      anularlo; le llegó el aviso.
 *   6. Contabilidad y Gerencia consultan sin botones; Logística no entra.
 *   7. El supervisor de Producción lo ve en «Subcontratos» de su menú, con su
 *      recibo pagado y sin un monto; no abre la pantalla de Administración. El
 *      de Acabados no lo ve, y al de Maestranza le dice que no recibe.
 *      Administración lo pasa a Acabados y cambia quién lo ve.
 *
 * Necesita en la base del banco las cuentas `*.local@metalwork.test` de
 * Administración, Tesorería, Contabilidad, Gerencia, Logística y de Supervisión
 * de Producción, Acabados y Maestranza (`supervisor.prd.local@…`). El
 * subcontratista lo crea el script, inventado y distinto en cada corrida.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba, elegirCuenta, movimientosDeLaCaja } from './caja-de-prueba.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
  supervisorPrd: process.env.SUPERVISOR_PRD ?? 'sup.prd.local@metalwork.test',
  supervisorAcb: process.env.SUPERVISOR_ACB ?? 'sup.acb.local@metalwork.test',
  supervisorMtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
}
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
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}

/** Un RUC de persona natural inventado, con su dígito de control. */
function rucDePrueba(cuerpo) {
  const base10 = `10${cuerpo}`.slice(0, 10)
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((t, p, i) => t + Number(base10[i]) * p, 0)
  let d = 11 - (suma % 11)
  if (d === 10) d = 0
  if (d === 11) d = 1
  return `${base10}${d}`
}

// ------------------------------------------------- archivos de prueba
const archivos = join(CAPTURAS, 'archivos-subcontratos')
mkdirSync(archivos, { recursive: true })
{
  const p = await (await navegador.newContext()).newPage()
  const pdf = await p.pdf({ format: 'A5' }).catch(() => null)
  const minimo = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  )
  writeFileSync(join(archivos, 'recibo.pdf'), pdf ?? minimo)
  writeFileSync(join(archivos, 'voucher.pdf'), pdf ?? minimo)
  await p.context().close()
}

const sello = Date.now().toString().slice(-6)
// El pago pide la cuenta de la caja de la que salió (migración 20261019100000).
const caja = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)
const ruc = rucDePrueba(sello.padStart(8, '7'))
const nombre = `Subcontratista de prueba ${sello}`
const codigo = `prb_sc_${sello}`
const numeroRecibo = `E001-${Number(sello)}`
const cuenta = `19100${sello}`
const cci = `0021910000${sello}0099`.slice(0, 20)
let subcontratoId = null
let numeroSc = null

// ---------------------------- 1 y 2. Administración: padrón y subcontrato
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  const enMenu = await pagina.locator('nav a[href="/subcontratos"]').count()
  comprobar(enMenu > 0, 'Administración tiene «Subcontratos» en su menú')

  await pagina.goto(`${BASE}/subcontratos?vista=subcontratistas`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-nuevo-subcontratista]').click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="ruc"]').fill('20601538840')
  const aviso = limpio(await v.textContent())
  comprobar(
    aviso.includes('persona natural') && (await v.getByRole('button', { name: 'Dar de alta' }).isDisabled()),
    'un RUC de empresa no lo deja dar de alta: avisa que es persona natural',
  )
  await v.locator('input[name="ruc"]').fill(ruc)
  await v.locator('input[name="nombre"]').fill(nombre)
  await v.locator('input[name="banco"]').fill('BCP')
  await v.locator('input[name="numero_cuenta"]').fill(cuenta)
  await v.locator('input[name="cci"]').fill(cci)
  await v.getByRole('button', { name: 'Dar de alta' }).click()
  let error = await esperarVentana(pagina)
  comprobar(!error, `da de alta al subcontratista${error ? `: ${error}` : ''}`)
  await pagina.locator(`[data-subcontratista="${ruc}"]`).waitFor({ timeout: 15000 }).catch(() => {})
  const fila = limpio(await pagina.locator(`[data-subcontratista="${ruc}"]`).textContent().catch(() => ''))
  comprobar(fila.includes(nombre) && fila.includes(cuenta), `queda en el padrón con su cuenta (${fila.slice(0, 90)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-01-padron.png'), fullPage: true })

  await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-nuevo-subcontrato]').click()
  await pagina.getByRole('combobox', { name: 'Subcontratista' }).click()
  await pagina.keyboard.type(sello)
  await pagina.getByRole('option', { name: new RegExp(sello) }).first().click()
  await v.locator('textarea[name="descripcion"]').fill('Instalación eléctrica del furgón de prueba, con el material de la casa.')
  await v.locator('input[name="codigo_interno"]').fill(codigo)
  await v.locator('input[name="monto"]').fill('3500')
  // Sin área el navegador no lo deja enviar: es obligatoria.
  const sinArea = await v.locator('select[name="area"]').evaluate((el) => el.validity.valueMissing)
  comprobar(sinArea, 'sin elegir el área, el formulario no se envía')
  await v.locator('select[name="area"]').selectOption('PRD')
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-02-nuevo-subcontrato.png') })
  await v.getByRole('button', { name: 'Registrar subcontrato' }).click()
  await pagina.waitForURL(/\/subcontratos\/[0-9a-f-]{36}$/, { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  subcontratoId = pagina.url().match(/subcontratos\/([0-9a-f-]{36})/)?.[1] ?? null
  numeroSc = limpio(await pagina.locator('h1').textContent().catch(() => ''))
  comprobar(Boolean(subcontratoId) && /^SC-\d{4}-\d{4}$/.test(numeroSc), `registra el subcontrato y lo abre (${numeroSc})`)
  const [sc] = await consulta(
    'select s.codigo_interno, s.monto, a.codigo as area from subcontratos s left join areas a on a.id = s.area_id where s.id = $1',
    [subcontratoId],
  )
  comprobar(
    sc?.codigo_interno === codigo.toUpperCase() && Number(sc?.monto) === 3500 && sc?.area === 'PRD',
    `en la base: código en mayúsculas, S/ 3,500 y para Producción (${sc?.codigo_interno}, ${sc?.area})`,
  )
  const area = limpio(await pagina.locator('[data-area]').textContent().catch(() => ''))
  comprobar(area.startsWith('Producción'), `el subcontrato dice para qué área va (${area})`)

  // ------------------------------------------------ 3. el recibo
  await pagina.locator('[data-subir-recibo]').click()
  await v.locator('input[name="numero"]').fill(numeroRecibo.toLowerCase())
  await v.locator('input[name="monto_bruto"]').fill('2000')
  const marcada = await v.locator('input[type="checkbox"]').isChecked()
  const cuentas = limpio(await v.locator('dl').textContent())
  comprobar(marcada && cuentas.includes('1,840.00') && cuentas.includes('160.00'), `pasa de S/ 1,500: la retención se marca sola y Tesorería paga S/ 1,840 (${cuentas})`)
  await v.locator('input[type="file"]').setInputFiles(join(archivos, 'recibo.pdf'))
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-03-subir-recibo.png') })
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `sube el recibo${error ? `: ${error}` : ''}`)
  await pagina.locator(`[data-recibo="${numeroRecibo}"]`).waitFor({ timeout: 15000 }).catch(() => {})
  const recibo = limpio(await pagina.locator(`[data-recibo="${numeroRecibo}"]`).textContent().catch(() => ''))
  comprobar(recibo.includes('Por pagar') && recibo.includes('1,840.00') && recibo.includes('Recibo'), `el recibo queda por pagar, con su archivo (${recibo.slice(0, 120)})`)
  const cifras = limpio(await pagina.locator('[data-cuentas]').textContent())
  comprobar(cifras.includes('Por pagar') && cifras.includes('1,840.00') && cifras.includes('1,500.00'), `«Cómo va»: falta recibir S/ 1,500 y por pagar S/ 1,840 (${cifras})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-04-subcontrato-por-pagar.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

const [rec] = await consulta(
  'select id, numero, retencion_monto, monto_neto, archivo_ruta from recibos_honorarios where subcontrato_id = $1',
  [subcontratoId],
)
comprobar(
  rec?.numero === numeroRecibo && Number(rec?.retencion_monto) === 160 && Number(rec?.monto_neto) === 1840,
  `en la base: ${rec?.numero} con retención 160 y neto 1840`,
)
const [archivo] = await consulta("select count(*)::int as n from storage.objects where bucket_id = 'subcontratos' and name = $1", [rec?.archivo_ruta])
comprobar(archivo?.n === 1, 'el recibo está en Storage, en el bucket de subcontratos')

// ---------------------------------------------- 4. Tesorería lo paga
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria, CELULAR)
  const pestana = await pagina.locator('a[href="/tesoreria/recibos-por-honorarios"]', { hasText: 'Honorarios' }).count()
  comprobar(pestana > 0, 'en el teléfono, Tesorería tiene la pestaña «Honorarios»')
  await pagina.goto(`${BASE}/tesoreria/recibos-por-honorarios`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`[data-recibo="${numeroRecibo}"]`)
  const texto = limpio(await fila.textContent().catch(() => ''))
  comprobar(
    texto.includes(nombre) && texto.includes(cuenta) && texto.includes('1,840.00') && texto.includes(codigo.toUpperCase()),
    `lo ve por pagar con la cuenta, el código y el neto (${texto.slice(0, 140)})`,
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-05-tesoreria-por-pagar.png'), fullPage: true })
  await fila.locator(`[data-pagar-recibo="${numeroRecibo}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await elegirCuenta(v, caja)
  await v.locator('input[name="operacion"]').fill(`OP-${sello}`)
  await v.locator('input[type="file"]').setInputFiles(join(archivos, 'voucher.pdf'))
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `registra el pago con su voucher${error ? `: ${error}` : ''}`)
  const movs = await movimientosDeLaCaja(consulta, caja)
  comprobar(movs.length === 1 && movs[0].origen === 'PAGO_RECIBO_HONORARIOS' && movs[0].tipo === 'EGRESO' && movs[0].monto === 1840,
    `el neto sale de la cuenta elegida en la caja diaria (${JSON.stringify(movs)})`)
  // La lista se relee después de cerrar la ventana: se espera a que lo saque.
  await pagina.locator(`[data-recibo="${numeroRecibo}"]`).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  comprobar((await pagina.locator(`[data-recibo="${numeroRecibo}"]`).count()) === 0, 'sale de «Por pagar»')
  await pagina.goto(`${BASE}/tesoreria/recibos-por-honorarios?ver=pagados`, { waitUntil: 'networkidle' })
  const pagado = limpio(await pagina.locator(`[data-recibo="${numeroRecibo}"]`).textContent().catch(() => ''))
  comprobar(pagado.includes('Pagado el') && pagado.includes('Voucher') && pagado.includes(`OP-${sello}`), `queda en «Pagados» con su voucher (${pagado.slice(0, 120)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-06-tesoreria-pagados.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

const [pago] = await consulta('select monto, voucher_ruta from pagos_recibo_honorarios where recibo_id = $1 and anulado_en is null', [rec?.id])
comprobar(Number(pago?.monto) === 1840, `en la base: el pago es el neto (${pago?.monto})`)
const avisos = await consulta(
  `select u.correo, n.ruta from notificaciones n join usuarios u on u.id = n.usuario_id
    where n.origen_tabla = 'recibos_honorarios' and n.origen_id = $1 order by n.creado_en`,
  [rec?.id],
).catch(() => [])
comprobar(
  avisos.some((a) => a.correo === CUENTAS.tesoreria) && avisos.some((a) => a.correo === CUENTAS.administracion && a.ruta === `/subcontratos/${subcontratoId}`),
  `avisos: a Tesorería al subir y a Administración al pagar (${avisos.map((a) => a.correo.split('.')[0]).join(', ')})`,
)

// ---------------------------- 5. Administración ve el pago y su voucher
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/subcontratos/${subcontratoId}`, { waitUntil: 'networkidle' })
  const recibo = pagina.locator(`[data-recibo="${numeroRecibo}"]`)
  const texto = limpio(await recibo.textContent().catch(() => ''))
  comprobar(texto.includes('Pagado el') && texto.includes('Voucher'), `ve el recibo pagado con el voucher (${texto.slice(0, 120)})`)
  comprobar((await recibo.locator('[data-anular="recibo"]').count()) === 0, 'un recibo pagado ya no se anula desde Administración')
  const href = await recibo.getByRole('link', { name: 'Voucher' }).getAttribute('href').catch(() => null)
  const abre = href ? await pagina.request.get(new URL(href, BASE).toString()).then((r) => r.ok()).catch(() => false) : false
  comprobar(abre, 'el enlace del voucher abre el archivo')
  const cifras = limpio(await pagina.locator('[data-cuentas]').textContent())
  comprobar(cifras.includes('Pagado por Tesorería') && cifras.includes('1,840.00'), `«Cómo va»: pagado S/ 1,840 (${cifras})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-07-administracion-pagado.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// --------------------------------- 6. los que consultan y los que no entran
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.contabilidad)
  comprobar((await pagina.locator('nav a[href="/tesoreria/recibos-por-honorarios"]').count()) > 0, 'Contabilidad tiene «Recibos por honorarios» en su menú')
  await pagina.goto(`${BASE}/tesoreria/recibos-por-honorarios?ver=pagados`, { waitUntil: 'networkidle' })
  const texto = limpio(await pagina.locator(`[data-recibo="${numeroRecibo}"]`).textContent().catch(() => ''))
  comprobar(texto.includes('160.00') && texto.includes('Voucher'), `Contabilidad ve la retención y el voucher (${texto.slice(0, 100)})`)
  comprobar((await pagina.locator('[data-pagar-recibo], [data-anular-pago]').count()) === 0, 'Contabilidad no tiene botones de pago')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  // Desde el 2026-10-15 (#100) Gerencia no lo tiene en el menú, pero conserva el permiso y lo consulta por enlace.
  comprobar((await pagina.locator('nav a[href="/subcontratos"]').count()) === 0, 'Gerencia no tiene «Subcontratos» en su menú, como pidió')
  await pagina.goto(`${BASE}/subcontratos?estado=todos`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`[data-subcontrato="${numeroSc}"]`).count()) === 1, 'Gerencia ve el subcontrato en la lista')
  comprobar((await pagina.locator('[data-nuevo-subcontrato]').count()) === 0, 'Gerencia no registra subcontratos')
  await pagina.goto(`${BASE}/subcontratos/${subcontratoId}`, { waitUntil: 'networkidle' })
  comprobar(
    (await pagina.locator('[data-subir-recibo], [data-corregir-subcontrato], [data-cambiar-estado], [data-anular]').count()) === 0,
    'Gerencia consulta el subcontrato sin botones',
  )
  // En Códigos internos el recibo suma al costo de su código, por su bruto (migración 20261016100000).
  const enCodigo = `/codigos-internos/detalle?${new URLSearchParams({ codigo: codigo.toUpperCase() })}`
  await pagina.goto(`${BASE}/codigos-internos?${new URLSearchParams({ q: codigo })}`, { waitUntil: 'networkidle' })
  const filaCodigo = limpio(await pagina.locator(`a[href="${enCodigo}"]`).first().textContent().catch(() => ''))
  comprobar(filaCodigo.includes('Subcontratos S/ 2,000.00'), `la lista de Códigos internos suma el recibo por su bruto (${filaCodigo.slice(0, 160)})`)
  await pagina.goto(`${BASE}${enCodigo}&vista=costeo`, { waitUntil: 'networkidle' })
  const reciboEnCodigo = limpio(await pagina.locator(`[data-recibo="${numeroRecibo}"]`).textContent().catch(() => ''))
  comprobar(
    reciboEnCodigo.includes('Pagado') && reciboEnCodigo.includes('2,000.00') && reciboEnCodigo.includes(numeroSc) && reciboEnCodigo.includes(nombre),
    `el costeo del código muestra el recibo pagado, con su subcontrato y su subcontratista (${reciboEnCodigo.slice(0, 160)})`,
  )
  const cifrasCodigo = limpio(await pagina.locator('main').textContent())
  comprobar(cifrasCodigo.includes('1 RxH pagado'), 'arriba, «Subcontratos» dice que el recibo está pagado')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  comprobar((await pagina.locator('nav a[href="/subcontratos"]').count()) === 0, 'Logística no tiene «Subcontratos» en su menú')
  for (const ruta of ['/subcontratos', `/subcontratos/${subcontratoId}`, '/tesoreria/recibos-por-honorarios']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `Logística no entra a ${ruta}`)
  }
  await contexto.close()
}

// ------------------------------- 7. Supervisión: lo ve su área, sin montos
const [avisoArea] = await consulta(
  `select count(*)::int as n from notificaciones n join usuarios u on u.id = n.usuario_id
    where n.ruta = '/subcontratos/area' and n.origen_id = $1 and u.correo = $2`,
  [subcontratoId, CUENTAS.supervisorPrd],
)
comprobar(avisoArea?.n === 1, 'al supervisor de Producción le llegó el aviso del subcontrato')

/** Lo que el supervisor ve de este subcontrato en su pantalla, o '' si no está. */
async function loQueVe(pagina) {
  await pagina.goto(`${BASE}/subcontratos/area?${new URLSearchParams({ codigo })}`, { waitUntil: 'networkidle' })
  return limpio(await pagina.locator(`[data-subcontrato="${numeroSc}"]`).textContent().catch(() => ''))
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.supervisorPrd)
  const enMenu = limpio(await pagina.locator('nav').first().textContent().catch(() => ''))
  comprobar((await pagina.locator('nav a[href="/subcontratos/area"]').count()) > 0, 'Supervisión de Producción tiene «Subcontratos» en su menú')
  comprobar(
    enMenu.indexOf('Planos') >= 0 && enMenu.indexOf('Subcontratos') > enMenu.indexOf('Planos') && enMenu.indexOf('Subcontratos') < enMenu.indexOf('Requerimientos'),
    'va en Supervisión después de Planos y antes de Requerimientos',
  )
  const texto = await loQueVe(pagina)
  comprobar(texto.includes(nombre) && texto.includes('Instalación eléctrica'), `ve el subcontrato con quién lo hace y qué trabajo es (${texto.slice(0, 120)})`)
  // Sin dinero (DKS, 2026-10-20): ni el recibo ni si se pagó.
  comprobar((await pagina.locator('[data-recibo]').count()) === 0 && !texto.includes(numeroRecibo), 'no ve el recibo ni si se pagó')
  const todo = limpio(await pagina.locator('main').textContent())
  comprobar(todo.includes(codigo.toUpperCase()), 'lo agrupa por su código interno')
  comprobar(!/S\/|US\$|1,840|3,500|2,000|160\.00/.test(todo), 'no aparece ni un monto: ni lo pactado, ni el recibo, ni lo pagado')
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-08-supervision-produccion.png'), fullPage: true })
  for (const ruta of ['/subcontratos', `/subcontratos/${subcontratoId}`, '/tesoreria/recibos-por-honorarios']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `Supervisión no entra a ${ruta}`)
  }
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.supervisorAcb, CELULAR)
  comprobar((await loQueVe(pagina)) === '', 'Supervisión de Acabados no ve el de Producción')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.supervisorMtz)
  await pagina.goto(`${BASE}/subcontratos/area`, { waitUntil: 'networkidle' })
  // Maestranza también recibe subcontratos (#129), pero solo los suyos.
  const texto = limpio(await pagina.locator('main').textContent().catch(() => ''))
  comprobar(!texto.includes(nombre), 'Supervisión de Maestranza no ve el de Producción')
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-09-supervision-maestranza.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
// Administración lo pasa a Acabados: ahora lo ve Acabados y ya no Producción.
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/subcontratos/${subcontratoId}`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-corregir-subcontrato]').click()
  const v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('select[name="area"]').inputValue()) === 'PRD', 'al corregir, el área viene puesta')
  await v.locator('select[name="area"]').selectOption('ACB')
  await v.getByRole('button', { name: 'Guardar' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `lo pasa a Acabados${error ? `: ${error}` : ''}`)
  await pagina.waitForLoadState('networkidle')
  // El repintado llega después de cerrarse la ventana: se espera, no se lee al vuelo.
  await pagina.locator('[data-area]', { hasText: 'Acabados' }).waitFor({ timeout: 15000 }).catch(() => {})
  const area = limpio(await pagina.locator('[data-area]').textContent().catch(() => ''))
  comprobar(area.startsWith('Acabados'), `ahora dice Acabados (${area})`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.supervisorAcb)
  comprobar((await loQueVe(pagina)).includes(nombre), 'Supervisión de Acabados ya lo ve')
  await pagina.screenshot({ path: join(CAPTURAS, 'sc-10-supervision-acabados.png'), fullPage: true })
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.supervisorPrd)
  comprobar((await loQueVe(pagina)) === '', 'y Producción ya no')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)

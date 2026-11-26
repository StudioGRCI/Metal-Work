/**
 * El costeo del código interno pasa la OS en dólares a soles con el cambio de
 * su factura (migración 20261126998400).
 *
 * Con clic real y la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Contabilidad tiene el cambio de ayer y el de hace 3 días. Logística emite
 *      para un código nuevo una OS en dólares y una en soles, y Gerencia las
 *      aprueba. Eso se siembra por SQL, con el rol de cada uno.
 *   2. Gerencia abre el costeo del código: la OS en dólares dice «Al cambio del
 *      (día en que se emitió)» y el costo la suma con ese cambio.
 *   3. Logística le adjunta su factura de hace 3 días, con clic.
 *   4. Gerencia vuelve al costeo: la OS dice «Al cambio del (día de la
 *      factura)» y pesa lo mismo que su monto en soles. En el teléfono también.
 *   5. Administración lee lo mismo; un supervisor no entra.
 *
 * Cada corrida usa un código y unas OS propias: se puede repetir. Solo en el
 * banco. Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE
 * (mw_demo), BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas/costeo-de-la-os'
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
const q = async (sql, v = []) => (await base.query(sql, v)).rows

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const VENTANA = '[role="dialog"]:not([data-nextjs-dialog])'
const dma = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const SELLO = Date.now().toString().slice(-6)
const CODIGO = `PRB_SR_${SELLO}_1`

/** Una sentencia con el rol real de esa cuenta, en su transacción. */
async function como(cuenta, sql, v = []) {
  await base.query('begin')
  try {
    const [{ id }] = await q(`select id from public.usuarios where correo = $1`, [`${cuenta}.local@metalwork.test`])
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [id])
    await base.query('set local role authenticated')
    const r = await base.query(sql, v)
    await base.query('commit')
    return r.rows
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// 1. La siembra ---------------------------------------------------------------
const [{ hoy, hace3 }] = await q(
  `select to_char(h, 'YYYY-MM-DD') as hoy, to_char(h - 3, 'YYYY-MM-DD') as hace3 from (select (now() at time zone 'America/Lima')::date as h) x`,
)
for (const [dias, venta] of [[1, 3.7], [3, 3.8]]) {
  await como(
    'contabilidad',
    `insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
     select $1::date - $2::int, $3::numeric - 0.05, $3::numeric, 'SUNAT', public.usuario_actual()
      where not exists (select 1 from public.tipos_de_cambio where fecha = $1::date - $2::int)`,
    [hoy, dias, venta],
  )
}
// El banco recién hecho no trae proveedores: se siembra uno, con un RUC que pase la validación.
await q(
  `insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
   select r, 'TORNOS Y SERVICIOS DEL SUR S.A.C.', 'Av. Argentina 1450, Lima', '014567890'
     from (select '2061' || lpad(n::text, 6, '0') || d::text as r from generate_series(556000, 556200) n, generate_series(0, 9) d) x
    where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores where activo)
    order by r limit 1
   on conflict (tipo_documento, numero_documento) do update set activo = true`,
)
const [{ proveedor }] = await q(`select id as proveedor from public.proveedores where activo order by razon_social limit 1`)
const emitidas = {}
for (const [clave, moneda, monto, que] of [['d', 'USD', 1000, 'Torneado de ejes'], ['s', 'PEN', 500, 'Pintura de la tolva']]) {
  const [{ id }] = await como(
    'logistica',
    `select public.emitir_orden_servicio(gen_random_uuid(), $1, null, (select id from public.areas where codigo = 'MTZ'), $2, $3, null,
                                         $4::date, $4::date + 5, $5, $6, 'CONTADO', 0, '025', null) as id`,
    [proveedor, CODIGO, `${que}, prueba ${SELLO}`, hoy, moneda, monto],
  )
  await como('gerencia', `select public.aprobar_orden_servicio($1)`, [id])
  const [os] = await q(`select id, numero, monto, monto_pen from public.ordenes_servicio where id = $1`, [id])
  emitidas[clave] = os
}
const { d, s } = emitidas
// El costeo convierte con el cambio que le toca a ese día: el último registrado hasta él.
const cambioDe = async (dia) => Number((await q(`select public.cambio_del_dia($1::date, 'VENTA') as c`, [dia]))[0].c)
const tcHoy = await cambioDe(hoy)
const tc3 = await cambioDe(hace3)
console.log(`  Código ${CODIGO}: ${d.numero} (US$ 1 000, S/ ${d.monto_pen}) y ${s.numero} (S/ 500); cambio de hoy ${tcHoy}, de hace 3 días ${tc3}`)
comprobar(d.monto_pen !== null && tc3 > 0 && tcHoy > 0, 'la OS en dólares nació con monto en soles y hay cambio para hoy y para hace 3 días')

// El navegador -----------------------------------------------------------------
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(cuenta, ancho) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: 900 },
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
    isMobile: ancho < 500,
    hasTouch: ancho < 500,
  })
  const pagina = await contexto.newPage()
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 200)))
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !/hmr|WebSocket/.test(m.text())) errores.push(m.text().slice(0, 200))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', `${cuenta}.local@metalwork.test`)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }), pagina.click('button[type="submit"]')])
  return pagina
}
async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 120000 })
  await conReact(pagina).catch(() => {})
}
async function captura(pagina, nombre) {
  await pagina.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
  await pagina.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: true })
  // Y la tarjeta de las órdenes de servicio sola, que es lo que cambió.
  await pagina.locator('[data-servicios]').first().screenshot({ path: `${CAPTURAS}/${nombre}-servicios.png` })
}
const desborda = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
const COSTEO = `/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO, vista: 'costeo' })}`

/** Lo que el costeo dice de la OS en dólares y del costo del código. */
async function leerCosteo(pagina) {
  await ir(pagina, COSTEO)
  const fila = pagina.locator(`[data-servicios] [data-servicio="${d.numero}"]`).first()
  const filaSoles = pagina.locator(`[data-servicios] [data-servicio="${s.numero}"]`).first()
  return {
    dia: await fila.locator('[data-dia-de-la-linea]').getAttribute('data-dia-de-la-linea').catch(() => null),
    texto: limpio(await fila.locator('[data-dia-de-la-linea]').textContent().catch(() => '')),
    importe: limpio(await fila.innerText().catch(() => '')),
    soles: limpio(await filaSoles.locator('[data-dia-de-la-linea]').textContent().catch(() => '')),
    costo: Number(await pagina.locator('[data-costo]').first().getAttribute('data-costo').catch(() => NaN)),
    alCambio: Number(await pagina.locator('[data-dolares-al-cambio]').first().getAttribute('data-dolares-al-cambio').catch(() => NaN)),
    ayuda: await pagina.locator('[data-servicios]').first().innerHTML().catch(() => ''),
  }
}

// 2. Gerencia, antes de la factura ---------------------------------------------------
const ger = await entrar('gerencia', 1440)
{
  const c = await leerCosteo(ger)
  const esperado = Math.round(1000 * tcHoy * 100) / 100
  comprobar(c.dia === hoy && c.texto === `Al cambio del ${dma(hoy)}`, `sin factura, la ${d.numero} dice «Al cambio del ${dma(hoy)}», el día en que se emitió (dice «${c.texto}»)`)
  comprobar(c.soles === dma(hoy), `la ${s.numero}, en soles, lleva solo su fecha (dice «${c.soles}»)`)
  comprobar(c.importe.includes('US$') || c.importe.includes('$'), 'la OS en dólares sigue mostrándose en dólares')
  comprobar(c.alCambio === esperado && c.costo === esperado + 500, `el costo la suma con el cambio de ese día: S/ ${esperado} + S/ 500 (dice ${c.costo}, con ${c.alCambio} de dólares al cambio)`)
  comprobar(!(await desborda(ger)), 'el costeo no se sale de la pantalla a 1440')
  await captura(ger, 'costeo-antes-de-la-factura-1440')
}

// 3. Logística adjunta la factura de hace 3 días, con clic ----------------------------
{
  const log = await entrar('logistica', 1440)
  await ir(log, '/compras/servicios')
  await log.locator(`[data-adjuntar-documento-servicio="${d.numero}"]`).first().click()
  const v = log.locator(VENTANA)
  await v.waitFor()
  await v.locator('input[name="numero"]').fill(`F001-${SELLO}`)
  await v.locator('input[name="fecha_emision"]').fill(hace3)
  await v.locator('input[type="file"]').setInputFiles({
    name: `factura-${SELLO}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${SELLO}`),
  })
  await v.locator('button[type="submit"]').click()
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 40000 }), v.locator('[role="alert"]').waitFor({ timeout: 40000 })]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  await log.waitForLoadState('networkidle')
  comprobar(!error, `Logística adjunta la factura de hace 3 días${error ? ` («${error}»)` : ''}`)
  await log.context().close()
}
const [despues] = await q(`select monto_pen, to_char(fecha_cambio, 'YYYY-MM-DD') as fecha_cambio from public.ordenes_servicio where id = $1`, [d.id])
comprobar(despues.fecha_cambio === hace3 && Number(despues.monto_pen) === Math.round(1000 * tc3 * 100) / 100,
  `la OS tomó el cambio de su factura: S/ ${despues.monto_pen}`)

// 4. Gerencia, después de la factura -------------------------------------------------
{
  const c = await leerCosteo(ger)
  comprobar(c.dia === hace3 && c.texto === `Al cambio del ${dma(hace3)}`, `con su factura, la ${d.numero} dice «Al cambio del ${dma(hace3)}» (dice «${c.texto}»)`)
  comprobar(c.alCambio === Number(despues.monto_pen), `y pesa en el costo lo mismo que su monto en soles: S/ ${despues.monto_pen} (dice ${c.alCambio})`)
  comprobar(c.costo === Number(despues.monto_pen) + 500, `el costo del código es S/ ${Number(despues.monto_pen) + 500} (dice ${c.costo})`)
  comprobar(c.ayuda.includes('fecha de su factura'), 'la ayuda de la tarjeta dice con qué cambio pasa a soles la OS en dólares')
  await captura(ger, 'costeo-con-la-factura-1440')
  await ger.context().close()

  const tel = await entrar('gerencia', 390)
  const t = await leerCosteo(tel)
  comprobar(t.texto === `Al cambio del ${dma(hace3)}` && t.costo === c.costo, 'en el teléfono Gerencia lee lo mismo')
  comprobar(!(await desborda(tel)), 'y el costeo no se sale de la pantalla a 390')
  await captura(tel, 'costeo-con-la-factura-390')
  await tel.context().close()
}

// 5. Administración lee lo mismo; un supervisor no entra ------------------------------
{
  const adm = await entrar('administracion', 1280)
  const c = await leerCosteo(adm)
  comprobar(c.texto === `Al cambio del ${dma(hace3)}` && c.costo === Number(despues.monto_pen) + 500, 'Administración lee el mismo día y el mismo costo')
  await adm.context().close()
  const sup = await entrar('sup.mtz', 1280)
  await ir(sup, COSTEO)
  const cuerpo = limpio(await sup.locator('main').innerText().catch(() => ''))
  comprobar(new URL(sup.url()).pathname.startsWith('/sin-permiso') || (await sup.locator('[data-servicios]').count()) === 0,
    `el supervisor de Maestranza no lee el costeo del código (${new URL(sup.url()).pathname}${cuerpo ? '' : ', sin contenido'})`)
  await sup.context().close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLAS:\n- ${fallas.join('\n- ')}` : '\nSin fallas.')
process.exit(fallas.length ? 1 : 0)

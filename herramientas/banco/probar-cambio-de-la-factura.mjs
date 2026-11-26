/**
 * La OS en dólares toma el tipo de cambio de su factura (migración 20261126947000).
 *
 * Con clic real y la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Contabilidad tiene registrado el cambio de ayer y el de hace 3 días.
 *      Logística emite tres OS (dos en dólares, una en soles) y Gerencia las
 *      aprueba. Eso se siembra por SQL, con el rol de cada uno.
 *   2. Logística adjunta a la primera su factura de hace 3 días: el formulario
 *      pide la fecha de emisión, la OS toma el cambio de ese día y la pantalla
 *      lo dice. Tres toques dejan una sola factura.
 *   3. En el teléfono (390), adjunta a la segunda una factura de un día sin
 *      cambio registrado: la OS queda sin monto en soles.
 *   4. La OS en soles no pide fecha.
 *   5. Tesorería ve de qué día falta el cambio y que es el de la factura.
 *   6. La factura de un día cuyo cambio todavía no está: la OS va con el último
 *      registrado; Contabilidad registra el de ese día con su pantalla y la OS
 *      lo toma sola.
 *   7. Ventas no entra.
 *
 * Cada corrida emite sus propias OS: se puede repetir. Solo en el banco.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas/cambio-de-la-factura'
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
const [{ hoy, hace3, hace2, sin_cambio, hace2anios }] = await q(
  `select to_char(h, 'YYYY-MM-DD') as hoy, to_char(h - 3, 'YYYY-MM-DD') as hace3, to_char(h - 2, 'YYYY-MM-DD') as hace2, to_char(h - 40, 'YYYY-MM-DD') as sin_cambio,
          to_char(h - 730, 'YYYY-MM-DD') as hace2anios
     from (select (now() at time zone 'America/Lima')::date as h) x`,
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
const [{ tc3, tc_sin }] = await q(`select public.cambio_del_dia($1::date, 'VENTA') as tc3, public.cambio_del_dia($2::date, 'VENTA') as tc_sin`, [hace3, sin_cambio])
const [{ proveedor }] = await q(`select id as proveedor from public.proveedores where activo order by razon_social limit 1`)
const emitidas = {}
for (const [clave, moneda, monto, que] of [['a', 'USD', 1000, 'Torneado de ejes'], ['b', 'USD', 500, 'Rectificado de bocinas'], ['c', 'PEN', 800, 'Arenado de la tolva'], ['d', 'USD', 2000, 'Galvanizado de barandas']]) {
  const [{ id }] = await como(
    'logistica',
    `select public.emitir_orden_servicio(gen_random_uuid(), $1, null, (select id from public.areas where codigo = 'MTZ'), 'PLANTA', $2, null,
                                         $3::date, $3::date + 5, $4, $5, 'CONTADO', 0, '025', null) as id`,
    [proveedor, `${que}, prueba ${SELLO}`, hoy, moneda, monto],
  )
  await como('gerencia', `select public.aprobar_orden_servicio($1)`, [id])
  const [os] = await q(`select id, numero, monto, monto_pen from public.ordenes_servicio where id = $1`, [id])
  emitidas[clave] = os
}
const { a, b, c, d } = emitidas
console.log(`  OS: ${a.numero} (US$ 1 000, S/ ${a.monto_pen}), ${b.numero} (US$ 500), ${c.numero} (S/ 800); cambio de hace 3 días ${tc3}`)
comprobar(a.monto_pen !== null && Number(tc3) > 0, 'la OS en dólares nació con monto en soles y hay cambio de hace 3 días')

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
}
const desborda = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
const PDF = { name: `factura-${SELLO}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') }

/** Abre «Adjuntar documento» de esa OS y devuelve la ventana. */
async function abrir(pagina, numero) {
  await pagina.locator(`[data-adjuntar-documento-servicio="${numero}"]`).first().click()
  const v = pagina.locator(VENTANA)
  await v.waitFor()
  return v
}
async function adjuntarFactura(pagina, os, numeroFactura, fecha, toques = 1) {
  const v = await abrir(pagina, os.numero)
  await v.locator('input[name="numero"]').fill(numeroFactura)
  await v.locator('input[name="fecha_emision"]').fill(fecha)
  await v.locator('input[type="file"]').setInputFiles({ ...PDF, name: `factura-${numeroFactura}.pdf`, buffer: Buffer.concat([PDF.buffer, Buffer.from(numeroFactura)]) })
  const enviar = v.locator('button[type="submit"]')
  // Se cuentan los toques que llegaron al botón: tragarse los fallidos dejaba pasar «tres toques» con uno solo.
  let llegaron = 0
  for (let i = 0; i < toques; i += 1) {
    await enviar.click({ timeout: 2000, force: true }).then(() => (llegaron += 1), () => {})
  }
  // El tercero puede no llegar si la ventana ya se cerró: con dos ya se probó el doble envío.
  if (toques > 1) comprobar(llegaron >= 2, `de los ${toques} toques en «Adjuntar», ${llegaron} llegaron al botón`)
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 40000 }), v.locator('[role="alert"]').waitFor({ timeout: 40000 })]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  await pagina.waitForLoadState('networkidle')
  return error
}

// 2. Logística, en el monitor -----------------------------------------------------
{
  const tes = await entrar('tesoreria', 1440)
  await ir(tes, '/tesoreria/pagos-de-servicio')
  const tarjeta = limpio(await tes.locator(`[data-servicio="${a.numero}"]`).innerText())
  // Si hoy ya tiene su cambio, la OS nació con él; si no, con el último registrado, y se dice cuál.
  const [{ con_cual }] = await q(`select to_char(max(fecha), 'YYYY-MM-DD') as con_cual from public.tipos_de_cambio where fecha <= $1::date`, [hoy])
  const provisional = con_cual === hoy
    ? `con el tipo de cambio del ${dma(hoy)}, el día en que se emitió: falta su factura`
    : `con el tipo de cambio del ${dma(con_cual)}, el último registrado cuando se emitió: falta su factura`
  comprobar(tarjeta.includes(provisional), `antes de la factura, Tesorería lee en la ${a.numero}: «${provisional}»`)
  comprobar(tarjeta.includes('la factura del proveedor, adjunta a la OS con su fecha de emisión: el tipo de cambio de ese día decide el monto en soles y la detracción'),
    'y lo que falta dice que la factura decide el monto en soles y la detracción')
  const enSoles = limpio(await tes.locator(`[data-servicio="${c.numero}"]`).innerText())
  comprobar(!enSoles.includes('tipo de cambio'), `la ${c.numero}, en soles, no habla de tipo de cambio`)
  await captura(tes, 'tesoreria-antes-de-la-factura-1440')
  await tes.context().close()
}
const log = await entrar('logistica', 1440)
await ir(log, '/compras/servicios')
{
  const fila = limpio(await log.locator('tr, article, li').filter({ has: log.locator(`[data-adjuntar-documento-servicio="${a.numero}"]`) }).first().innerText())
  comprobar(/(el día en que se emitió|el último registrado cuando se emitió): falta su factura/.test(fila), 'Logística también ve con qué cambio va la orden mientras falta la factura')
  // Una fecha de más de un año antes de la OS: la base la rechaza, y se dice en el campo.
  const rechazo = await adjuntarFactura(log, a, `F001-${SELLO}0`, hace2anios)
  const v = log.locator(VENTANA)
  const campoFecha = v.locator('input[name="fecha_emision"]')
  comprobar(/es de más de un año antes/.test(rechazo), `una fecha de hace dos años se rechaza («${rechazo}»)`)
  comprobar((await campoFecha.getAttribute('aria-invalid')) === 'true', 'el rechazo marca el campo de la fecha')
  comprobar(await campoFecha.evaluate((e) => e === document.activeElement), 'y el cursor queda en él')
  comprobar((await v.locator('[role="alert"]').count()) === 1, 'dicho una sola vez, no también en el pie')
  await log.keyboard.press('Escape')
  await v.waitFor({ state: 'hidden' })
  const sueltos = await q(`select count(*)::int as n from public.documentos_orden_servicio where orden_servicio_id = $1`, [a.id])
  comprobar(sueltos[0].n === 0, 'y no quedó ninguna factura anotada')
}
{
  const v = await abrir(log, a.numero)
  const fecha = v.locator('input[name="fecha_emision"]')
  comprobar((await fecha.count()) === 1 && (await fecha.getAttribute('required')) !== null, 'la factura de la OS en dólares pide su fecha de emisión, obligatoria')
  comprobar((await fecha.getAttribute('max')) === hoy, 'y no deja elegir un día que todavía no llega')
  await v.locator('select[name="tipo"]').selectOption('CONTRATO')
  comprobar((await v.locator('input[name="fecha_emision"]').count()) === 0, 'el contrato no la pide')
  await log.keyboard.press('Escape')
  await v.waitFor({ state: 'hidden' })
}
const errorA = await adjuntarFactura(log, a, `F001-${SELLO}1`, hace3, 3)
comprobar(!errorA, `Logística adjuntó la factura de la ${a.numero} sin error${errorA ? ` («${errorA}»)` : ''}`)
{
  const aviso = limpio(await log.locator(`[data-aviso-documento-servicio="${a.numero}"]`).first().textContent())
  comprobar(aviso.includes(`La orden tomó el tipo de cambio del ${dma(hace3)}`), `al cerrar la ventana, junto al botón dice qué cambió («${aviso}»)`)
  await captura(log, 'logistica-factura-adjunta-1440')

  const docs = await q(`select to_char(fecha_emision, 'YYYY-MM-DD') as f from public.documentos_orden_servicio where orden_servicio_id = $1`, [a.id])
  comprobar(docs.length === 1 && docs[0].f === hace3, `tres toques dejaron una sola factura, con su fecha (${docs.length} en la base)`)
  const [os] = await q(`select monto_pen, to_char(fecha_cambio, 'YYYY-MM-DD') as f, detraccion_monto from public.ordenes_servicio where id = $1`, [a.id])
  comprobar(Number(os.monto_pen) === Math.round(1000 * Number(tc3) * 100) / 100 && os.f === hace3,
    `la OS tomó el cambio del día de su factura: S/ ${os.monto_pen} (antes S/ ${a.monto_pen})`)
  await ir(log, '/compras/servicios')
  const fila = limpio(await log.locator('tr, article, li').filter({ has: log.locator(`[data-adjuntar-documento-servicio="${a.numero}"]`) }).first().innerText())
  comprobar(fila.includes(`emitida el ${dma(hace3)}`), 'la lista dice cuándo se emitió la factura')
  comprobar(fila.includes(`con el tipo de cambio del ${dma(hace3)}, la fecha de su factura`), 'y que la detracción va con el tipo de cambio de ese día')
  comprobar(!(await desborda(log)), 'Compras › Servicios no desborda a 1440')
  await captura(log, 'logistica-servicios-1440')
}
// Otra factura del mismo día no mueve nada, y no se dice que se calculó de nuevo.
{
  const errorOtra = await adjuntarFactura(log, a, `F001-${SELLO}5`, hace3)
  const aviso = limpio(await log.locator(`[data-aviso-documento-servicio="${a.numero}"]`).first().textContent())
  comprobar(!errorOtra && aviso.includes(`La orden ya iba con el tipo de cambio del ${dma(hace3)}: su monto en soles no cambió`),
    `una segunda factura del mismo día dice que el monto no cambió («${errorOtra || aviso}»)`)
  const [os] = await q(`select monto_pen from public.ordenes_servicio where id = $1`, [a.id])
  comprobar(Number(os.monto_pen) === Math.round(1000 * Number(tc3) * 100) / 100, 'y la OS sigue con el mismo monto en soles')
}
// 4. La OS en soles no pide fecha.
{
  const v = await abrir(log, c.numero)
  comprobar((await v.locator('input[name="fecha_emision"]').count()) === 0 && (await v.locator('input[name="numero"]').count()) === 1,
    'la factura de la OS en soles no pide fecha de emisión')
  await log.keyboard.press('Escape')
}
await log.context().close()

// 3. Logística, en el teléfono: una factura de un día sin cambio registrado ---------
if (tc_sin !== null) {
  console.log(`  (el banco tiene cambio para el ${dma(sin_cambio)}: no se prueba la factura de un día sin cambio)`)
} else {
  const tel = await entrar('logistica', 390)
  await ir(tel, '/compras/servicios')
  const errorB = await adjuntarFactura(tel, b, `F001-${SELLO}2`, sin_cambio)
  comprobar(!errorB, `en el teléfono, adjuntó la factura de la ${b.numero}${errorB ? ` («${errorB}»)` : ''}`)
  const avisoB = limpio(await tel.locator(`[data-aviso-documento-servicio="${b.numero}"]`).first().textContent())
  comprobar(avisoB.includes(`El tipo de cambio del ${dma(sin_cambio)} no estaba registrado`) && avisoB.includes('Contabilidad o Administración'), `y junto al botón dice que falta el cambio de ese día («${avisoB}»)`)
  await captura(tel, 'logistica-factura-sin-cambio-390')
  const [os] = await q(`select monto_pen, to_char(fecha_cambio, 'YYYY-MM-DD') as f from public.ordenes_servicio where id = $1`, [b.id])
  comprobar(os.monto_pen === null && os.f === sin_cambio, 'la factura de un día sin cambio registrado deja la OS sin monto en soles')
  await ir(tel, '/compras/servicios')
  comprobar(!(await desborda(tel)), 'Compras › Servicios no desborda a 390')
  await captura(tel, 'logistica-servicios-390')
  await tel.context().close()

  // 5. Tesorería ve de qué día falta y que es el de la factura.
  for (const ancho of [1440, 390]) {
    const tes = await entrar('tesoreria', ancho)
    await ir(tes, '/tesoreria/pagos-de-servicio')
    const texto = limpio(await tes.locator('main').innerText())
    if (ancho === 1440) {
      comprobar(texto.includes(`el tipo de cambio del ${dma(sin_cambio)}, la fecha de su factura`),
        `Tesorería ve que falta el cambio del ${dma(sin_cambio)}, la fecha de la factura de la ${b.numero}`)
      comprobar(texto.includes('Contabilidad o Administración'), 'y quién lo registra')
      comprobar(texto.includes(`con el tipo de cambio del ${dma(hace3)}, la fecha de su factura`), `y que la ${a.numero} va con el tipo de cambio de su factura`)
    }
    comprobar(!(await desborda(tes)), `Tesorería › Pagos de servicio no desborda a ${ancho}`)
    await captura(tes, `tesoreria-pagos-de-servicio-${ancho}`)
    await tes.context().close()
  }
}

// 6. La factura llega antes que el cambio de su día: toma el último registrado, y el suyo cuando
//    Contabilidad lo registra, con clic, en Tesorería › Tipo de cambio. Se hace con el día de hace
//    dos días, que la siembra deja sin cambio: no depende de que hoy tenga o no el suyo.
{
  const [{ ya }] = await q(`select (select venta from public.tipos_de_cambio where fecha = $1::date) as ya`, [hace2])
  if (ya !== null) {
    console.log(`  (el banco ya tiene el cambio del ${dma(hace2)}: no se prueba la factura que llega antes que su cambio; rehacer el banco)`)
  } else {
    const log2 = await entrar('logistica', 1440)
    await ir(log2, '/compras/servicios')
    const errorD = await adjuntarFactura(log2, d, `F001-${SELLO}4`, hace2)
    comprobar(!errorD, `Logística adjuntó a la ${d.numero} una factura del ${dma(hace2)}, un día sin cambio registrado${errorD ? ` («${errorD}»)` : ''}`)
    const [{ vispera, dia_vispera }] = await q(
      `select public.cambio_del_dia($1::date, 'VENTA') as vispera,
              (select to_char(max(fecha), 'YYYY-MM-DD') from public.tipos_de_cambio where fecha <= $1::date) as dia_vispera`, [hace2])
    const avisoD = limpio(await log2.locator(`[data-aviso-documento-servicio="${d.numero}"]`).first().textContent())
    comprobar(avisoD.includes(`El tipo de cambio del ${dma(hace2)} todavía no está registrado: la orden va con el del ${dma(dia_vispera)}`),
      `junto al botón dice que el cambio de ese día no está y con cuál va («${avisoD}»)`)
    await log2.context().close()
    const [antes] = await q(`select monto_pen, detraccion_monto, to_char(fecha_cambio, 'YYYY-MM-DD') as f from public.ordenes_servicio where id = $1`, [d.id])
    comprobar(antes.f === hace2 && Number(antes.monto_pen) === Math.round(2000 * Number(vispera) * 100) / 100,
      `sin el cambio de ese día, la OS va con el último registrado (${vispera}): S/ ${antes.monto_pen}`)
    {
      const tes = await entrar('tesoreria', 390)
      await ir(tes, '/tesoreria/pagos-de-servicio')
      const tarjeta = limpio(await tes.locator(`[data-servicio="${d.numero}"]`).innerText())
      comprobar(tarjeta.includes(`con el tipo de cambio del ${dma(dia_vispera)}, el último registrado hasta el ${dma(hace2)}, la fecha de su factura`),
        `Tesorería lee que la ${d.numero} va con el cambio del ${dma(dia_vispera)}, el último registrado, y no con el del día de su factura`)
      comprobar(tarjeta.includes(`S/ ${Number(antes.detraccion_monto).toFixed(2)}`), `con su detracción de S/ ${antes.detraccion_monto}`)
      comprobar(!(await desborda(tes)), 'y no desborda a 390')
      await captura(tes, 'tesoreria-cambio-de-la-vispera-390')
      await tes.context().close()
    }
    // Contabilidad registra el cambio de ese día con su pantalla, no por SQL.
    const nuevo = (Number(vispera) + 0.2).toFixed(3)
    const con = await entrar('contabilidad', 1440)
    await ir(con, '/tesoreria/tipo-de-cambio')
    comprobar(new URL(con.url()).pathname === '/tesoreria/tipo-de-cambio', 'Contabilidad entra a Tesorería › Tipo de cambio')
    await con.locator('#tc-fecha').fill(hace2)
    await con.locator('#tc-compra').fill((Number(nuevo) - 0.05).toFixed(3))
    await con.locator('#tc-venta').fill(nuevo)
    await con.locator('form:has(#tc-fecha) button[type="submit"]').click()
    await con.waitForLoadState('networkidle')
    let registrado = null
    for (let i = 0; i < 40 && registrado === null; i += 1) {
      ;[{ registrado }] = await q(`select (select venta from public.tipos_de_cambio where fecha = $1::date) as registrado`, [hace2])
      if (registrado === null) await con.waitForTimeout(250)
    }
    comprobar(Number(registrado) === Number(nuevo), `Contabilidad registró con su pantalla el cambio del ${dma(hace2)} (${registrado})`)
    await con.context().close()
    const [despues] = await q(`select monto_pen, detraccion_monto from public.ordenes_servicio where id = $1`, [d.id])
    comprobar(Number(despues.monto_pen) === Math.round(2000 * Number(nuevo) * 100) / 100 && Number(despues.detraccion_monto) > Number(antes.detraccion_monto),
      `y la OS lo tomó sola: S/ ${despues.monto_pen}, detracción S/ ${despues.detraccion_monto} (antes S/ ${antes.monto_pen} y S/ ${antes.detraccion_monto})`)
    const [otra] = await q(`select monto_pen from public.ordenes_servicio where id = $1`, [a.id])
    comprobar(Number(otra.monto_pen) === Math.round(1000 * Number(tc3) * 100) / 100, `la ${a.numero}, con factura de otro día, no se mueve`)
    const tes = await entrar('tesoreria', 1440)
    await ir(tes, '/tesoreria/pagos-de-servicio')
    const tarjeta = limpio(await tes.locator(`[data-servicio="${d.numero}"]`).innerText())
    comprobar(tarjeta.includes(`con el tipo de cambio del ${dma(hace2)}, la fecha de su factura`) && tarjeta.includes(`S/ ${Number(despues.detraccion_monto).toFixed(2)}`),
      `Tesorería ve la ${d.numero} con el cambio del día de su factura y su detracción nueva`)
    await captura(tes, 'tesoreria-cambio-registrado-1440')
    await tes.context().close()
  }
}

// 7. Ventas no entra ------------------------------------------------------------------
{
  const ven = await entrar('ventas', 1280)
  await ir(ven, '/compras/servicios')
  comprobar(new URL(ven.url()).pathname.startsWith('/sin-permiso'), 'Ventas no entra a Compras › Servicios')
  await ven.context().close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLAS:\n- ${fallas.join('\n- ')}` : '\nSin fallas.')
process.exit(fallas.length ? 1 : 0)

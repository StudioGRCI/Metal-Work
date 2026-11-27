/**
 * El costeo del código interno pasa la OS en dólares a soles con el cambio de
 * su factura (migración 20261126998400) y pesa el monto en soles que guarda la
 * OS (20261126998800).
 *
 * Con clic real y la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Contabilidad tiene el cambio de ayer y el de hace 3 días. Logística emite
 *      para un código nuevo una OS en dólares y una en soles, y Gerencia las
 *      aprueba. Eso se siembra por SQL, con el rol de cada uno.
 *   2. Gerencia abre el costeo del código: bajo la OS en dólares está el día en
 *      que se emitió y «Al cambio del (último registrado hasta ese día)», y el
 *      costo la suma con ese cambio.
 *   3. Logística le adjunta su factura de hace 3 días, con clic.
 *   4. Gerencia vuelve al costeo: la OS dice «Al cambio del (día de la
 *      factura)» y pesa lo mismo que su monto en soles. En el teléfono también.
 *   5. Administración lee lo mismo; un supervisor no entra.
 *   6. Otra OS en dólares recibe una factura de hace 45 días, sin cambio
 *      registrado: la fila dice «Sin cambio del (ese día)» y el costo no la suma.
 *   7. La detracción de la primera OS queda depositada (se siembra: el banco no
 *      tiene cajas) y Contabilidad corrige el cambio del día de su factura: la
 *      OS no se mueve y el costo tampoco; la fila dice «Cambio fijo: detracción
 *      depositada u orden pagada» y debajo de sus dólares, los mismos soles que
 *      guarda la OS. Bajo «Total aprobado», lo que los servicios pesan en el costo.
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
const [{ hoy, hace3, hace45 }] = await q(
  `select to_char(h, 'YYYY-MM-DD') as hoy, to_char(h - 3, 'YYYY-MM-DD') as hace3, to_char(h - 45, 'YYYY-MM-DD') as hace45
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
/** Logística emite la OS para el código y Gerencia la aprueba. */
async function emitir(clave, moneda, monto, que) {
  const [{ id }] = await como(
    'logistica',
    `select public.emitir_orden_servicio(gen_random_uuid(), $1, null, (select id from public.areas where codigo = 'MTZ'), $2, $3, null,
                                         $4::date, $4::date + 5, $5, $6, 'CONTADO', 0, '025', null) as id`,
    [proveedor, CODIGO, `${que}, prueba ${SELLO}`, hoy, moneda, monto],
  )
  await como('gerencia', `select public.aprobar_orden_servicio($1)`, [id])
  const [os] = await q(`select id, numero, monto, monto_pen from public.ordenes_servicio where id = $1`, [id])
  emitidas[clave] = os
  return os
}
await emitir('d', 'USD', 1000, 'Torneado de ejes')
await emitir('s', 'PEN', 500, 'Pintura de la tolva')
const { d, s } = emitidas
// El costeo convierte con el cambio que le toca a ese día: el último registrado hasta él.
const cambioDe = async (dia) => Number((await q(`select public.cambio_del_dia($1::date, 'VENTA') as c`, [dia]))[0].c)
// Y lo dice con el día en que se registró ese cambio, que puede no ser el suyo.
const registradoDe = async (dia) =>
  (await q(`select to_char(max(fecha), 'YYYY-MM-DD') as f from public.tipos_de_cambio where fecha <= $1::date and fecha > $1::date - 10`, [dia]))[0].f
const tcHoy = await cambioDe(hoy)
const regHoy = await registradoDe(hoy)
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
// Ni la página ni la tarjeta de las OS: la tarjeta corta lo que se sale, y el importe quedaba tapado.
const desborda = (pagina) =>
  pagina.evaluate(() => {
    const tarjeta = document.querySelector('[data-servicios]')
    return document.documentElement.scrollWidth > window.innerWidth || (tarjeta ? tarjeta.scrollWidth > tarjeta.clientWidth : false)
  })
const COSTEO = `/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO, vista: 'costeo' })}`

/** Lo que el costeo dice de la OS en dólares y del costo del código. */
async function leerCosteo(pagina, os = d) {
  await ir(pagina, COSTEO)
  const fila = pagina.locator(`[data-servicios] [data-servicio="${os.numero}"]`).first()
  const filaSoles = pagina.locator(`[data-servicios] [data-servicio="${s.numero}"]`).first()
  return {
    dia: await fila.locator('[data-dia-de-la-linea]').getAttribute('data-dia-de-la-linea').catch(() => null),
    texto: limpio(await fila.locator('[data-dia-de-la-linea]').textContent().catch(() => '')),
    emitida: limpio(await fila.locator('[data-emitida-el]').textContent().catch(() => '')),
    // Lo que la fila dice que pesa en soles (null si no lo dice), y cuántas veces lo dice la de soles.
    pesa: await fila.locator('[data-soles-de-la-os]').count() ? Number(await fila.locator('[data-soles-de-la-os]').getAttribute('data-soles-de-la-os')) : null,
    solesPesa: await filaSoles.locator('[data-soles-de-la-os]').count(),
    importe: limpio(await fila.innerText().catch(() => '')),
    soles: limpio(await filaSoles.locator('[data-emitida-el]').textContent().catch(() => '')),
    solesConCambio: await filaSoles.locator('[data-dia-de-la-linea]').count(),
    costo: Number(await pagina.locator('[data-costo]').first().getAttribute('data-costo').catch(() => NaN)),
    alCambio: Number(await pagina.locator('[data-dolares-al-cambio]').first().getAttribute('data-dolares-al-cambio').catch(() => NaN)),
    ayuda: await pagina.locator('[data-servicios]').first().innerHTML().catch(() => ''),
    // Bajo «Total aprobado»: lo que los servicios pesan en el costo, y los dólares que no suman.
    enElCosto: Number(await pagina.locator('[data-servicios-en-el-costo]').first().getAttribute('data-servicios-en-el-costo').catch(() => NaN)),
    sinCambio: Number(await pagina.locator('[data-servicios-en-el-costo]').first().getAttribute('data-servicios-sin-cambio').catch(() => NaN)),
  }
}

// 2. Gerencia, antes de la factura ---------------------------------------------------
const ger = await entrar('gerencia', 1440)
{
  const c = await leerCosteo(ger)
  const esperado = Math.round(1000 * tcHoy * 100) / 100
  comprobar(c.dia === hoy && c.texto === `Al cambio del ${dma(regHoy)}`,
    `sin factura, la ${d.numero} va con el cambio de su día de emisión y dice el último registrado hasta él: «Al cambio del ${dma(regHoy)}» (dice «${c.texto}»)`)
  comprobar(c.emitida === `Emitida el ${dma(hoy)}`, `y encima, el día en que se emitió, con su rótulo (dice «${c.emitida}»)`)
  comprobar(c.soles === dma(hoy) && c.solesConCambio === 0 && c.solesPesa === 0, `la ${s.numero}, en soles, lleva solo su fecha (dice «${c.soles}»)`)
  comprobar(c.pesa === Number(d.monto_pen), `bajo sus dólares dice lo que pesa: los S/ ${d.monto_pen} que guarda la OS (dice ${c.pesa})`)
  comprobar(c.importe.includes('US$') || c.importe.includes('$'), 'la OS en dólares sigue mostrándose en dólares')
  comprobar(c.alCambio === esperado && c.costo === esperado + 500, `el costo la suma con el cambio de ese día: S/ ${esperado} + S/ 500 (dice ${c.costo}, con ${c.alCambio} de dólares al cambio)`)
  comprobar(!(await desborda(ger)), 'el costeo no se sale de la pantalla a 1440')
  await captura(ger, 'costeo-antes-de-la-factura-1440')
}

// 3. Logística adjunta la factura de hace 3 días, con clic ----------------------------
async function adjuntarFactura(os, dia, numero, que) {
  const log = await entrar('logistica', 1440)
  await ir(log, '/compras/servicios')
  await log.locator(`[data-adjuntar-documento-servicio="${os.numero}"]`).first().click()
  const v = log.locator(VENTANA)
  await v.waitFor()
  await v.locator('input[name="numero"]').fill(numero)
  await v.locator('input[name="fecha_emision"]').fill(dia)
  await v.locator('input[type="file"]').setInputFiles({
    name: `factura-${numero}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${numero}`),
  })
  await v.locator('button[type="submit"]').click()
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 40000 }), v.locator('[role="alert"]').waitFor({ timeout: 40000 })]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  await log.waitForLoadState('networkidle')
  comprobar(!error, `Logística adjunta ${que}${error ? ` («${error}»)` : ''}`)
  await log.context().close()
}
await adjuntarFactura(d, hace3, `F001-${SELLO}`, 'la factura de hace 3 días')
const [despues] = await q(`select monto_pen, to_char(fecha_cambio, 'YYYY-MM-DD') as fecha_cambio from public.ordenes_servicio where id = $1`, [d.id])
comprobar(despues.fecha_cambio === hace3 && Number(despues.monto_pen) === Math.round(1000 * tc3 * 100) / 100,
  `la OS tomó el cambio de su factura: S/ ${despues.monto_pen}`)

// 4. Gerencia, después de la factura -------------------------------------------------
{
  const c = await leerCosteo(ger)
  comprobar(c.dia === hace3 && c.texto === `Al cambio del ${dma(hace3)}`, `con su factura, la ${d.numero} dice «Al cambio del ${dma(hace3)}» (dice «${c.texto}»)`)
  comprobar(c.emitida === `Emitida el ${dma(hoy)}`, `y sigue diciendo el día en que se emitió (dice «${c.emitida}»)`)
  comprobar(c.alCambio === Number(despues.monto_pen) && c.pesa === Number(despues.monto_pen),
    `y pesa en el costo lo mismo que su monto en soles, y la fila lo dice: S/ ${despues.monto_pen} (el costo dice ${c.alCambio} y la fila ${c.pesa})`)
  comprobar(c.costo === Number(despues.monto_pen) + 500, `el costo del código es S/ ${Number(despues.monto_pen) + 500} (dice ${c.costo})`)
  comprobar(c.enElCosto === c.costo && c.sinCambio === 0, `y bajo «Total aprobado» la tarjeta dice lo mismo que pesa en el costo (dice ${c.enElCosto})`)
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

// 6. La factura de un día sin cambio registrado: la fila lo dice y no afirma ninguno ----
{
  const sinCambio = (await cambioDe(hace45)) === 0
  if (!sinCambio) {
    console.log(`  (hay un cambio registrado cerca del ${dma(hace45)}: no se prueba la OS sin cambio)`)
  } else {
    const n = await emitir('n', 'USD', 200, 'Flete de la tolva')
    await adjuntarFactura(n, hace45, `F002-${SELLO}`, 'a otra OS una factura de hace 45 días, sin cambio registrado')
    const [os] = await q(`select monto_pen from public.ordenes_servicio where id = $1`, [n.id])
    for (const ancho of [1440, 390]) {
      const p = await entrar('gerencia', ancho)
      const c = await leerCosteo(p, n)
      comprobar(c.texto === `Sin cambio del ${dma(hace45)}` && os.monto_pen === null && c.pesa === null,
        `a ${ancho}, la ${n.numero} dice «Sin cambio del ${dma(hace45)}» y no afirma ningún cambio (dice «${c.texto}»)`)
      comprobar(c.costo === Number(despues.monto_pen) + 500, `y el costo no la suma: sigue en S/ ${Number(despues.monto_pen) + 500} (dice ${c.costo})`)
      comprobar(/no suma/.test(c.importe) && c.enElCosto === c.costo && c.sinCambio === 200,
        `la fila dice «no suma» y bajo «Total aprobado»: S/ ${c.costo} en el costo y US$ 200 sin cambio (dice ${c.enElCosto} y ${c.sinCambio})`)
      comprobar(!(await desborda(p)), `sin salirse de la pantalla a ${ancho}`)
      await captura(p, `costeo-sin-cambio-${ancho}`)
      await p.context().close()
    }
  }
}

// 7. La OS fija y el cambio corregido después: el costo sigue con el monto que guarda la OS ----
{
  // El banco no tiene cajas y registrar_pago_servicio exige una: el depósito se siembra.
  await base.query('begin')
  await base.query(`set local session_replication_role = replica`)
  await base.query(
    `insert into public.pagos_orden_servicio (orden_servicio_id, fecha_pago, moneda, monto, cancela, destino, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
     select s.id, current_date, 'PEN', s.detraccion_monto, false, 'DETRACCION', 'prueba/' || $2 || '/detraccion.pdf', 'application/pdf', 1000,
            (select id from public.usuarios where correo = 'tesoreria.local@metalwork.test')
       from public.ordenes_servicio s where s.id = $1 and s.detraccion_monto > 0`,
    [d.id, SELLO],
  )
  await base.query('commit')
  const [{ fija }] = await q(`select public.servicio_con_el_cambio_fijo($1) as fija`, [d.id])
  comprobar(fija === true, `la ${d.numero} tiene su detracción depositada y queda fija`)
  await como('contabilidad', `update public.tipos_de_cambio set venta = venta + 0.05, compra = compra + 0.05 where fecha = $1::date`, [hace3])
  const [fijaOs] = await q(`select monto_pen from public.ordenes_servicio where id = $1`, [d.id])
  const corregido = Math.round(1000 * (await cambioDe(hace3)) * 100) / 100
  comprobar(Number(fijaOs.monto_pen) === Number(despues.monto_pen) && corregido !== Number(despues.monto_pen),
    `Contabilidad corrige el cambio del ${dma(hace3)}: la OS fija sigue en S/ ${fijaOs.monto_pen} (con el corregido serían S/ ${corregido})`)
  for (const ancho of [1440, 390]) {
    const p = await entrar('gerencia', ancho)
    const c = await leerCosteo(p)
    comprobar(c.alCambio === Number(despues.monto_pen) && c.costo === Number(despues.monto_pen) + 500,
      `a ${ancho}, el costo sigue pesando lo que guarda la OS: S/ ${despues.monto_pen} + S/ 500, no S/ ${corregido} (dice ${c.costo})`)
    comprobar(c.texto === 'Cambio fijo: detracción depositada u orden pagada' && c.pesa === Number(despues.monto_pen),
      `la fila dice «Cambio fijo: detracción depositada u orden pagada» y los S/ ${despues.monto_pen} que pesa (dice «${c.texto}» y ${c.pesa})`)
    comprobar(c.enElCosto === c.costo, `y bajo «Total aprobado» siguen los mismos S/ ${c.costo} (dice ${c.enElCosto})`)
    comprobar(!(await desborda(p)), `sin salirse de la pantalla a ${ancho}`)
    await captura(p, `costeo-os-fija-${ancho}`)
    await p.context().close()
  }
  // El cambio de ese día es del banco, no de esta corrida: se devuelve como estaba, para que
  // otra corrida (o quien mire el banco a la vez) no herede la corrección.
  await como('contabilidad', `update public.tipos_de_cambio set venta = venta - 0.05, compra = compra - 0.05 where fecha = $1::date`, [hace3])
  comprobar(Math.abs((await cambioDe(hace3)) - tc3) < 0.0001, `el cambio del ${dma(hace3)} vuelve a ${tc3}`)
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLAS:\n- ${fallas.join('\n- ')}` : '\nSin fallas.')
process.exit(fallas.length ? 1 : 0)

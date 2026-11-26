/**
 * Clic real sobre el Plan 9 · 9.1 (migración 20261126200000): Ventas ve dónde
 * va su cotización. Con la cuenta de Ventas, nunca ADMIN:
 *
 *   1. Siembra en el banco, con la cuenta de cada puesto, cuatro cotizaciones
 *      del vendedor: una que espera a Gerencia, una devuelta con observación,
 *      una aprobada con su código y su OT, y una anulada. Las fechas se corren
 *      hacia atrás con los disparadores apagados, solo en el banco.
 *   2. En la devuelta, la observación de Gerencia es lo primero de la tarjeta,
 *      antes que el cliente y el monto; en la anulada, su motivo.
 *   3. El recorrido dice cada paso con las palabras de Ventas y cuánto tardó:
 *      «Rechazada · a los 3 días» con «Devuelta a Ventas con observación»,
 *      «Aprobada» con «Liberada…»,
 *      «Con código interno y OT · a los 3 días»; y quién la tiene y hace cuánto.
 *   4. La campana trae la respuesta de Gerencia —aprobó, rechazó, anuló— y su
 *      toque lleva a la tarjeta de esa cotización (`#id`), también la anulada:
 *      la deja a la vista, marcada (`data-del-aviso`) y con el cursor. Abrir
 *      otro aviso estando ya en la pantalla mueve la marca a la otra tarjeta.
 *   5. En el teléfono (390) nada se sale de la pantalla con el recorrido abierto.
 *
 * Deja capturas en CAPTURAS, en 390 y 1440. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Escribe con la sesión de esa cuenta y el rol authenticated, y lo deja guardado. */
async function comoCuenta(puesto, sql, valores = []) {
  const cuenta = await uno('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ============================================ 1. Las cuatro cotizaciones
const ventas = await uno('select id from public.usuarios where correo = $1', [correoDe('ventas')])
const cliente = await uno(`select id, razon_social from public.clientes where activo order by razon_social limit 1`)
const carroceria = await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)
const sello = Date.now().toString().slice(-4)
const cot = { espera: randomUUID(), devuelta: randomUUID(), conOt: randomUUID(), anulada: randomUUID() }
const numero = { espera: `${sello}1-2026`, devuelta: `${sello}2-2026`, conOt: `${sello}3-2026`, anulada: `${sello}4-2026` }
const orden = randomUUID()

for (const clave of Object.keys(cot)) {
  await base.query(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('cotizaciones-pdf', $1, $2, '{"mimetype": "application/pdf", "size": 1200}')`,
    [`cot/${cot[clave]}/v1.pdf`, ventas.id])
  await comoCuenta('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
    values ($1, $2, $3, $4, 'cotizacion.pdf', $5, 'application/pdf', 1200, $6, 58400, 'PEN')`,
    [cot[clave], numero[clave], cliente.id, carroceria.id, `cot/${cot[clave]}/v1.pdf`, ventas.id])
}
await comoCuenta('gerencia', `update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el plazo de entrega y la forma de pago.' where id = $1`, [cot.devuelta])
await comoCuenta('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cot.conOt])
await comoCuenta('gerencia', `update public.cotizaciones_pdf set estado = 'ANULADA', observacion = 'El cliente compró la carrocería en otra empresa.' where id = $1`, [cot.anulada])
await comoCuenta('administracion', `select public.cargar_codigo_y_ot_de_cotizacion($1, $2, $3, $4, 'SEMIRREMOLQUE', current_date + 30, $5, 'orden.pdf', 1000)`,
  [cot.conOt, orden, `MW-V${sello}`, `9${sello}`, `ot/${orden}/orden.pdf`])

// Las fechas de antes, por fecha de Lima al mediodía: solo en el banco.
const hace = (d) => `(((now() at time zone 'America/Lima')::date - ${d})::timestamp + interval '12 hours') at time zone 'America/Lima'`
await base.query('begin')
await base.query('set local session_replication_role = replica')
await base.query(`update public.cotizaciones_pdf set creado_en = ${hace(2)}, archivo_subido_en = ${hace(2)} where id = $1`, [cot.espera])
await base.query(`update public.cotizaciones_pdf set creado_en = ${hace(4)}, archivo_subido_en = ${hace(4)}, revisado_en = ${hace(1)} where id = $1`, [cot.devuelta])
await base.query(`update public.cotizaciones_pdf set creado_en = ${hace(7)}, archivo_subido_en = ${hace(7)}, revisado_en = ${hace(4)} where id = $1`, [cot.conOt])
await base.query(`update public.ordenes_trabajo set creado_en = ${hace(1)} where id = $1`, [orden])
await base.query(`update public.cotizaciones_pdf set creado_en = ${hace(3)}, archivo_subido_en = ${hace(3)} where id = $1`, [cot.anulada])
await base.query('commit')
console.log(`Sembradas ${Object.values(numero).join(', ')} de ${cliente.razon_social}`)

// ============================================ La pantalla, con la cuenta de Ventas
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const telefono = ancho <= 480
  const contexto = await navegador.newContext({
    viewport: telefono ? { width: ancho, height: 844 } : { width: ancho, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: telefono,
    isMobile: telefono,
    timezoneId: 'America/Lima',
  })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('pageerror', (e) => errores.push(`${correo}: ${String(e).slice(0, 300)}`))
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

async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  await conReact(pagina)
}

const tarjeta = (pagina, id) => pagina.locator(`li[id="${id}"]`)
async function abrirRecorrido(pagina, id) {
  const recorrido = tarjeta(pagina, id).locator('details[data-recorrido]')
  await recorrido.locator('summary').click()
  await recorrido.locator('ol').waitFor({ state: 'visible', timeout: 10000 })
  return recorrido
}
const pasos = (recorrido) =>
  recorrido.locator('li[data-recorrido-paso]').evaluateAll((lis) => lis.map((li) => li.innerText.replace(/\s+/g, ' ').trim()))

{
  const { pagina, contexto } = await entrar('ventas', 1440)
  await ir(pagina, '/cotizaciones/pdf')

  // 2. La observación de Gerencia, arriba.
  const devuelta = tarjeta(pagina, cot.devuelta)
  const texto = limpio(await devuelta.innerText())
  const enObs = texto.indexOf('Falta el plazo de entrega')
  const enCliente = texto.indexOf(cliente.razon_social)
  comprobar(enObs > 0 && enCliente > enObs, `la observación de Gerencia va antes que el cliente y el monto («${texto.slice(0, 160)}…»)`)

  // 3. El recorrido con las palabras de Ventas y los días de cada paso.
  const rDev = await abrirRecorrido(pagina, cot.devuelta)
  const resumenDev = limpio(await rDev.locator('summary').innerText())
  comprobar(/La tiene (Agente de )?Ventas/.test(resumenDev) && /hace 1 día/.test(resumenDev),
    `cerrado dice que la tiene Ventas hace 1 día (${resumenDev})`)
  const pDev = await pasos(rDev)
  comprobar(/^Enviada a Gerencia/.test(pDev[0] ?? '') && !/ · (a los|al día|el mismo)/.test(pDev[0] ?? ''), `la subida no lleva días (${pDev[0]})`)
  comprobar(/^Rechazada.*Gerencia.*a los 3 días.*Devuelta a Ventas con observación/.test(pDev[1] ?? ''), `rechazada y devuelta a los 3 días, con el puesto de Gerencia (${pDev[1]})`)
  await devuelta.scrollIntoViewIfNeeded()
  await devuelta.screenshot({ path: `${CAPTURAS}/9-1-ventas-1440-1-devuelta-con-recorrido.png` })

  const rOt = await abrirRecorrido(pagina, cot.conOt)
  const pOt = await pasos(rOt)
  const aprobada = pOt.find((p) => p.startsWith('Aprobada')) ?? ''
  comprobar(/a los 3 días/.test(aprobada) && /Liberada: ya la ven Contabilidad y Tesorería/.test(aprobada),
    `aprobada a los 3 días y liberada a Contabilidad y Tesorería (${aprobada})`)
  const conOt = pOt.find((p) => p.startsWith('Con código interno y OT')) ?? ''
  comprobar(/a los 3 días/.test(conOt), `con OT a los 3 días de aprobada (${conOt})`)
  comprobar(pOt.some((p) => /Ahora la tiene Contabilidad/.test(p)), 'y ahora la tiene Contabilidad para facturar')
  await tarjeta(pagina, cot.conOt).scrollIntoViewIfNeeded()
  await tarjeta(pagina, cot.conOt).screenshot({ path: `${CAPTURAS}/9-1-ventas-1440-2-con-ot.png` })

  const rEsp = tarjeta(pagina, cot.espera).locator('details[data-recorrido] summary')
  comprobar(/La tiene Gerencia.*hace 2 días/.test(limpio(await rEsp.innerText())), `la que espera dice que la tiene Gerencia hace 2 días (${limpio(await rEsp.innerText())})`)

  // 4. La campana: tres respuestas de Gerencia, y cada una lleva a su tarjeta.
  await ir(pagina, '/')
  await pagina.locator('button[aria-label^="Avisos"]').first().click()
  const panel = pagina.locator('#panel-avisos')
  await panel.waitFor({ state: 'visible' })
  const avisos = (await panel.locator('li').allInnerTexts()).map(limpio)
  const de = (n, que = 'Gerencia') => avisos.find((a) => a.includes(n) && a.includes(que)) ?? ''
  comprobar(/Gerencia rechazó tu cotización/.test(de(numero.devuelta)) && /Falta el plazo de entrega/.test(de(numero.devuelta)), `rechazo con su observación (${de(numero.devuelta)})`)
  comprobar(/Gerencia anuló tu cotización/.test(de(numero.anulada)) && /otra empresa/.test(de(numero.anulada)), `anulación con su motivo (${de(numero.anulada)})`)
  comprobar(/Gerencia aprobó tu cotización/.test(de(numero.conOt)), `aprobación (${de(numero.conOt)})`)
  await pagina.screenshot({ path: `${CAPTURAS}/9-1-ventas-1440-3-campana.png` })

  await panel.locator('li', { hasText: numero.devuelta }).filter({ hasText: 'rechazó' }).locator('button').click()
  await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf' && u.hash === `#${cot.devuelta}`, { timeout: 15000 }).catch(() => {})
  comprobar(pagina.url().endsWith(`/cotizaciones/pdf#${cot.devuelta}`), `el aviso del rechazo lleva a su tarjeta (${pagina.url()})`)
  await conReact(pagina)
  await tarjeta(pagina, cot.devuelta).waitFor({ state: 'visible' })
  // El navegador baja a la tarjeta cuando la lista termina de pintarse: se espera eso, no a la red.
  const visible = await pagina
    .waitForFunction((id) => {
      const el = document.getElementById(id)
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.top < window.innerHeight && r.bottom > 0
    }, cot.devuelta, { timeout: 10000 })
    .then(() => true, () => false)
  comprobar(visible, 'y la tarjeta queda a la vista')
  const marcadas = () => pagina.evaluate(() => [...document.querySelectorAll('[data-del-aviso]')].map((e) => e.id))
  const conCursor = () => pagina.evaluate(() => document.activeElement?.id ?? '')
  comprobar(JSON.stringify(await marcadas()) === JSON.stringify([cot.devuelta]), `marcada como la del aviso (${await marcadas()})`)
  comprobar((await conCursor()) === cot.devuelta, 'y con el cursor')

  // Otro aviso, sin salir de la pantalla: la marca pasa a la otra tarjeta.
  await pagina.locator('button[aria-label^="Avisos"]').first().click()
  await panel.waitFor({ state: 'visible' })
  await panel.locator('li', { hasText: numero.conOt }).filter({ hasText: 'aprobó' }).locator('button').click()
  await pagina.waitForURL((u) => u.hash === `#${cot.conOt}`, { timeout: 15000 }).catch(() => {})
  const pasoLaMarca = await pagina
    .waitForFunction((id) => {
      const m = [...document.querySelectorAll('[data-del-aviso]')]
      const r = document.getElementById(id)?.getBoundingClientRect()
      return m.length === 1 && m[0].id === id && document.activeElement?.id === id && r && r.top < window.innerHeight && r.bottom > 0
    }, cot.conOt, { timeout: 10000 })
    .then(() => true, () => false)
  comprobar(pasoLaMarca, `en la misma pantalla, el aviso de la aprobada la marca a ella sola (${await marcadas()})`)
  await pagina.screenshot({ path: `${CAPTURAS}/9-1-ventas-1440-4-marcada-por-el-aviso.png` })

  await ir(pagina, '/')
  await pagina.locator('button[aria-label^="Avisos"]').first().click()
  await panel.waitFor({ state: 'visible' })
  await panel.locator('li', { hasText: numero.anulada }).locator('button').click()
  await pagina.waitForURL((u) => u.hash === `#${cot.anulada}`, { timeout: 15000 }).catch(() => {})
  comprobar(pagina.url().includes('/cotizaciones/pdf?estado=ANULADA') && pagina.url().endsWith(`#${cot.anulada}`),
    `el de la anulada lleva a su tarjeta, entre las anuladas (${pagina.url()})`)
  await conReact(pagina)
  comprobar(await tarjeta(pagina, cot.anulada).waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false), 'y ahí está')
  comprobar(JSON.stringify(await marcadas()) === JSON.stringify([cot.anulada]), `marcada como la del aviso (${await marcadas()})`)
  const anulada = limpio(await tarjeta(pagina, cot.anulada).innerText())
  comprobar(anulada.indexOf('Anulada:') > 0 && anulada.indexOf('Anulada:') < anulada.indexOf(cliente.razon_social),
    `el motivo de la anulación va antes que el cliente («${anulada.slice(0, 140)}…»)`)
  await contexto.close()
}

// 5. En el teléfono.
{
  const { pagina, contexto } = await entrar('ventas', 390)
  await ir(pagina, '/cotizaciones/pdf')
  await abrirRecorrido(pagina, cot.devuelta)
  await tarjeta(pagina, cot.devuelta).scrollIntoViewIfNeeded()
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en 390 nada se sale con el recorrido abierto (ancho ${ancho})`)
  await tarjeta(pagina, cot.devuelta).screenshot({ path: `${CAPTURAS}/9-1-ventas-390-1-devuelta-con-recorrido.png` })
  await abrirRecorrido(pagina, cot.conOt)
  await tarjeta(pagina, cot.conOt).scrollIntoViewIfNeeded()
  await tarjeta(pagina, cot.conOt).screenshot({ path: `${CAPTURAS}/9-1-ventas-390-2-con-ot.png` })
  await pagina.locator('button[aria-label^="Avisos"]').first().click()
  await pagina.locator('#panel-avisos').waitFor({ state: 'visible' })
  await pagina.screenshot({ path: `${CAPTURAS}/9-1-ventas-390-3-campana.png` })
  await contexto.close()
}

await navegador.close()
await base.end()

for (const e of errores) console.log(`consola · ${e}`)
comprobar(errores.length === 0, `sin errores en la consola (${errores.length})`)
if (fallas.length > 0) {
  console.error(`\n${fallas.length} falla(s).`)
  process.exit(1)
}
console.log('\nTodo bien.')

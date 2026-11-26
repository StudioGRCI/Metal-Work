/**
 * Clic real sobre el plan 2, entrega 2.1: lo que falta entregar de cada RQ, en
 * «Atención de requerimiento». Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Almacén ve de cada insumo lo pedido, lo entregado, lo separado y lo
 *      pendiente de compra, con la entrega parcial en cifras («Entregado 2 de
 *      10 UND · faltan 8») y la fecha en que se espera su OC. Las cifras de la
 *      pantalla son las de la base (lo que salió del kardex con ese insumo).
 *      Una cantidad en metros no arrastra decimales (5.3 − 2.1 = 3.2).
 *   2. Cada RQ lleva su recorrido plegado, que cerrado dice quién lo tiene.
 *   3. En el teléfono (390 px) la fila va apilada y nada se sale de la pantalla.
 *   4. Logística y el supervisor de Maestranza abren la misma bandeja sin
 *      errores; el supervisor, que no lee las compras, no ve la fecha de la OC.
 *
 * Siembra con las funciones de la base y la sesión de cada puesto: un disco y
 * una plancha en metros con stock, y cuatro RQ de Maestranza: uno en compra
 * con una salida parcial, uno listo en almacén con una salida en metros, uno
 * por revisar y uno sin compra. Las salidas llevan su foto en Storage.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const CUENTAS = {
  requerimientos: 'requerimientos.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  supervisor: 'sup.mtz.local@metalwork.test',
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

/** Corre `sql` con la sesión de `correo`, con su rol y no como dueño de las tablas. */
async function como(correo, sql, valores = []) {
  await base.query('begin')
  try {
    const [u] = await consulta('select id::text from public.usuarios where correo = $1', [correo])
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [u.id],
    )
    await base.query('set local role authenticated')
    const filas = await consulta(sql, valores)
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

// ============================================ 0. Lo que se siembra
const sufijo = Date.now().toString(36).slice(-4).toUpperCase()
const consumible = `(select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1)`
const unidad = (codigo) => `(select id from public.unidades_medida where codigo = '${codigo}')`
const [disco] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, ${consumible}, ${unidad('UND')}) returning id::text`, [`PRB-E21-${sufijo}`, `Disco de corte 4½" ${sufijo}`])
const [plancha] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, ${consumible}, ${unidad('M')}) returning id::text`, [`PRB-E21M-${sufijo}`, `Platina de 2" en metros ${sufijo}`])
for (const [m, n] of [[disco.id, 20], [plancha.id, 10]]) {
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
    select gen_random_uuid(), 'INGRESO', $1::uuid, $4, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $3`,
    [m, `GR BANCO E21 ${sufijo}`, CUENTAS.almacen, n])
}
const [{ id: area }] = await consulta(`select id::text from public.areas where codigo = 'MTZ'`)
const rq = { compra: crypto.randomUUID(), listo: crypto.randomUUID(), revisar: crypto.randomUUID(), sinOc: crypto.randomUUID() }
const pedidos = {
  compra: [{ material_id: disco.id, cantidad: 10 }],
  listo: [{ material_id: plancha.id, cantidad: 5.3 }],
  revisar: [{ material_id: disco.id, cantidad: 4 }],
  sinOc: [{ material_id: disco.id, cantidad: 6 }],
}
for (const k of Object.keys(rq)) {
  await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba de lo que falta entregar', null, $4::jsonb)`,
    [rq[k], area, `BANCO-E21${k.toUpperCase()}${sufijo}`, JSON.stringify(pedidos[k])])
}
const numero = async (id) => (await consulta('select numero from public.requerimientos where id = $1', [id]))[0].numero
const insumo = async (id) => (await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 1', [id]))[0].id
const N = {}
for (const [k, id] of Object.entries(rq)) N[k] = await numero(id)

await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 3}]', null)`, [rq.compra])
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 5.3}]', null)`, [rq.listo])
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]', null)`, [rq.sinOc])

// Las compras piden un proveedor activo; el banco recién hecho no trae ninguno.
await consulta(
  `insert into public.proveedores (numero_documento, razon_social)
   select r, 'PROVEEDOR DEL BANCO'
     from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(100000, 100200) n, generate_series(0, 9) d) x
    where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores where activo)
    order by r limit 1
   on conflict do nothing`,
)
const [prov] = await consulta(`select id::text from public.proveedores where activo order by razon_social limit 1`)
// La OC de lo que falta del RQ en compra (7), con su fecha esperada.
const [{ fecha: fechaOc }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date + 5, 'YYYY-MM-DD') as fecha`)
const oc = crypto.randomUUID()
await como(CUENTAS.logistica, `select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, $4, $5::date, 'CONTADO', 0, 'PEN', true)`,
  [oc, JSON.stringify([{ material_id: disco.id, cantidad: 7, precio: 9, insumos: [await insumo(rq.compra)] }]), prov.id, `Cotización del banco E21 ${sufijo}`, fechaOc])
const [{ aprobacion }] = await consulta('select aprobacion from public.ordenes_compra_materiales where id = $1', [oc])
if (aprobacion !== 'APROBADA' && aprobacion !== 'NO_REQUIERE') await como(CUENTAS.gerencia, 'select public.aprobar_compra($1)', [oc])

/** Una salida del kardex con su RQ, como la registra Almacén: con la foto en Storage. */
async function salida(rqId, material, cantidad, recibe) {
  const id = crypto.randomUUID()
  const [{ id: yo }] = await consulta('select id::text from public.usuarios where correo = $1', [CUENTAS.almacen])
  const ruta = `${yo}/${id}.jpg`
  mkdirSync(join(ARCHIVOS, 'evidencias-almacen', yo), { recursive: true })
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
  writeFileSync(join(ARCHIVOS, 'evidencias-almacen', ruta), jpg)
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values ('evidencias-almacen', $1, $2::uuid, $2, jsonb_build_object('size', $3::int, 'mimetype', 'image/jpeg'))`, [ruta, yo, jpg.length])
  await como(CUENTAS.almacen, `select public.registrar_salida_material($1, $2, $3, null, $4, 'Vale del banco E21', $5, $6, $7)`,
    [id, material, cantidad, `BANCO-E21X${sufijo}`, recibe, ruta, await insumo(rqId)])
  return id
}
await salida(rq.compra, disco.id, 2, 'Soldador de Maestranza')
await salida(rq.listo, plancha.id, 2.1, 'Armador de Maestranza')
console.log(`    sembrados: ${N.compra} en compra (2 de 10), ${N.listo} listo (2.1 de 5.3 M), ${N.revisar} por revisar, ${N.sinOc} sin OC`)

// Lo que dice la base de cada uno, para comparar con la pantalla.
const enLaBase = async (id) => {
  const [e] = await como(CUENTAS.almacen, 'select entregado::float as entregado from public.entregado_de_requerimientos(array[$1::uuid])', [id])
  return e?.entregado ?? null
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
async function entrar(correo, ancho = 1440) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 }, deviceScaleFactor: 2 })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 300)))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()
const ir = (pagina, ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 120000 })
const filaDe = (pagina, n) => pagina.locator('tbody tr', { hasText: n })
const cifras = async (pagina, n) => {
  const e = filaDe(pagina, n).locator('[data-entrega-insumo]').first()
  if ((await e.count()) === 0) return null
  const d = await e.evaluate((x) => ({ ...x.dataset }))
  return { ...d, texto: await texto(e) }
}

// ============================================ 1 y 2. Almacén, en el monitor
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/requerimientos/atencion')

  const c = await cifras(pagina, N.compra)
  const entregadoBase = await enLaBase(rq.compra)
  comprobar(c?.entregaInsumo === 'PARCIAL' && Number(c.entregado) === entregadoBase && entregadoBase === 2,
    `${N.compra}: lo entregado es lo de la base (${entregadoBase}) y la entrega es parcial: «${c?.texto}»`)
  comprobar(c?.texto.startsWith('Entregado 2 de 10 UND · faltan 8'), 'dice la entrega parcial en cifras')
  comprobar(Number(c?.separado) === 1 && Number(c?.porLlegar) === 7 && Number(c?.porComprar) === 0,
    `de lo que falta, 1 separado y 7 por llegar con su OC (${c?.separado}, ${c?.porLlegar}, ${c?.porComprar})`)
  const [a, m, d] = fechaOc.split('-')
  comprobar(c?.texto.includes(`se espera el ${d}/${m}/${a}`), `con la fecha que Logística espera la compra (${d}/${m}/${a})`)
  comprobar(!/S\/|US\$|precio/i.test(c?.texto ?? ''), 'sin precios')

  const l = await cifras(pagina, N.listo)
  comprobar(l?.texto.startsWith('Entregado 2.1 de 5.3 M · faltan 3.2') && Number(l?.separado) === 3.2,
    `${N.listo}, en metros, sin decimales de más: «${l?.texto}»`)

  const r = await cifras(pagina, N.revisar)
  comprobar(r?.entregaInsumo === 'NADA' && Number(r?.porRevisar) === 4, `${N.revisar} por revisar: «${r?.texto}»`)
  const s = await cifras(pagina, N.sinOc)
  comprobar(Number(s?.porComprar) === 6 && Number(s?.porLlegar) === 0, `${N.sinOc} sin OC, por comprar: «${s?.texto}»`)

  // El recorrido de cada RQ, plegado; cerrado dice quién lo tiene.
  for (const n of [N.compra, N.listo, N.revisar, N.sinOc]) {
    const rec = filaDe(pagina, n).locator('details[data-recorrido]')
    comprobar((await rec.count()) === 1 && !(await rec.evaluate((e) => e.open)), `${n} lleva su recorrido plegado`)
  }
  const resumen = await texto(filaDe(pagina, N.revisar).locator('details[data-recorrido] summary'))
  comprobar(/Almac[eé]n/.test(resumen), `cerrado dice quién lo tiene: «${resumen}»`)
  await filaDe(pagina, N.compra).locator('details[data-recorrido] summary').click()
  comprobar(await filaDe(pagina, N.compra).locator('details[data-recorrido]').evaluate((e) => e.open), 'se abre con un toque')
  await filaDe(pagina, N.compra).locator('details[data-recorrido] summary').click()

  await filaDe(pagina, N.compra).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '2-1-almacen-1440-atencion.png'), fullPage: false })
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 3. Almacén, en el teléfono
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen, 390)
  await ir(pagina, '/requerimientos/atencion')
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `a 390 px nada se sale de la pantalla (${ancho} px)`)
  const c = filaDe(pagina, N.compra).locator('[data-entrega-insumo]').first()
  const caja = await c.boundingBox()
  comprobar(caja !== null && caja.x >= 0 && caja.x + caja.width <= 390, `la cuenta del insumo cabe en el teléfono (${JSON.stringify(caja)})`)
  await c.scrollIntoViewIfNeeded()
  await pagina.evaluate(() => window.scrollBy(0, -120))
  await pagina.screenshot({ path: join(CAPTURAS, '2-1-almacen-390-atencion.png'), fullPage: false })
  comprobar(errores.length === 0, `sin errores de consola en el teléfono ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 4. Logística y el supervisor
for (const [puesto, correo] of [['Logística', CUENTAS.logistica], ['Supervisión de Maestranza', CUENTAS.supervisor]]) {
  const { pagina, contexto, errores } = await entrar(correo)
  await ir(pagina, '/requerimientos/atencion')
  const c = await cifras(pagina, N.compra)
  comprobar(c?.texto.startsWith('Entregado 2 de 10 UND · faltan 8'), `${puesto} ve la misma cuenta: «${c?.texto}»`)
  if (correo === CUENTAS.supervisor) comprobar(!c?.texto.includes('se espera el'), 'el supervisor no lee las compras: sin la fecha de la OC')
  comprobar(errores.length === 0, `sin errores de consola como ${puesto} ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobaciones fallaron.`)
  process.exit(1)
}
console.log('\nTodo pasa.')

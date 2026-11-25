/**
 * Clic real sobre la migración 20261016950000 y el RQ desplegable por insumo.
 * Con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El supervisor de Maestranza tiene «Stock en almacén» después de sus
 *      requerimientos, en el monitor y en el teléfono. Ve cada material en su
 *      almacén con lo que dice el kardex, los accesorios por código interno, lo
 *      que está bajo el mínimo y lo que se acabó, sin precios ni kardex. Busca
 *      por código interno y filtra por almacén.
 *   2. En Requerimientos ve primero los de su área. Cada RQ en camino llega
 *      desplegado (tarjetas del 2026-10-20): arriba cuántos insumos se pueden
 *      recoger en Almacén y cuántos faltan que lleguen, y cada insumo con su
 *      barra, lo que se recoge, lo que falta de Logística, su OC y en qué va.
 *      Ve también los de todas las áreas y los de un código interno.
 *   3. Requerimientos, que los lleva, los ve desplegados como siempre. Desde el
 *      2026-10-20 entra también al stock (lo libre y lo de cada código lo
 *      prueba `probar-stock-libre.mjs`).
 *   4. Almacén abre el stock con el enlace a su kardex.
 *
 * Siembra lo suyo con un sufijo por corrida, para no depender de lo que otra
 * prueba dejó (hasta el 2026-11-25 esperaba unas cuentas `@local.test` y unos
 * RQ-0001…0003 que nadie creaba, y fallaba al entrar): un disco con 34 en
 * Consumibles (40 que entran, 6 que salen), un faro con 8 en Accesorios (3 que
 * entraron para el código A, 2 para el B y 3 sin código), una plancha con 12
 * bajo su mínimo de 15, guantes en EPP y una lija que se acabó; RQ A1
 * (Maestranza, código A: el disco lo da Almacén, la plancha en parte, el faro va
 * a compra con su OC), RQ B1 (Producción, código B: los guantes, listo en
 * almacén) y RQ B2 (Maestranza, código B, por revisar).
 * Usa las cuentas `*.local@metalwork.test` de `preparar.sh`.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, PGHOST,
 * PGPORT, BANCO_BASE (mw_demo).
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  supervisor: 'sup.mtz.local@metalwork.test',
  requerimientos: 'requerimientos.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

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

// ============================================ 0. Lo que se siembra
const sufijo = Date.now().toString(36).slice(-4).toUpperCase()
const CODIGO_A = `BANCO-SRA${sufijo}`
const CODIGO_B = `BANCO-SRB${sufijo}`
const categoria = (almacen) => `(select id from public.categorias_material where activo and almacen = '${almacen}' order by codigo limit 1)`
async function material(clave, descripcion, almacen, minimo = null) {
  const [m] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id, stock_minimo)
    values ($1, $2, ${categoria(almacen)}, (select id from public.unidades_medida where codigo = 'UND'), $3)
    returning id::text, codigo`, [`PRB-SR-${clave}-${sufijo}`, `${descripcion} ${sufijo}`, minimo])
  return m
}
const M = {
  disco: await material('DIS', 'Disco de corte del stock', 'CONSUMIBLES'),
  faro: await material('FAR', 'Faro del stock', 'ACCESORIOS'),
  plancha: await material('PLA', 'Plancha del stock', 'MATERIA_PRIMA', 15),
  guantes: await material('GUA', 'Guantes del stock', 'EPP'),
  lija: await material('LIJ', 'Lija del stock', 'CONSUMIBLES'),
}
// El kardex, como dueño de las tablas: el ingreso y la salida tienen sus propias pruebas.
async function mover(tipo, m, cantidad, codigo = null) {
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno, recibido_por_nombre, codigo_unidad)
    select gen_random_uuid(), $1, $2::uuid, $3, $4, $5, u.id, $6, $8, case when $8::text is not null then 'PLANTA' end from public.usuarios u where u.correo = $7`,
  [tipo, m.id, cantidad, tipo === 'INGRESO' ? 'INGRESO_GENERAL' : 'SALIDA_GENERAL', `BANCO SR ${sufijo}`, codigo, CUENTAS.almacen,
    tipo === 'INGRESO' ? null : 'Soldador del banco'])
}
await mover('INGRESO', M.disco, 40)
await mover('SALIDA', M.disco, 6, 'PLANTA')
await mover('INGRESO', M.faro, 3, CODIGO_A)
await mover('INGRESO', M.faro, 2, CODIGO_B)
await mover('INGRESO', M.faro, 3)
await mover('INGRESO', M.plancha, 12)
await mover('INGRESO', M.guantes, 10)
await mover('INGRESO', M.lija, 2)
await mover('SALIDA', M.lija, 2, 'PLANTA')

const areas = Object.fromEntries((await consulta(`select codigo, id::text from public.areas where codigo in ('MTZ', 'PRD')`)).map((a) => [a.codigo, a.id]))
const rq = { a1: crypto.randomUUID(), b1: crypto.randomUUID(), b2: crypto.randomUUID() }
const emitir = (id, area, codigo, lineas) => como(CUENTAS.requerimientos,
  `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba del stock y el RQ por insumo', null, $4::jsonb)`,
  [id, area, codigo, JSON.stringify(lineas.map(([m, cantidad]) => ({ material_id: m.id, cantidad })))])
await emitir(rq.a1, areas.MTZ, CODIGO_A, [[M.disco, 4], [M.plancha, 20], [M.faro, 3]])
await emitir(rq.b1, areas.PRD, CODIGO_B, [[M.guantes, 2]])
await emitir(rq.b2, areas.MTZ, CODIGO_B, [[M.disco, 1], [M.lija, 1]])
// Almacén revisa A1 (el disco entero, 12 de las 20 planchas, el faro no) y B1 (listo); B2 queda por revisar.
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 4}, {"item": 2, "en_stock": 12}, {"item": 3, "en_stock": 0}]', null)`, [rq.a1])
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 2}]', null)`, [rq.b1])
// Logística compra el faro de A1; no llega todavía. Las compras piden un proveedor activo.
await consulta(
  `insert into public.proveedores (numero_documento, razon_social)
   select r, 'PROVEEDOR DEL BANCO'
     from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(100000, 100200) n, generate_series(0, 9) d) x
    where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores where activo)
    order by r limit 1
   on conflict do nothing`,
)
const [prov] = await consulta(`select id::text from public.proveedores where activo order by razon_social limit 1`)
const [{ id: insumoFaro }] = await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 3', [rq.a1])
const oc = crypto.randomUUID()
await como(CUENTAS.logistica, `select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, $4, null, 'CONTADO', 0, 'PEN', true)`,
  [oc, JSON.stringify([{ material_id: M.faro.id, cantidad: 3, precio: 9, insumos: [insumoFaro] }]), prov.id, `Cotización del banco SR ${sufijo}`])
const [{ aprobacion }] = await consulta('select aprobacion from public.ordenes_compra_materiales where id = $1', [oc])
if (aprobacion !== 'APROBADA' && aprobacion !== 'NO_REQUIERE') await como(CUENTAS.gerencia, 'select public.aprobar_compra($1)', [oc])
const numero = async (id) => (await consulta('select numero from public.requerimientos where id = $1', [id]))[0].numero
const N = { a1: await numero(rq.a1), b1: await numero(rq.b1), b2: await numero(rq.b2) }
console.log(`    sembrados: ${N.a1} y ${N.b2} (Maestranza), ${N.b1} (Producción); ${CODIGO_A} y ${CODIGO_B}`)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
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

async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim()) })),
  )
}
async function pestanas(pagina) {
  return pagina.locator('nav[aria-label="Secciones"] a').evaluateAll((as) => as.map((a) => a.textContent?.trim()))
}
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
// Las fichas del resumen («2 para recoger») solo se ven con los insumos cerrados:
// abiertos, cada insumo lo dice en su unidad.
const resumenCerrado = async (detalles) => {
  if (await detalles.evaluate((d) => d.open)) await detalles.locator('summary').click()
  return texto(detalles.locator('summary'))
}
const ir = (pagina, ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })

// ============================================ 1. El supervisor ve el stock
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.supervisor)
  const suMenu = await menu(pagina)
  const supervision = suMenu.find((g) => g.grupo === 'Supervisión')?.items ?? []
  console.log('    menú de Supervisión:', supervision.join(' · '))
  comprobar(supervision.at(-1) === 'Stock en almacén' && supervision.indexOf('Requerimientos') === supervision.length - 2,
    'el supervisor tiene «Stock en almacén» después de Requerimientos')

  await ir(pagina, '/almacen/stock')
  comprobar((await texto(pagina.locator('h1'))) === 'Stock en almacén', 'abre «Stock en almacén»')
  const almacenes = await pagina.locator('[data-almacen]').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-almacen')))
  console.log('    almacenes:', almacenes.join(' · '))
  comprobar(['CONSUMIBLES', 'ACCESORIOS', 'MATERIA_PRIMA', 'EPP'].every((a) => almacenes.includes(a)), 've los cuatro almacenes')
  const fila = (codigo) => pagina.locator(`tr[data-material="${codigo}"]`)
  const disco = await texto(fila(M.disco.codigo))
  console.log('    disco:', disco)
  // Desde el 2026-10-20 el número grande es lo libre y el kardex va en «de 34 UND en almacén» si algo está separado.
  comprobar(/(^| )34 UND|de 34 UND en almacén/.test(disco), 'el disco: 40 que entraron menos 6 que salieron')
  const faro = await texto(fila(M.faro.codigo))
  console.log('    faro:', faro)
  comprobar(faro.includes('3 UND de 8 UND en almacén') && faro.includes(`${CODIGO_A} 3 UND`) && faro.includes(`${CODIGO_B} 2 UND`),
    'el faro: 8, de ellos 3 del código A y 2 del B, y 3 libres')
  const plancha = await texto(fila(M.plancha.codigo))
  comprobar(plancha.includes('12 UND') && plancha.includes('Bajo el mínimo de 15'), 'la plancha avisa que está bajo su mínimo')
  const lija = await texto(fila(M.lija.codigo))
  comprobar(lija.includes('Sin stock'), 'la lija que se acabó dice «Sin stock»')
  const todo = await texto(pagina.locator('main'))
  comprobar(!todo.includes('S/') && !/precio/i.test(todo), 'sin precios')
  comprobar((await pagina.getByRole('link', { name: 'Abrir el kardex' }).count()) === 0, 'sin enlace al kardex')
  await pagina.screenshot({ path: `${CAPTURAS}/stock-supervisor.png`, fullPage: true })

  // Por código interno, escrito en minúsculas: el faro que entró para el código B y los guantes que le separó B1.
  await ir(pagina, `/almacen/stock?q=${CODIGO_B.toLowerCase()}`)
  const conCodigo = await pagina.locator('tr[data-material]').evaluateAll((fs) => fs.map((f) => f.getAttribute('data-material')))
  comprobar(conCodigo.length === 2 && conCodigo.includes(M.faro.codigo) && conCodigo.includes(M.guantes.codigo),
    `buscar el código B encuentra el faro que entró para esa unidad y los guantes que le separó su RQ (${conCodigo.join(', ')})`)
  await ir(pagina, '/almacen/stock?almacen=ACCESORIOS')
  const soloAcc = await pagina.locator('[data-almacen]').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-almacen')))
  comprobar(soloAcc.length === 1 && soloAcc[0] === 'ACCESORIOS', 'la pastilla Accesorios deja solo ese almacén')

  await ir(pagina, '/almacen/kardex')
  comprobar(pagina.url().includes('/sin-permiso'), 'el kardex le sigue cerrado')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()

  const telefono = await entrar(CUENTAS.supervisor, 390)
  // Sin el número del aviso que lleva al lado («1Reporte»).
  const tabs = (await pestanas(telefono.pagina)).map((t) => t?.replace(/^\d+/, ''))
  console.log('    pestañas del teléfono:', tabs.join(' · '))
  // Desde el 2026-10-20 (orden de DKS) las cuatro de abajo son Reporte, Planos,
  // Subcontratos y RQ; el stock queda en «Más», después de sus requerimientos.
  comprobar(tabs.join('|') === 'Reporte|Planos|Subcontratos|RQ', 'en el teléfono: Reporte, Planos, Subcontratos y RQ (el stock, en «Más»)')
  await ir(telefono.pagina, '/almacen/stock')
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `la pantalla entra en el teléfono sin correrse de costado (${ancho} px)`)
  await telefono.pagina.screenshot({ path: `${CAPTURAS}/stock-telefono.png`, fullPage: true })
  await telefono.contexto.close()
}

// ============================================ 2. El supervisor despliega los insumos del RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.supervisor)
  await ir(pagina, '/requerimientos')
  const numeros = async () => pagina.locator('[data-insumos]').evaluateAll((ds) => ds.map((d) => d.getAttribute('data-insumos')))
  const deSuArea = await numeros()
  console.log('    de su área:', deSuArea.join(' · '))
  comprobar(deSuArea.includes(N.a1) && deSuArea.includes(N.b2) && !deSuArea.includes(N.b1),
    've primero los RQ de Maestranza, sin el de Producción')

  const rq1 = pagina.locator(`[data-insumos="${N.a1}"]`)
  comprobar(await rq1.evaluate((d) => d.open), 'el RQ en camino llega desplegado')
  const resumen = await texto(rq1.locator('summary'))
  console.log('    arriba:', resumen)
  comprobar(resumen.includes('3 insumos'), 'arriba dice cuántos insumos lleva')
  comprobar(await rq1.locator('li[data-insumo]').first().isVisible(), 'los insumos se ven sin presionar')
  const insumo = async (n) => texto(rq1.locator(`li[data-insumo="${n}"]`))
  const [i1, i2, i3] = [await insumo(1), await insumo(2), await insumo(3)]
  console.log('    1:', i1)
  console.log('    2:', i2)
  console.log('    3:', i3)
  comprobar(i1.includes('Disco de corte') && i1.includes('para recoger en Almacén') && !/faltan? de/.test(i1), 'el disco se recoge entero en Almacén')
  comprobar(i2.includes('Plancha') && i2.includes('12 UND para recoger en Almacén') && i2.includes('8 UND faltan de Logística') && i2.includes('Por comprar'),
    'la plancha: 12 para recoger en Almacén y 8 que faltan de Logística, por comprar')
  comprobar(i3.includes('Faro') && /faltan? de Logística/.test(i3) && /OC-\d+/.test(i3) && !i3.includes('para recoger'), 'el faro falta entero, con su OC')
  await pagina.screenshot({ path: `${CAPTURAS}/rq-desplegado.png`, fullPage: true })
  const cerrado = await resumenCerrado(rq1)
  comprobar(cerrado.includes('2 para recoger') && cerrado.includes('2 por llegar'),
    `cerrado, dice cuántos se pueden recoger en Almacén y cuántos faltan que lleguen («${cerrado}»)`)

  const rq3 = await resumenCerrado(pagina.locator(`[data-insumos="${N.b2}"]`))
  comprobar(rq3.includes('2 por revisar'), 'el RQ que Almacén no revisa dice «por revisar»')

  await pagina.getByRole('link', { name: /Todas las áreas/ }).click()
  await pagina.waitForURL(/area=todas/)
  await pagina.waitForLoadState('networkidle')
  const todas = await numeros()
  comprobar([N.a1, N.b1, N.b2].every((n) => todas.includes(n)), 'con «Todas las áreas» ve también el de Producción')
  const rq2 = await resumenCerrado(pagina.locator(`[data-insumos="${N.b1}"]`))
  comprobar(rq2.includes('1 para recoger'), 'el de Producción está listo para recoger en Almacén')

  await pagina.locator(`[data-rq="${N.b1}"]`).getByRole('link', { name: CODIGO_B }).click()
  await pagina.waitForURL((u) => u.searchParams.get('codigo')?.toUpperCase() === CODIGO_B)
  await pagina.waitForLoadState('networkidle')
  const delCodigo = await numeros()
  comprobar(delCodigo.length === 2 && delCodigo.includes(N.b1) && delCodigo.includes(N.b2),
    'al presionar el código interno ve solo los RQ de ese código')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 3. Requerimientos los ve abiertos y, desde el 2026-10-20, entra al stock
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, '/requerimientos')
  const abiertos = await Promise.all([N.a1, N.b1, N.b2].map((n) => pagina.locator(`[data-insumos="${n}"]`).evaluate((d) => d.open).catch(() => false)))
  comprobar(abiertos.every(Boolean), 'Requerimientos los ve desplegados, como siempre')
  await ir(pagina, '/almacen/stock')
  comprobar((await texto(pagina.locator('h1'))) === 'Stock en almacén', 'Requerimientos entra al stock (migración 20261020195000)')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 4. Almacén lo abre con su kardex a mano
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/almacen/stock')
  comprobar((await texto(pagina.locator('h1'))) === 'Stock en almacén', 'Almacén abre el stock')
  comprobar((await pagina.getByRole('link', { name: 'Abrir el kardex' }).count()) === 1, 'con el enlace a su kardex')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)

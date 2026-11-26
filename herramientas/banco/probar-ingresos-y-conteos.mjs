/**
 * Clic real sobre el plan 2, entrega 2.3, en el kardex. Con la cuenta de cada
 * puesto, nunca ADMIN:
 *
 *   1. Almacén ve cada ingreso por validar con su OC, quién lo dejó y los días
 *      que lleva esperando (los cuenta la base con la fecha de Lima), el que más
 *      espera arriba.
 *   2. Ve los últimos conteos físicos con lo que contó, lo que decía el sistema,
 *      la diferencia, quién contó y cuándo. En metros sin decimales de más.
 *   3. Elegido un material, su ficha trae solo sus conteos.
 *   4. En el teléfono (390 px) cada conteo es una ficha y nada se sale.
 *   5. Gerencia consulta lo mismo sin botones.
 *
 * Siembra con las funciones de la base y la sesión de cada puesto: dos compras
 * directas que el conductor deja en almacén (una se deja «hace 3 días», corrida
 * a mano porque la ruta del conductor tiene su propia prueba) y dos conteos.
 * Las compras quedan por validar: no se borran (un documento numerado no se
 * borra) y Almacén las valida al probar lo suyo.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_CHROMIUM.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  almacen: 'almacen.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  conductor: 'conductor.local@metalwork.test',
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
  values ($1, $2, ${consumible}, ${unidad('UND')}) returning id::text`, [`PRB-E23-${sufijo}`, `Disco de desbaste ${sufijo}`])
const [platina] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, ${consumible}, ${unidad('M')}) returning id::text`, [`PRB-E23M-${sufijo}`, `Platina de 1" en metros ${sufijo}`])
for (const [m, n] of [[disco.id, 20], [platina.id, 10]]) {
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
    select gen_random_uuid(), 'INGRESO', $1::uuid, $4, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $3`,
    [m, `GR BANCO E23 ${sufijo}`, CUENTAS.almacen, n])
}
// Los conteos: faltaron 3 discos y sobraron 0.3 m de platina.
await como(CUENTAS.almacen, `select public.registrar_conteo_almacen(gen_random_uuid(), $1, 17, 'Conteo del banco: faltaron tres discos en el estante')`, [disco.id])
await como(CUENTAS.almacen, `select public.registrar_conteo_almacen(gen_random_uuid(), $1, 10.3, 'Conteo del banco: sobró un retazo de platina')`, [platina.id])
const [{ nombre: contador }] = await consulta(`select btrim(concat_ws(' ', nombres, apellidos)) as nombre from public.usuarios where correo = $1`, [CUENTAS.almacen])

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
const compras = []
for (const [i, material] of [disco.id, platina.id].entries()) {
  const [{ id }] = await como(CUENTAS.logistica,
    `select public.emitir_compra_directa(gen_random_uuid(), $1, $2, 'Reposición del almacén, prueba de la entrega 2.3', $3::jsonb,
                                         current_date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
    [prov.id, `COT-E23-${sufijo}-${i + 1}`, JSON.stringify([{ material_id: material, cantidad: 2, precio: 50 }])])
  compras.push(id)
}
for (const id of compras) {
  const [{ aprobacion }] = await consulta('select aprobacion from public.ordenes_compra_materiales where id = $1', [id])
  if (aprobacion !== 'APROBADA' && aprobacion !== 'NO_REQUIERE') await como(CUENTAS.gerencia, 'select public.aprobar_compra($1)', [id])
  await como(CUENTAS.logistica, 'select public.programar_recojo($1, $2)', [id, 10])
  await como(CUENTAS.conductor, 'select public.marcar_compra_en_recojo($1)', [id])
  await como(CUENTAS.conductor, 'select public.marcar_compra_recogida($1)', [id])
  await como(CUENTAS.conductor, 'select public.marcar_compra_dejada_almacen($1)', [id])
}
// La segunda se dejó hace 3 días: se corre la hora sin disparadores.
await base.query('begin')
await base.query('set local session_replication_role = replica')
await consulta(`update public.ordenes_compra_materiales set dejado_en = dejado_en - interval '3 days' where id = $1`, [compras[1]])
await consulta(`update public.ingresos_pendientes_almacen set dejado_en = dejado_en - interval '3 days' where orden_compra_id = $1`, [compras[1]])
await base.query('commit')
const numeros = Object.fromEntries((await consulta('select id::text, numero from public.ordenes_compra_materiales where id = any($1)', [compras])).map((f) => [f.id, f.numero]))
const [nueva, vieja] = compras.map((id) => numeros[id])
console.log(`    sembradas: ${vieja} dejada hace 3 días, ${nueva} dejada hoy; conteos de ${disco.id} y ${platina.id}`)

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
const bloque = (pagina, oc) => pagina.locator('#por-validar form', { hasText: oc })
const filaConteo = (pagina, codigo) => pagina.locator('#conteos tbody tr', { hasText: codigo })
/** Los conteos vienen plegados: se abren como lo haría la persona, tocando su título. */
async function abrirConteos(pagina) {
  const seccion = pagina.locator('details#conteos')
  if (!(await seccion.evaluate((d) => d.open))) await seccion.locator('summary').click()
  return seccion
}

// ============================================ 1 a 3. Almacén, en el monitor
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/almacen/kardex')
  const diasVieja = await bloque(pagina, vieja).locator('[data-dias-en-espera]').getAttribute('data-dias-en-espera').catch(() => null)
  const diasNueva = await bloque(pagina, nueva).locator('[data-dias-en-espera]').getAttribute('data-dias-en-espera').catch(() => null)
  comprobar(diasVieja === '3' && diasNueva === '0', `los días que esperan: ${vieja} ${diasVieja}, ${nueva} ${diasNueva}`)
  comprobar((await texto(bloque(pagina, vieja).locator('[data-dias-en-espera]'))).includes('hace 3 días'), 'dice «hace 3 días»')
  const cabecera = await texto(bloque(pagina, vieja).locator('h3 + *, h3').first())
  comprobar(cabecera.includes(vieja), `con su OC: «${cabecera}»`)
  comprobar((await texto(bloque(pagina, vieja))).includes(' por '), 'y quién la dejó')
  const esperada = new Date(Date.now() + 5 * 864e5).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' })
  comprobar((await texto(bloque(pagina, vieja))).includes(`se esperaba el ${esperada}`), `con la fecha esperada de su OC (${esperada}), sin precios`)
  comprobar(!/S\/\s?\d|\bPEN\b|precio/i.test(await texto(pagina.locator('#por-validar'))), 'la bandeja no muestra precios')
  const plegada = pagina.locator('details#conteos')
  comprobar(!(await plegada.evaluate((d) => d.open)), `los conteos vienen plegados: «${await texto(plegada.locator('summary'))}»`)
  comprobar(/con diferencia · el último el/.test(await texto(plegada.locator('summary'))), 'y el resumen dice cuántos tienen diferencia y el último')
  await abrirConteos(pagina)
  const orden = await pagina.locator('#por-validar form h3').allInnerTexts()
  const iVieja = orden.findIndex((t) => t.includes(vieja))
  const iNueva = orden.findIndex((t) => t.includes(nueva))
  comprobar(iVieja >= 0 && iVieja < iNueva, `la que más espera va arriba (${iVieja} antes que ${iNueva})`)

  const d = filaConteo(pagina, `PRB-E23-${sufijo}`)
  const t = await texto(d).catch(() => '')
  const celda = async (fila, rotulo) => texto(fila.locator(`[data-rotulo="${rotulo}"]`))
  comprobar((await d.count()) === 1 && (await celda(d, 'Contado')) === '17 UND', `el conteo del disco: «${t}»`)
  comprobar((await d.locator('[data-diferencia]').getAttribute('data-diferencia')) === '-3', 'con la diferencia −3')
  comprobar((await celda(d, 'El sistema decía')) === '20 UND' && t.includes(`Contó ${contador}`), `lo que decía el sistema (20) y quién contó (${contador})`)
  const p = filaConteo(pagina, `PRB-E23M-${sufijo}`)
  comprobar((await p.locator('[data-diferencia]').getAttribute('data-diferencia')) === '0.3' && (await celda(p, 'Contado')) === '10.3 M' && (await celda(p, 'El sistema decía')) === '10 M',
    `la platina en metros, sin decimales de más: «${await texto(p)}»`)
  await pagina.locator('#por-validar').scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '2-3-almacen-1440-por-validar.png') })
  await pagina.locator('#conteos').scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '2-3-almacen-1440-conteos.png') })

  await ir(pagina, `/almacen/kardex?material=${disco.id}`)
  const ficha = await abrirConteos(pagina)
  comprobar((await texto(ficha.locator('summary'))).includes('Conteos físicos de este material'), 'la ficha del material trae sus conteos')
  comprobar((await ficha.locator('tbody tr').count()) === 1 && !(await texto(ficha)).includes(`PRB-E23M-${sufijo}`), 'solo los suyos')
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 4. Almacén, en el teléfono
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen, 390)
  await ir(pagina, '/almacen/kardex')
  // Plegados miden lo que su título: no empujan el tablero ni los filtros, por muchos que sean.
  const alto = await pagina.locator('details#conteos').evaluate((e) => e.getBoundingClientRect().height)
  comprobar(alto < 120, `los conteos plegados no empujan la consulta (miden ${Math.round(alto)} px)`)
  await abrirConteos(pagina)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `a 390 px nada se sale (${ancho} px)`)
  const caja = await filaConteo(pagina, `PRB-E23-${sufijo}`).boundingBox()
  comprobar(caja !== null && caja.x >= 0 && caja.x + caja.width <= 390, `el conteo es una ficha dentro de la pantalla (${JSON.stringify(caja)})`)
  await bloque(pagina, vieja).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '2-3-almacen-390-por-validar.png') })
  await filaConteo(pagina, `PRB-E23-${sufijo}`).scrollIntoViewIfNeeded()
  await pagina.evaluate(() => window.scrollBy(0, -200))
  await pagina.screenshot({ path: join(CAPTURAS, '2-3-almacen-390-conteos.png') })
  comprobar(errores.length === 0, `sin errores de consola en el teléfono ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 5. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await ir(pagina, '/almacen/kardex')
  await abrirConteos(pagina)
  comprobar((await filaConteo(pagina, `PRB-E23-${sufijo}`).count()) === 1, 'Gerencia ve los conteos')
  comprobar((await pagina.getByRole('button', { name: /Validar/ }).count()) === 0, 'y no valida nada')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobaciones fallaron.`)
  process.exit(1)
}
console.log('\nTodo pasa.')

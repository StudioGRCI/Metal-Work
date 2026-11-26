/**
 * Clic real sobre el plan 2, entrega 2.2: la conformidad de cada salida. Con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Requerimientos, que registró el RQ, ve en la tarjeta las dos salidas del
 *      insumo con cuánto, cuándo y quién recibió; la que tiene foto la abre.
 *      Anota «llegó incompleto»: con lo mismo que salió la base lo rechaza y lo
 *      escrito se queda; con menos entra una sola vez aunque toque tres veces.
 *   2. El supervisor del área que pidió (sup.prd), en el teléfono, ve la nota y
 *      anota «no llegó» en la otra salida. El de otra área (sup.mtz) no anota.
 *   3. Almacén ve las dos notas abiertas arriba de Atención, con su aviso en la
 *      campana, y responde una: queda quién y cuándo, y no puede anotar.
 *   4. Quien la anotó ve la respuesta y le llega el aviso.
 *   5. Ventas no entra a la lista ni abre la foto.
 *
 * Siembra con las funciones de la base y la sesión de cada puesto: un RQ de
 * Producción que Almacén revisa con todo en stock y dos salidas del kardex
 * contra su insumo, cada una con su foto. El RQ y las salidas quedan: son documentos
 * numerados y no se borran.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_CHROMIUM, BANCO_ARCHIVOS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const CUENTAS = {
  requerimientos: 'requerimientos.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  supervisor: 'sup.prd.local@metalwork.test',
  otroSupervisor: 'sup.mtz.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
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
const [disco] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, ${consumible}, (select id from public.unidades_medida where codigo = 'UND')) returning id::text`,
  [`PRB-E22-${sufijo}`, `Disco de corte 7" ${sufijo}`])
await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', $1::uuid, 20, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $3`,
  [disco.id, `GR BANCO E22 ${sufijo}`, CUENTAS.almacen])
const [{ id: area }] = await consulta(`select id::text from public.areas where codigo = 'PRD'`)
const rq = crypto.randomUUID()
const codigo = `BANCO-E22${sufijo}`
await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba de la conformidad de la entrega', null, $4::jsonb)`,
  [rq, area, codigo, JSON.stringify([{ material_id: disco.id, cantidad: 6 }])])
const [{ numero: N }] = await consulta('select numero from public.requerimientos where id = $1', [rq])
const [{ id: linea }] = await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 1', [rq])
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 6}]', null)`, [rq])

/** Una salida del kardex con su RQ, como la registra Almacén: con la foto en Storage, que la base exige. */
async function salida(cantidad, recibe, conFoto) {
  const id = crypto.randomUUID()
  let ruta = null
  if (conFoto) {
    const [{ id: yo }] = await consulta('select id::text from public.usuarios where correo = $1', [CUENTAS.almacen])
    ruta = `${yo}/${id}.jpg`
    mkdirSync(join(ARCHIVOS, 'evidencias-almacen', yo), { recursive: true })
    const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
    writeFileSync(join(ARCHIVOS, 'evidencias-almacen', ruta), jpg)
    await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
      values ('evidencias-almacen', $1, $2::uuid, $2, jsonb_build_object('size', $3::int, 'mimetype', 'image/jpeg'))`, [ruta, yo, jpg.length])
  }
  await como(CUENTAS.almacen, `select public.registrar_salida_material($1, $2, $3, null, $4, 'Vale del banco E22', $5, $6, $7)`,
    [id, disco.id, cantidad, codigo, recibe, ruta, linea])
  const [{ numero }] = await consulta('select numero_salida as numero from public.movimientos_materiales where id = $1', [id])
  return { id, numero: numero ?? id }
}
const conFoto = await salida(4, 'Soldador de Producción', true)
const otra = await salida(2, 'Armador de Producción', true)
console.log(`    sembrado: ${N} (6 UND), salidas ${conFoto.numero} (4) y ${otra.numero} (2), con su foto`)
const notasDe = async (mov) => consulta('select tipo, cantidad_recibida::float as recibido, atendido_en, atendido_por::text from public.conformidad_salidas where movimiento_id = $1', [mov])
const avisos = async (correo, titulo) =>
  Number((await consulta(`select count(*) from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
                           where u.correo = $1 and n.titulo = $2`, [correo, titulo]))[0].count)

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
const tarjeta = (pagina) => pagina.locator(`[data-rq="${N}"]`)
const laSalida = (pagina, s) => tarjeta(pagina).locator(`[data-salida="${s.numero}"]`)
const ventana = (pagina) => pagina.getByRole('dialog')

// ============================================ 1. Requerimientos, que registró el RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `/requerimientos?rq=${rq}`)
  comprobar((await tarjeta(pagina).locator('[data-salida]').count()) === 2, 'la tarjeta muestra las dos salidas del insumo')
  const t1 = await texto(laSalida(pagina, conFoto))
  comprobar(t1.includes('4 UND') && t1.includes('Soldador de Producción'), `con cuánto salió y quién recibió: «${t1}»`)
  comprobar(!/S\/\s?\d|\bPEN\b|precio/i.test(await texto(tarjeta(pagina))), 'sin precios')
  comprobar((await tarjeta(pagina).locator('[data-ver-foto]').count()) === 2, 'cada salida ofrece «Ver foto»')
  const foto = await pagina.request.get(`${BASE}/requerimientos/salidas/${conFoto.id}/foto`)
  const jpg = await foto.body()
  comprobar(foto.status() === 200 && jpg[0] === 0xff && jpg[1] === 0xd8 && (foto.headers()['content-type'] ?? '').startsWith('image/'),
    `la foto se abre con la sesión de quien pidió (${foto.status()} ${foto.headers()['content-type']}, ${jpg.length} bytes)`)

  // «Llegó incompleto» con lo mismo que salió: lo rechaza la base y lo escrito se queda.
  await laSalida(pagina, conFoto).locator('[data-anotar-conformidad]').click()
  await ventana(pagina).getByLabel('Llegó incompleto').check()
  await ventana(pagina).getByLabel(/¿Cuánto llegó\?/).fill('4')
  await ventana(pagina).getByLabel('Nota para Almacén').fill('Llegaron tres discos, faltó uno en la caja')
  await ventana(pagina).locator('input[name="recibido"]').evaluate((e) => e.removeAttribute('max'))
  await ventana(pagina).getByRole('button', { name: 'Anotar' }).click()
  const rechazo = ventana(pagina).getByRole('alert')
  await rechazo.filter({ hasText: /\S/ }).waitFor({ timeout: 30000 }).catch(() => {})
  comprobar((await texto(rechazo)).length > 0, `con lo mismo que salió lo rechaza: «${await texto(rechazo)}»`)
  comprobar((await ventana(pagina).getByLabel('Nota para Almacén').inputValue()).startsWith('Llegaron tres'), 'y lo escrito se queda')
  comprobar((await notasDe(conFoto.id)).length === 0, 'sin anotar nada')

  // Con menos entra, una sola vez aunque se toque tres veces.
  await ventana(pagina).getByLabel(/¿Cuánto llegó\?/).fill('3')
  const enviar = ventana(pagina).getByRole('button', { name: 'Anotar' })
  // Los tres en el mismo instante, antes de que React alcance a trabar el botón.
  await enviar.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
  await ventana(pagina).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const notas1 = await notasDe(conFoto.id)
  comprobar(notas1.length === 1 && notas1[0].tipo === 'LLEGO_INCOMPLETO' && notas1[0].recibido === 3, `tres toques, una nota: ${JSON.stringify(notas1)}`)
  comprobar((await avisos(CUENTAS.almacen, `Llegó incompleto: ${N}`)) === 1, 'a Almacén le llega el aviso')
  const nota = laSalida(pagina, conFoto).locator('[data-nota-conformidad="abierta"]')
  await nota.waitFor({ timeout: 30000 }).catch(() => {})
  comprobar((await texto(nota)).includes('Llegó 3 de 4 UND') && (await texto(nota)).includes('Almacén todavía no responde'), `la tarjeta dice la nota: «${await texto(nota).catch(() => '')}»`)
  comprobar((await laSalida(pagina, conFoto).locator('[data-anotar-conformidad]').count()) === 0, 'con la nota abierta no ofrece anotar otra')
  await laSalida(pagina, conFoto).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '2-2-requerimientos-1440-nota.png') })
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 2. El supervisor del área, en el teléfono
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.supervisor, 390)
  await ir(pagina, `/requerimientos?rq=${rq}`)
  comprobar((await laSalida(pagina, conFoto).locator('[data-nota-conformidad="abierta"]').count()) === 1, 'el supervisor del área ve la nota de Requerimientos')
  await laSalida(pagina, otra).locator('[data-anotar-conformidad]').click()
  await ventana(pagina).getByLabel('Nota para Almacén').fill('No llegó nada al área de Producción')
  await ventana(pagina).getByRole('button', { name: 'Anotar' }).click()
  await ventana(pagina).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const notas2 = await notasDe(otra.id)
  comprobar(notas2.length === 1 && notas2[0].tipo === 'NO_LLEGO', `anota «no llegó» en la otra salida: ${JSON.stringify(notas2)}`)
  await laSalida(pagina, otra).locator('[data-nota-conformidad]').waitFor({ timeout: 30000 }).catch(() => {})
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `a 390 px nada se sale (${ancho} px)`)
  await laSalida(pagina, conFoto).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '2-2-supervisor-390-salidas.png') })
  await laSalida(pagina, conFoto).locator('[data-anotar-conformidad]').count()
  comprobar(errores.length === 0, `sin errores de consola como supervisor ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.otroSupervisor)
  await ir(pagina, `/requerimientos?rq=${rq}&area=todas`)
  const salidas = await tarjeta(pagina).locator('[data-salida]').count()
  comprobar((await tarjeta(pagina).locator('[data-anotar-conformidad]').count()) === 0, `el supervisor de otra área ve las salidas (${salidas}) y no anota`)
  await contexto.close()
}

// ============================================ 3. Almacén responde
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/requerimientos/atencion')
  const tarjetaNotas = pagina.locator('[data-notas-de-entregas]')
  comprobar((await tarjetaNotas.count()) === 1, 'Atención muestra las notas de las entregas')
  const titulo = await texto(tarjetaNotas.locator('h2'))
  comprobar(/· \d+ abiertas?/.test(titulo), `con cuántas abiertas: «${titulo}»`)
  const arriba = await pagina.evaluate(() => {
    const n = document.querySelector('[data-notas-de-entregas]')
    const t = document.querySelector('table')
    return n && t ? n.getBoundingClientRect().top < t.getBoundingClientRect().top : false
  })
  comprobar(arriba, 'arriba de la lista de requerimientos')
  const filas = tarjetaNotas.locator('li', { hasText: N })
  comprobar((await filas.count()) === 2, `las dos notas del ${N}`)
  const fila = tarjetaNotas.locator('li', { hasText: 'Llegó 3 de 4 UND' }).filter({ hasText: N })
  comprobar((await fila.locator('[data-dias-en-espera]').count()) === 1, 'cada una con los días que espera a Almacén')
  await pagina.screenshot({ path: join(CAPTURAS, '2-2-almacen-1440-notas.png') })
  await fila.getByRole('button', { name: 'Responder' }).click()
  await ventana(pagina).getByLabel('Qué hiciste').fill('Repuse el disco que faltó con otra salida del vale')
  await ventana(pagina).getByRole('button', { name: 'Cerrar la nota' }).click()
  await ventana(pagina).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const [cerrada] = await notasDe(conFoto.id)
  const [{ id: yo }] = await consulta('select id::text from public.usuarios where correo = $1', [CUENTAS.almacen])
  comprobar(cerrada?.atendido_en && cerrada.atendido_por === yo, 'la nota queda cerrada por Almacén, con quién y cuándo')
  // La pantalla se pone al día sola después del envío; se espera a que lo haga.
  const quedan = async () => tarjetaNotas.locator('li', { hasText: N }).count()
  for (let i = 0; i < 30 && (await quedan()) !== 1; i++) await pagina.waitForTimeout(500)
  comprobar((await quedan()) === 1, `y sale de las abiertas (quedan ${await quedan()} del ${N})`)
  await ir(pagina, `/requerimientos?rq=${rq}`)
  comprobar((await tarjeta(pagina).locator('[data-anotar-conformidad]').count()) === 0, 'Almacén no anota la conformidad de lo que entregó')
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen, 390)
  await ir(pagina, '/requerimientos/atencion')
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `Atención a 390 px no se sale (${ancho} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, '2-2-almacen-390-notas.png') })
  comprobar(errores.length === 0, `sin errores de consola en el teléfono ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 4. Quien la anotó ve la respuesta
{
  comprobar((await avisos(CUENTAS.requerimientos, `Almacén respondió: ${N}`)) === 1, 'a quien la anotó le llega el aviso')
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `/requerimientos?rq=${rq}`)
  const cerrada = laSalida(pagina, conFoto).locator('[data-nota-conformidad="cerrada"]')
  comprobar((await texto(cerrada).catch(() => '')).includes('Almacén respondió: Repuse el disco'), `ve la respuesta: «${await texto(cerrada).catch(() => '')}»`)
  comprobar((await laSalida(pagina, conFoto).locator('[data-anotar-conformidad]').count()) === 1, 'cerrada, puede anotar otra si hace falta')
  await laSalida(pagina, conFoto).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '2-2-requerimientos-1440-respondida.png') })
  comprobar(errores.length === 0, `sin errores de consola al volver ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 5. Ventas no entra
{
  const { pagina, contexto } = await entrar(CUENTAS.ventas)
  await ir(pagina, `/requerimientos?rq=${rq}`)
  comprobar((await tarjeta(pagina).count()) === 0, `Ventas no ve el RQ (${new URL(pagina.url()).pathname})`)
  const foto = await pagina.request.get(`${BASE}/requerimientos/salidas/${conFoto.id}/foto`, { maxRedirects: 0 })
  comprobar(foto.status() !== 200, `ni abre la foto (${foto.status()})`)
  await contexto.close()
}

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobaciones fallaron.`)
  process.exit(1)
}
console.log('\nTodo pasa.')

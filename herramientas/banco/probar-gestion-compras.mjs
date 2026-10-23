/**
 * Clic real sobre la gestión de compras (migración 20261015140000), con la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El conductor ve las OC aprobadas solo como un aviso, sin botón: hasta
 *      que Logística las programe no sale a recogerlas. La gestión la abre por
 *      su dirección, sin los controles de Logística.
 *   2. Logística, en «Gestión de compras», pone el peso y el lugar de dos OC
 *      (con coma decimal, como sale en el teléfono), rechaza un peso de cero
 *      y baja una de lugar con la flecha.
 *   3. Contabilidad ya no tiene la gestión (migración 20261020171000): carga
 *      la guía de remisión en PDF de la primera desde su fila en Adquisiciones;
 *      un archivo que no es PDF no entra.
 *   4. Con la guía, Logística ya no puede cambiar el peso.
 *   5. El conductor ve su lista en el orden de Logística, con el peso y la
 *      guía (el enlace abre el PDF), y sale a recoger la primera.
 *   6. Contabilidad anula la guía con motivo desde Adquisiciones: al conductor
 *      le vuelve a decir que falta, y la anulada queda contada.
 *
 *   7. Logística saca la segunda de la lista con «Sacar de la lista»: vuelve
 *      a «Por programar».
 *
 * Siembra sus tres OC aprobadas (Logística las emite y Gerencia las aprueba,
 * con las funciones de la base) y las sigue por su número. Necesita la lista
 * del conductor sin pendientes: las que ya estaban en ella las saca Logística
 * al empezar, con la misma función que «Sacar de la lista», y al terminar saca
 * la suya y las devuelve en su orden y con su peso, también si la prueba se cae
 * a medio camino: en un banco compartido son de otro. Las que van en recojo o
 * ya recogidas no se tocan: no llevan lugar y la prueba solo mira las que lo
 * llevan.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE y los
 * correos de cada cuenta si no son las `*.local@metalwork.test` que siembra
 * `preparar.sh`.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'contabilidad', 'conductor', 'gerencia'].map((p) => [p, cuenta(p)]))
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

const CONEXION = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
}
const base = new pg.Client(CONEXION)
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)
/** Lo que hace la sesión de esa cuenta: los disparadores y las funciones leen el usuario de aquí. */
async function como(puesto, en = consulta) {
  const sub = ids[CUENTAS[puesto]]
  await en(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                  set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
/**
 * Lo que se hace como Logística para dejar la lista como estaba, en una
 * conexión propia: la del flujo principal cambia de cuenta y vacía la sesión, y
 * una señal que llegaba en medio dejaba a `programar_recojo` sin usuario y las
 * de antes fuera de la lista (vigésima pasada).
 */
async function comoLogistica(trabajo) {
  const propia = new pg.Client(CONEXION)
  await propia.connect()
  try {
    const en = async (sql, valores = []) => (await propia.query(sql, valores)).rows
    await como('logistica', en)
    return await trabajo(en)
  } finally {
    await propia.end().catch(() => {})
  }
}

let ruc
while (!ruc) {
  const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  ;[ruc] = await consulta(
    `select n from (select $1 || d as n from generate_series(0, 9) d) x
      where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
    [prefijo],
  )
}
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 789, Lima', '999 000 333') returning id`,
  [ruc.n, `PROVEEDOR GESTION ${SUFIJO}`],
)
const [material] = await consulta(`select id from materiales where activo and not coalesce(unidad_pendiente, false) order by codigo limit 1`)
if (!material) throw new Error('El banco no tiene materiales.')
await como('logistica')
const sembradas = []
for (let i = 1; i <= 3; i++) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_directa(gen_random_uuid(), $1, $2, 'Reposición del almacén, prueba de la gestión', $3::jsonb,
                                         current_date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
    [proveedor, `COT-GES-${SUFIJO}-${i}`, JSON.stringify([{ material_id: material.id, cantidad: 2, precio: 80 }])],
  )
  sembradas.push(id)
}
await como('gerencia')
for (const id of sembradas) await consulta(`select public.aprobar_compra($1)`, [id])
const porId = Object.fromEntries((await consulta(`select id, numero from ordenes_compra_materiales where id = any($1)`, [sembradas])).map((f) => [f.id, f.numero]))
const [ocA, ocB, ocC] = sembradas.map((id) => porId[id])
const idDe = Object.fromEntries(sembradas.map((id) => [porId[id], id]))

// La lista sin pendientes de antes: Logística las saca, como con «Sacar de la lista», y
// al terminar las devuelve en su orden y con su peso (`devolverLasDeAntes`).
await como('logistica')
const dejadas = await consulta(
  `select c.id, c.numero, p.peso_kg from programacion_recojo p join ordenes_compra_materiales c on c.id = p.orden_compra_id
    where p.posicion is not null and c.recojo = 'POR_RECOGER' order by p.posicion`,
)
let devolviendo = null
/**
 * Las de antes vuelven al final de la lista en el orden en que estaban: «Poner
 * en la lista» con su peso. Una sola vez, y quien llegue después espera a esa:
 * una señal a mitad de la devolución cortaba el bucle con `process.exit` y
 * volvía una de cuatro (decimonovena pasada).
 */
function devolverLasDeAntes() {
  devolviendo ??= comoLogistica(async (en) => {
    for (const d of dejadas) {
      await en(
        `select public.programar_recojo(c.id, $2) from ordenes_compra_materiales c join programacion_recojo p on p.orden_compra_id = c.id
          where c.id = $1 and c.recojo = 'POR_RECOGER' and p.posicion is null`,
        [d.id, d.peso_kg],
      )
    }
  })
  return devolviendo
}
/**
 * Las suyas fuera de la lista: la siguiente vuelta las tomaría por ajenas y las
 * devolvería para siempre. La que ya salió a recogerla no lleva lugar.
 */
function sacarLasSuyas() {
  return comoLogistica((en) =>
    en(
      `select public.quitar_recojo_de_la_lista(c.id) from ordenes_compra_materiales c join programacion_recojo p on p.orden_compra_id = c.id
        where c.id = any($1) and c.recojo = 'POR_RECOGER' and p.posicion is not null`,
      [sembradas],
    ),
  )
}
// Si la prueba se cae a medio camino, o la cortan (Ctrl+C, `timeout`), la lista
// no se queda sin las de antes ni con las suyas: `uncaughtException` no ve las
// señales, y con `timeout` las de otros no volvían (decimoctava pasada). Se
// arma antes de sacar las de antes: una señal en ese bucle las dejaba fuera
// (decimonovena pasada). Y espera a que ese bucle termine: devolverlas mientras
// todavía se sacaban dejaba fuera las que salían después (vigésima pasada).
let cayendo = false
let sacando = null
async function caer(motivo) {
  if (cayendo) return
  cayendo = true
  console.error(motivo)
  try {
    await sacando?.catch(() => {})
    await sacarLasSuyas()
    await devolverLasDeAntes()
  } catch (otro) {
    console.error(`No volvieron a la lista ${dejadas.map((d) => d.numero).join(', ')}: ${otro.message}`)
  }
  process.exit(1)
}
process.on('uncaughtException', caer)
process.on('unhandledRejection', caer)
for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => caer(`Cortada con ${senal}.`))
sacando = (async () => {
  for (const d of dejadas) await consulta(`select public.quitar_recojo_de_la_lista($1)`, [d.id])
  await consulta(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)
})()
await sacando
console.log(`Sembradas ${ocA}, ${ocB} y ${ocC}${dejadas.length ? `; salieron de la lista ${dejadas.map((d) => d.numero).join(', ')}` : ''}`)

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

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
/** Las tarjetas de una sección de Gestión de compras, por el id de su título. */
const seccion = (pagina, id) => pagina.locator(`section[aria-labelledby="${id}"] > div`)
const tarjeta = (pagina, id, oc) => seccion(pagina, id).filter({ hasText: oc })
/** Un PDF mínimo, y algo que no lo es aunque se llame .pdf. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n')
const NO_PDF = Buffer.from('esto no es un pdf')
/** Abrir la guía como lo hace el enlace: con la sesión, siguiendo la redirección al PDF firmado. */
async function abrirGuia(contexto, href) {
  const r = await contexto.request.get(`${BASE}${href}`, { maxRedirects: 5 })
  return { estado: r.status(), cabeza: (await r.body()).subarray(0, 5).toString() }
}

let esperanAntes = 0

// ------------------------------------------------ 1. Sin programar, el conductor no sale
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const main = await texto(pagina.locator('main'))
  const espera = main.match(/(\d+) compras? aprobadas? esperan? que Logística/)
  comprobar(espera !== null && Number(espera[1]) >= 3, `el conductor ve cuántas esperan a Logística: «${espera?.[0]}»`)
  esperanAntes = Number(espera?.[1] ?? 0)
  comprobar((await pagina.getByRole('button', { name: 'Salgo a recoger' }).count()) === 0, 'y ningún «Salgo a recoger»')
  comprobar((await pagina.locator('nav a', { hasText: 'Gestión de compras' }).count()) === 0, 'su menú no lleva Gestión de compras: su lista es Recojos')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/compras/gestion', 'por la dirección abre la gestión, para ver qué viene')
  comprobar((await pagina.getByRole('button', { name: /Poner en la lista|Guardar|Sacar de la lista|Cargar guía/ }).count()) === 0, 'sin los controles de Logística')
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 2. Logística programa
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  comprobar((await pagina.locator('nav a', { hasText: 'Gestión de compras' }).count()) >= 1, 'el menú de Logística lleva Gestión de compras')
  comprobar((await pagina.locator('nav a', { hasText: /^Recojos$/ }).count()) === 0, 'y ya no Recojos: la gestión lo muestra todo')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const porProgramar = seccion(pagina, 'titulo-por-programar')
  const numeros = []
  for (const t of await porProgramar.allInnerTexts()) {
    const n = t.match(/OC-\d+-MW/)
    if (n) numeros.push(n[0])
  }
  comprobar([ocA, ocB, ocC].every((n) => numeros.includes(n)), `Por programar trae las OC aprobadas: ${[ocA, ocB, ocC].join(', ')}`)

  // A al final (la primera), con coma decimal.
  let t = tarjeta(pagina, 'titulo-por-programar', ocA)
  await t.locator('input[name="peso"]').fill('350,5')
  await t.getByRole('button', { name: 'Poner en la lista' }).click()
  await tarjeta(pagina, 'titulo-lista', ocA).waitFor({ timeout: 20000 })
  comprobar((await texto(tarjeta(pagina, 'titulo-lista', ocA))).startsWith(`1.º · ${ocA}`), `${ocA} pasa a la lista del conductor como 1.º`)
  comprobar(/350[,.]5 kg/.test(await texto(tarjeta(pagina, 'titulo-lista', ocA))), 'con su peso de 350,5 kg')

  // Un peso de cero no entra.
  t = tarjeta(pagina, 'titulo-por-programar', ocC)
  await t.locator('input[name="peso"]').fill('0')
  await t.getByRole('button', { name: 'Poner en la lista' }).click()
  await t.locator('[role="alert"]').waitFor({ timeout: 20000 })
  comprobar((await t.locator('[role="alert"]').innerText()).includes('Escribe el peso en kilos'), `un peso de cero no entra: «${await t.locator('[role="alert"]').innerText()}»`)

  // B en el primer lugar: A baja al segundo.
  t = tarjeta(pagina, 'titulo-por-programar', ocB)
  await t.locator('input[name="peso"]').fill('120')
  await t.locator('select[name="lugar"]').selectOption('1')
  await t.getByRole('button', { name: 'Poner en la lista' }).click()
  await tarjeta(pagina, 'titulo-lista', ocB).waitFor({ timeout: 20000 })
  let lista = await seccion(pagina, 'titulo-lista').allInnerTexts()
  comprobar(lista[0]?.includes(`1.º · ${ocB}`) && lista[1]?.includes(`2.º · ${ocA}`), `${ocB} entra 1.º y ${ocA} pasa a 2.º`)

  // La flecha: B baja un lugar y A vuelve a ser la primera.
  await tarjeta(pagina, 'titulo-lista', ocB).getByRole('button', { name: `Bajar ${ocB} un lugar` }).click()
  await pagina.waitForFunction(
    ([a]) => document.querySelector('section[aria-labelledby="titulo-lista"] > div')?.textContent?.includes(a),
    [`1.º · ${ocA}`],
    { timeout: 20000 },
  )
  lista = await seccion(pagina, 'titulo-lista').allInnerTexts()
  comprobar(lista[0]?.includes(`1.º · ${ocA}`) && lista[1]?.includes(`2.º · ${ocB}`), `con la flecha ${ocB} baja y ${ocA} vuelve a ser 1.º`)
  // El desplegable de cada una dice su lugar de ahora, no el que tenía: si no,
  // «Guardar» la devolvería al lugar viejo.
  const lugarB = await tarjeta(pagina, 'titulo-lista', ocB).locator('select[name="lugar"]').inputValue()
  const lugarA = await tarjeta(pagina, 'titulo-lista', ocA).locator('select[name="lugar"]').inputValue()
  comprobar(lugarA === '1' && lugarB === '2', `el lugar de cada una se pone al día tras la flecha (${ocA}: ${lugarA}, ${ocB}: ${lugarB})`)
  comprobar((await texto(pagina.locator('main'))).includes('2 en la lista del conductor'), 'el resumen cuenta dos en la lista')
  await pagina.screenshot({ path: `${CAPTURAS}/gestion-logistica.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 3. Contabilidad carga la guía, desde Adquisiciones
let hrefGuia = ''
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.contabilidad)
  const menu = await pagina.locator('nav a').allInnerTexts()
  comprobar(!menu.some((m) => m.includes('Gestión de compras')), 'el menú de Contabilidad ya no lleva Gestión de compras')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), `y por la dirección la rechaza (${new URL(pagina.url()).pathname})`)
  await pagina.goto(`${BASE}/adquisiciones?situacion=guia`, { waitUntil: 'networkidle' })
  const fila = (oc) => pagina.locator(`tbody tr[data-orden="${oc}"]`)
  comprobar((await fila(ocC).count()) === 0, `${ocC}, sin peso, todavía no pide guía`)
  comprobar((await fila(ocA).count()) === 1 && (await fila(ocB).count()) === 1, `${ocA} y ${ocB}, con su peso, la piden`)
  const ventana = pagina.locator('[role="dialog"]')

  // Un archivo que no es PDF no entra, aunque se llame .pdf.
  await fila(ocB).getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.locator('input[name="numero"]').fill('T001-0000999')
  await ventana.locator('input[name="archivo"]').setInputFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: NO_PDF })
  await ventana.getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.locator('[role="alert"]').waitFor({ timeout: 20000 })
  comprobar((await ventana.locator('[role="alert"]').innerText()).includes('Elige el PDF'), `un archivo que no es PDF no entra: «${await ventana.locator('[role="alert"]').innerText()}»`)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()

  // La guía de A, con el número escrito a la ligera: se guarda normalizado.
  await fila(ocA).getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.locator('input[name="numero"]').fill(' t001- 00000123 ')
  await ventana.locator('input[name="archivo"]').setInputFiles({ name: 'guia-a.pdf', mimeType: 'application/pdf', buffer: PDF })
  await ventana.getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(ocA)}`, { waitUntil: 'networkidle' })
  const enlaceGuia = fila(ocA).getByRole('link', { name: /Guía de remisión T001-00000123/ })
  comprobar((await enlaceGuia.count()) === 1, `la guía de ${ocA} queda como T001-00000123`)
  hrefGuia = (await enlaceGuia.getAttribute('href')) ?? ''
  const abierta = await abrirGuia(contexto, hrefGuia)
  comprobar(abierta.estado === 200 && abierta.cabeza === '%PDF-', `Contabilidad abre el PDF de la guía (${abierta.estado}, ${abierta.cabeza})`)
  await pagina.screenshot({ path: `${CAPTURAS}/guia-contabilidad.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 4. Con guía, el peso no cambia
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const t = tarjeta(pagina, 'titulo-lista', ocA)
  comprobar((await t.locator('input[name="peso"]').getAttribute('readonly')) !== null, `con guía, el peso de ${ocA} queda fijo`)
  comprobar((await texto(t)).includes('Ya hay guía con este peso'), 'y la pantalla dice por qué')
  await contexto.close()
}

// ------------------------------------------------ 5. El conductor ve su lista y sale
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.conductor, 390)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const tarjetas = pagina.locator('main section').first().locator('> div')
  // Solo las que llevan lugar: las que van en recojo o ya recogidas van antes, sin lugar.
  const textos = (await tarjetas.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).filter((x) => /^\d+\.º · /.test(x))
  // Lo que el conductor ya lleva encima va primero, y otra sonda pudo dejarle
  // una recogida: las dos de esta se buscan por su número, y el orden lo dice
  // su lugar en la lista.
  const iA = textos.findIndex((x) => x.startsWith(`1.º · ${ocA}`))
  const iB = textos.findIndex((x) => x.startsWith(`2.º · ${ocB}`))
  const [a, b] = [textos[iA] ?? '', textos[iB] ?? '']
  comprobar(iA >= 0 && iB === iA + 1, `en el teléfono, su lista en el orden de Logística: ${textos.map((x) => x.slice(0, 18)).join(' | ')}`)
  comprobar(/Pesa 350[,.]5 kg/.test(a) && /Pesa 120 kg/.test(b), 'cada una con su peso')
  comprobar(a.includes('Guía de remisión T001-00000123 (PDF)'), 'la primera con su guía')
  comprobar(b.includes('Contabilidad todavía no carga la guía de remisión'), 'la segunda dice que falta la guía')
  const quedan = esperanAntes - 2
  const aviso = quedan === 1 ? '1 compra aprobada espera que Logística la programe' : `${quedan} compras aprobadas esperan que Logística`
  comprobar((await texto(pagina.locator('main'))).includes(aviso), `las que no programó siguen solo como aviso: «${aviso}»`)
  const abierta = await abrirGuia(contexto, hrefGuia)
  comprobar(abierta.estado === 200 && abierta.cabeza === '%PDF-', `el conductor abre el PDF de la guía (${abierta.estado}, ${abierta.cabeza})`)
  const primera = tarjetas.filter({ hasText: ocA })
  await primera.getByRole('button', { name: 'Salgo a recoger' }).click()
  await primera.getByRole('button', { name: 'Ya la recogí' }).waitFor({ timeout: 20000 })
  comprobar((await texto(primera)).includes('En recojo'), `sale a recoger ${ocA}: la tarjeta dice «En recojo»`)
  await pagina.screenshot({ path: `${CAPTURAS}/recojos-conductor.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 6. Contabilidad anula la guía, desde Adquisiciones
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(ocA)}`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`tbody tr[data-orden="${ocA}"]`)
  comprobar((await texto(t)).includes('En recojo'), `${ocA} dice que va con el conductor`)
  await t.getByRole('button', { name: 'Anular guía' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('textarea[name="motivo"]').fill('El peso de la guía salió mal escrito')
  await ventana.getByRole('button', { name: 'Anular guía' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  await t.getByRole('button', { name: 'Cargar guía' }).waitFor({ timeout: 20000 })
  comprobar((await texto(t)).includes('Una guía anulada'), 'la anulada queda contada y se puede cargar la buena')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const t = pagina.locator('main section').first().locator('> div').filter({ hasText: ocA })
  comprobar((await texto(t)).includes('Contabilidad todavía no carga la guía de remisión'), 'al conductor le vuelve a decir que falta la guía')
  const abierta = await abrirGuia(contexto, hrefGuia)
  comprobar(abierta.estado === 200 && abierta.cabeza === '%PDF-', `la anulada se sigue pudiendo abrir como evidencia (${abierta.estado})`)
  await contexto.close()
}

// ------------------------------------------------ 7. Logística saca la segunda de la lista
// La deja como la encontró: con una OC en la lista del conductor, la próxima
// vuelta no empieza en «1.º».
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  await tarjeta(pagina, 'titulo-lista', ocB).getByRole('button', { name: 'Sacar de la lista' }).click()
  await pagina.getByRole('button', { name: 'Sí, sacarla' }).click()
  await tarjeta(pagina, 'titulo-por-programar', ocB).waitFor({ timeout: 20000 }).catch(() => {})
  comprobar((await tarjeta(pagina, 'titulo-lista', ocB).count()) === 0 && (await tarjeta(pagina, 'titulo-por-programar', ocB).count()) === 1, `${ocB} sale de la lista y vuelve a Por programar`)
  await contexto.close()
}

await navegador.close()
// Las suyas, fuera de la lista también si el paso 7 no llegó a sacar la
// segunda: la siguiente prueba la encuentra sin pendientes.
await sacarLasSuyas()
await devolverLasDeAntes()
const [{ n: enLaLista }] = await consulta(
  `select count(*)::int as n from programacion_recojo p join ordenes_compra_materiales c on c.id = p.orden_compra_id
    where c.id = any($1) and p.posicion is not null and c.recojo = 'POR_RECOGER'`,
  [dejadas.map((d) => d.id)],
)
comprobar(enLaLista === dejadas.length, `las ${dejadas.length} que ya estaban en la lista vuelven a ella (${enLaLista})`)
await base.end()
console.log(fallas.length === 0 ? `\nTODO EN VERDE (${ocA}, ${ocB}, ${ocC})` : `\n${fallas.length} FALLAS`)
process.exit(fallas.length === 0 ? 0 : 1)

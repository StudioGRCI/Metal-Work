/**
 * Clic real sobre lo que encontraron la decimoséptima y la decimoctava pasada en
 * las ventanas que preguntan a la base si el envío anterior entró
 * (`useIdDelEnvio`), con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Administración, el recibo por honorarios de un subcontrato:
 *      a. el recibo entra y su respuesta se pierde; con «Cancelar» y al volver
 *         a abrir, la ventana dice que aquel quedó, con su número (antes
 *         «Cancelar» empezaba otro y no se preguntaba nada);
 *      b. el siguiente entra desde esa misma ventana;
 *      c. otro se pierde igual y se reenvía con otro monto: dice sin rojo que
 *         ya quedó, traba los campos y solo ofrece «Cerrar» (antes en rojo y
 *         con «Registrar recibo» activo), y queda con el monto de la primera;
 *      d. otro se pierde, «Cancelar» y la página se carga entera —lo que hace
 *         Next si la puesta al día no llega—: al volver a abrir dice que aquel
 *         quedó (antes la memoria se iba y entraba dos veces);
 *      e. a 1440, lo pendiente sigue si vuelve a entrar la misma cuenta y se
 *         olvida si entra otra en la misma pestaña.
 *   2. Administración, el contrato del subcontrato: la respuesta se pierde y
 *      se elige otro archivo; el «ya se subió» va sin rojo y solo con «Cerrar».
 *   3. Logística, el tablero de una OT:
 *      a. «Nueva orden de compra» entra y su respuesta se pierde; «Cancelar» y
 *         la página se carga entera;
 *      b. al volver a abrir dice qué OC quedó y lleva otro id: una sola OC;
 *      c. Gerencia la aprueba y, en «Documentos para Tesorería» de esa OC, el
 *         tipo y el PDF elegidos siguen tras dos puestas al día, con el mismo id;
 *      d. la respuesta del documento se pierde y el reintento va al mismo id y
 *         a la misma ruta: una fila y ningún archivo suelto;
 *      e. otro se pierde y se reenvía con otro tipo: el «ya quedó» no pide
 *         recargar, dice que lo de esta vez no se guardó y queda el primero;
 *      f. el siguiente documento entra con otro id y el cursor queda en su tipo.
 *   4. Tesorería, la planilla: el pago de una persona se pierde y el reintento
 *      dice que ya quedó; al cerrar, el botón «Registrar pago» se rehace y el
 *      cursor va a él (antes caía al contenido de la página).
 *
 * El subcontrato lo registra Administración con las funciones de la base, con
 * un sello nuevo. Para el tablero se siembran dos líneas por comprar de un
 * insumo propio y un proveedor propio en una OT en marcha; para la planilla,
 * una de dos personas y una cuenta de caja de prueba. Deja en el banco el
 * subcontrato, sus recibos, la OC, sus documentos y la planilla, todo con el
 * sello de la corrida.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * CAPTURAS y el correo de cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba, elegirCuenta } from './caja-de-prueba.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = join(process.env.CAPTURAS ?? '/tmp/banco-capturas', 'recibo-contrato-y-tablero')
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['administracion', 'logistica', 'gerencia', 'diseno', 'almacen', 'tesoreria'].map((p) => [p, cuenta(p)]))
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
/** Lee hasta que se cumple o se acaba el tiempo: se espera a lo que pasa, no un tiempo fijo. */
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}
const PDF = (relleno) =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%${'x'.repeat(relleno)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)

// ---------------------------------------------------------------- siembra
const SELLO = String(100000 + (Date.now() % 900000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
const ruc = await uno(
  `select r from (select '10' || $1 || d as r from generate_series(0, 9) d) x
    where public.ruc_es_valido(r) and not exists (select 1 from subcontratistas s where s.ruc = r) limit 1`,
  [`${SELLO}00`.slice(0, 8)],
)
if (!ruc) throw new Error('No salió un RUC libre para el subcontratista de la prueba.')
await como('administracion')
const { sub } = await uno(`select public.guardar_subcontratista(gen_random_uuid(), $1, $2, null, null, null, null, true) as sub`,
  [ruc.r, `Soldador de la nota ${SELLO}`])
const { id: subcontrato } = await uno(
  `select public.registrar_subcontrato(gen_random_uuid(), $1, $2, 'Soldadura de la nota, prueba', 'PEN', 9000, null, null, 'PRD') as id`,
  [sub, `QA_NOTA_${SELLO}`],
)
await consulta(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)

/** `sql` en una transacción con la sesión de `puesto` y el rol authenticated, como en la pantalla. */
async function conRol(puesto, sql, valores = []) {
  const sub = ids[CUENTAS[puesto]]
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', $2, true)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
// Las respuestas ≥ 400. Las únicas esperadas: el reintento sube a la ruta que ya tiene su archivo
// y Storage contesta 400 o 409 (`subirARutaNueva`); el navegador lo anota en la consola.
const rechazos = []
let cortando = false

async function entrar(puesto, viewport) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (cortando && /net::ERR_FAILED|Failed to fetch|TypeError/.test(m.text())) return
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${puesto}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('response', (r) => {
    if (r.status() >= 400) rechazos.push(`${puesto}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  await ingresar(pagina, puesto)
  return { pagina, contexto }
}

async function ingresar(pagina, puesto) {
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', CUENTAS[puesto])
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${CUENTAS[puesto]}`)
  await pagina.waitForLoadState('networkidle')
}

/** «Cerrar sesión» y entra `puesto` en la misma pestaña: su `sessionStorage` sigue. */
async function salirYEntrar(pagina, puesto) {
  await Promise.all([
    pagina.waitForURL((u) => u.pathname.startsWith('/ingresar'), { timeout: 30000 }),
    pagina.evaluate(() => document.querySelector('form[action="/auth/salir"]')?.requestSubmit()),
  ])
  await ingresar(pagina, puesto)
}

/**
 * Las próximas `quedan` acciones de servidor que lleven `marca` llegan al
 * servidor y se cumplen, pero su respuesta no llega al navegador: una señal que
 * se cae a medio camino. Son dos: sin respuesta, la subida pregunta otra vez
 * (`anotarSinDejarloSuelto`), y la segunda contestaría que quedó.
 */
async function cortarLaRespuesta(pagina) {
  const corte = { marca: null, quedan: 0, cortadas: 0 }
  const armar = (marca) => {
    corte.marca = marca
    corte.quedan = 2
  }
  await pagina.route('**/*', async (r) => {
    const q = r.request()
    if (corte.quedan <= 0 || q.method() !== 'POST' || !q.headers()['next-action'] || !(q.postData() ?? '').includes(corte.marca)) return r.continue()
    corte.quedan--
    corte.cortadas++
    await r.fetch({ timeout: 60000 }).catch(() => {})
    return r.abort('failed')
  })
  return { corte, armar }
}

/** Cómo quedó la ventana tras el aviso: sin rojo, los campos trabados y qué botones se pueden tocar. */
function laVentana(v) {
  return v.evaluate((ventana) => {
    const aviso = ventana.querySelector('[role="alert"]')
    const campos = [...ventana.querySelectorAll('input:not([type=hidden]), select, textarea')]
    const botones = [...ventana.querySelectorAll('button:not([data-ayuda])')].filter((b) => !b.disabled && b.offsetParent !== null)
    return {
      neutro: aviso?.hasAttribute('data-ya-entro') ?? false,
      rojo: aviso ? getComputedStyle(aviso).color : null,
      abiertos: campos.filter((c) => !c.disabled).map((c) => c.name || c.id),
      botones: [...new Set(botones.map((b) => b.textContent.trim() || b.getAttribute('aria-label')))],
    }
  })
}

// ---------------------------------------------------------------- 1 y 2. Administración, el subcontrato
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const tam = viewport.width
  const { pagina, contexto } = await entrar('administracion', viewport)
  const { corte, armar } = await cortarLaRespuesta(pagina)
  const v = pagina.getByRole('dialog')
  const ir = () => pagina.goto(`${BASE}/subcontratos/${subcontrato}`, { waitUntil: 'networkidle' })
  const abrirRecibo = async () => {
    await pagina.locator('[data-subir-recibo]').click()
    await v.waitFor()
  }
  const llenarRecibo = async (numero, monto) => {
    await v.locator('input[name="numero"]').fill(numero)
    await v.locator('input[name="monto_bruto"]').fill(monto)
    await v.locator('input[name="archivo"]').setInputFiles({ name: `recibo-${numero}.pdf`, mimeType: 'application/pdf', buffer: PDF(400) })
  }
  const recibos = (numero) => consulta(`select monto_bruto::numeric as monto from recibos_honorarios where subcontrato_id = $1 and numero = $2`, [subcontrato, numero])
  const alerta = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
  const nota = () => v.locator('[data-envio-anterior]').textContent({ timeout: 500 }).catch(() => '')

  // 1a. Sin respuesta, «Cancelar», y al volver a abrir dice que aquel quedó.
  const A = `E${tam === 390 ? '391' : '144'}-${SELLO}1`
  await ir()
  await abrirRecibo()
  await llenarRecibo(A, '1000')
  armar(A)
  cortando = true
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  const corto = limpio(await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000))
  cortando = false
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  const entro = await recibos(A)
  comprobar(corte.cortadas === 2 && /No llegó la respuesta/.test(corto) && entro.length === 1,
    `[Administración ${tam}] el recibo ${A} entra y su respuesta se pierde: «${corto}»`)
  await abrirRecibo()
  const dice = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
  comprobar(dice === `El recibo que enviaste antes sí quedó: ${A}. Lo que registres ahora será otro.` && (await v.locator('[role="alert"]').count()) === 0,
    `[Administración ${tam}] tras «Cancelar», al volver a abrir dice que aquel quedó, sin rojo: «${dice}»`)
  await pagina.screenshot({ path: join(CAPTURAS, `recibo-nota-${tam}.png`) })

  // 1b. El siguiente entra desde esa misma ventana.
  const B = `E${tam === 390 ? '391' : '144'}-${SELLO}2`
  await llenarRecibo(B, '1200')
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const deA = await recibos(A)
  const deB = await recibos(B)
  comprobar(deA.length === 1 && deB.length === 1, `[Administración ${tam}] y el siguiente, ${B}, entra aparte (${deA.length} y ${deB.length})`)

  // 1c. Otro se pierde igual y se reenvía con otro monto: «ya quedó» sin rojo, trabado y solo «Cerrar».
  const C = `E${tam === 390 ? '391' : '144'}-${SELLO}3`
  await abrirRecibo()
  comprobar((await v.locator('[data-envio-anterior]').count()) === 0, `[Administración ${tam}] tras registrarlo, la ventana siguiente ya no trae la nota`)
  await llenarRecibo(C, '1300')
  armar(C)
  cortando = true
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000)
  cortando = false
  await v.locator('input[name="monto_bruto"]').fill('1350')
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  const yaQuedo = limpio(await hasta(alerta, (t) => /ya está registrado|primera vez/.test(t ?? ''), 30000))
  const estado = await laVentana(v)
  const deC = await recibos(C)
  comprobar(/primera vez que lo enviaste/.test(yaQuedo) && estado.neutro && estado.abiertos.length === 0 && estado.botones.join() === 'Cerrar',
    `[Administración ${tam}] con otro monto dice sin rojo que ya quedó, trabado y solo con «Cerrar»: «${yaQuedo}» (${JSON.stringify(estado)})`)
  comprobar(deC.length === 1 && Number(deC[0].monto) === 1300, `[Administración ${tam}] y queda uno, con el monto de la primera vez (${deC.map((r) => Number(r.monto)).join(', ')})`)
  await pagina.screenshot({ path: join(CAPTURAS, `recibo-ya-quedo-${tam}.png`) })
  await v.getByRole('button', { name: 'Cerrar', exact: true }).filter({ hasText: 'Cerrar' }).click()
  await v.waitFor({ state: 'hidden' })

  // 1d. Otro se pierde, «Cancelar», y la página se carga entera: es lo que hace
  // Next si la puesta al día al cerrar no llega. Al volver a abrir, la ventana
  // sabe que aquel quedó (antes la memoria se iba y entraba dos veces).
  const D = `E${tam === 390 ? '391' : '144'}-${SELLO}4`
  const E = `E${tam === 390 ? '391' : '144'}-${SELLO}5`
  await abrirRecibo()
  await llenarRecibo(D, '1400')
  armar(D)
  cortando = true
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000)
  cortando = false
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await v.waitFor({ state: 'hidden' })
  await pagina.reload({ waitUntil: 'networkidle' })
  await abrirRecibo()
  const trasRecargar = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
  comprobar(trasRecargar === `El recibo que enviaste antes sí quedó: ${D}. Lo que registres ahora será otro.` && (await v.locator('[role="alert"]').count()) === 0,
    `[Administración ${tam}] tras recargar la página, al volver a abrir dice que ${D} quedó: «${trasRecargar}»`)
  await llenarRecibo(E, '1500')
  await v.getByRole('button', { name: 'Registrar recibo' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const deD = await recibos(D)
  const deE = await recibos(E)
  comprobar(deD.length === 1 && deE.length === 1, `[Administración ${tam}] ${D} está una vez y ${E} entra aparte (${deD.length} y ${deE.length})`)

  // 1e. Lo pendiente sigue si vuelve a entrar la misma cuenta, y se olvida si
  // entra otra en la pestaña: su ventana preguntaría por un envío ajeno.
  if (tam === 1440) {
    const F = `E144-${SELLO}6`
    const llave = `metal-work:envio-pendiente:recibo_honorarios:${subcontrato}`
    const pendientes = () => pagina.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('metal-work:envio-pendiente:')))
    await abrirRecibo()
    await llenarRecibo(F, '1600')
    armar(F)
    cortando = true
    await v.getByRole('button', { name: 'Registrar recibo' }).click()
    await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000)
    cortando = false
    await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await v.waitFor({ state: 'hidden' })
    const deF = await recibos(F)
    await salirYEntrar(pagina, 'administracion')
    const laMisma = await pendientes()
    await salirYEntrar(pagina, 'logistica')
    const otra = await pendientes()
    await salirYEntrar(pagina, 'administracion')
    await ir()
    await abrirRecibo()
    const sinNota = limpio(await hasta(nota, (t) => Boolean(t), 3000))
    comprobar(deF.length === 1 && laMisma.includes(llave), `[Administración 1440] ${F} entró y, si vuelve a entrar la misma cuenta, sigue pendiente (${JSON.stringify(laMisma)})`)
    comprobar(otra.length === 0 && sinNota === '', `[Administración 1440] si entra otra cuenta en la pestaña se olvida, y la ventana ya no pregunta por él (${JSON.stringify(otra)}; «${sinNota}»)`)
    await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await v.waitFor({ state: 'hidden' })
  }

  // 2. El contrato: la respuesta se pierde y se elige otro archivo.
  const contratoA = `QA-NOTA-CONTRATO-A-${SELLO}-${tam}.pdf`
  const contratoB = `QA-NOTA-CONTRATO-B-${SELLO}-${tam}.pdf`
  await ir()
  await pagina.locator('[data-adjuntar-contrato]').click()
  await v.waitFor()
  await v.locator('input[name="contrato"]').setInputFiles({ name: contratoA, mimeType: 'application/pdf', buffer: PDF(300) })
  armar(contratoA)
  cortando = true
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000)
  cortando = false
  await v.locator('input[name="contrato"]').setInputFiles({ name: contratoB, mimeType: 'application/pdf', buffer: PDF(900) })
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  const subido = limpio(await hasta(alerta, (t) => /ya se subió/.test(t ?? ''), 30000))
  const enContrato = await laVentana(v)
  const contratos = await consulta(`select archivo_nombre from subcontrato_contratos where subcontrato_id = $1 and archivo_nombre in ($2, $3)`,
    [subcontrato, contratoA, contratoB])
  comprobar(subido.includes(`Antes ya se subió ${contratoA}`) && enContrato.neutro && enContrato.abiertos.length === 0 && enContrato.botones.join() === 'Cerrar',
    `[Administración ${tam}] el contrato que ya se subió lo dice sin rojo, trabado y solo con «Cerrar»: «${subido}» (${JSON.stringify(enContrato)})`)
  comprobar(contratos.length === 1 && contratos[0].archivo_nombre === contratoA, `[Administración ${tam}] y queda el primero, una vez (${contratos.map((c) => c.archivo_nombre).join(', ')})`)
  await pagina.screenshot({ path: join(CAPTURAS, `contrato-ya-quedo-${tam}.png`) })
  await v.getByRole('button', { name: 'Cerrar', exact: true }).filter({ hasText: 'Cerrar' }).click()
  await v.waitFor({ state: 'hidden' })
  await pagina.unrouteAll({ behavior: 'ignoreErrors' })
  await contexto.close()
}

// ---------------------------------------------------------------- 3. Logística, el tablero de la OT
{
  // La OC es de la corrida: dos líneas por comprar de un insumo propio en una OT
  // en marcha, y un proveedor propio. El pedido de material por OT es el
  // circuito de antes del RQ por insumo y ninguna cuenta del banco lo hace
  // entera (pide `requerimientos.crear` y `ordenes.ver` a la vez): la siembra va
  // directa, y lo que se prueba lo hace Logística en pantalla.
  const ot = await uno(`select o.id as orden_id, o.numero as numero_ot from ordenes_trabajo o
                         order by exists (select 1 from v_atencion_materiales a where a.orden_id = o.id) desc,
                                  o.estado = 'EN_PROCESO' desc, o.numero limit 1`)
  comprobar(Boolean(ot), 'el banco tiene una OT')
  if (ot) {
    const insumo = `Plancha del tablero QA ${SELLO}`
    const proveedor = `ACEROS DEL TABLERO QA ${SELLO}`
    const referencia = `QA-TAB-${SELLO}`
    await base.query('begin')
    // Un pedido por OT y área (si la OT ya tiene el de Maestranza, las líneas van
    // en ese) y una línea por OT e insumo: dos insumos. La OC compra el primero y
    // el segundo deja el botón «Nueva orden de compra» encendido. Las líneas
    // nacen propuestas; Diseño las aprueba y Almacén las manda a compra, cada uno
    // con su cuenta y las funciones de la base.
    await consulta(`insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por) values ($1, 'MTZ', $2)
                    on conflict (orden_id, area_destino) do nothing`, [ot.orden_id, ids[CUENTAS.logistica]])
    const lineas = []
    for (const [k, descripcion] of [insumo, `Disco del tablero QA ${SELLO}`].entries()) {
      const { material } = await uno(
        `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente, activo)
         select $1, $2, (select id from public.categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
                (select id from public.unidades_medida where codigo = 'UND'), false, true returning id as material`,
        [`QA-TAB-${SELLO}-${k + 1}`, descripcion],
      )
      lineas.push((await uno(
        `with om as (insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino) values ($1, $2, 3, 'MTZ') returning id)
         insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
         select r.id, om.id, 3 from om, public.requerimientos_materiales r where r.orden_id = $1 and r.area_destino = 'MTZ' returning id`,
        [ot.orden_id, material],
      )).id)
    }
    const rucProveedor = await uno(
      `select r from (select '20' || $1 || d as r from generate_series(0, 9) d) x
        where public.ruc_es_valido(r) and not exists (select 1 from proveedores p where p.numero_documento = r) limit 1`,
      [`${SELLO}000`.slice(0, 8)],
    )
    await consulta(`insert into public.proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 457, Lima', '999 333 447')`,
      [rucProveedor.r, proveedor])
    await base.query('commit')
    await conRol('diseno', 'select public.resolver_propuesta_material(x, true) from unnest($1::uuid[]) x', [lineas])
    await conRol('almacen', `select public.revisar_stock_requerimiento(x, 'COMPRA') from unnest($1::uuid[]) x`, [lineas])

    const { pagina, contexto } = await entrar('logistica', { width: 1440, height: 900 })
    const v = pagina.getByRole('dialog')
    const ir = () => pagina.goto(`${BASE}/ordenes/${ot.orden_id}?vista=materiales`, { waitUntil: 'networkidle' })
    const nueva = pagina.getByRole('button', { name: 'Nueva orden de compra' })
    const operacion = () => v.locator('input[type=hidden][name=operacion_id]').inputValue()
    const nota = () => v.locator('[data-envio-anterior]').textContent({ timeout: 500 }).catch(() => '')
    const alerta = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
    const ocs = () => consulta(`select id, numero, aprobacion from ordenes_compra_materiales where referencia = $1`, [referencia])

    // 3a. La OC sale, su respuesta se pierde, «Cancelar» y la página se recarga entera.
    await ir()
    await nueva.click()
    await v.waitFor()
    await v.locator('#oc-proveedor').click()
    await pagina.getByLabel('Razón social o RUC').pressSequentially(SELLO, { delay: 15 })
    await pagina.getByRole('option', { name: new RegExp(SELLO) }).click()
    await v.locator('#oc-numero').fill(referencia)
    await v.locator('#oc-codigo').click()
    await v.locator('#oc-codigo').pressSequentially('PLANTA')
    const planta = pagina.getByRole('option', { name: /^PLANTA/ }).first()
    if (await planta.count()) await planta.click()
    else await v.locator('#oc-codigo').press('Escape')
    await v.getByRole('checkbox', { name: insumo }).check()
    await v.locator('input[name^="precio_"]').first().fill('10')
    const primero = await operacion()
    const { corte, armar } = await cortarLaRespuesta(pagina)
    armar(referencia)
    corte.quedan = 1 // La OC no sube archivo: una sola respuesta que perder.
    cortando = true
    await v.getByRole('button', { name: 'Crear orden de compra' }).click()
    const corto = limpio(await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000))
    cortando = false
    const emitida = await ocs()
    comprobar(corte.cortadas === 1 && /No llegó la respuesta/.test(corto) && emitida.length === 1 && emitida[0].id === primero,
      `[Logística 1440] la OC del tablero entra con el id de la ventana y su respuesta se pierde: «${corto}» (${emitida.map((o) => o.numero).join(', ')})`)
    await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await v.waitFor({ state: 'hidden' })
    const guardado = await pagina.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('metal-work:envio-pendiente:')))
    // Lo que hace Next si el refresco al cerrar no llega: carga la página entera y la memoria se va.
    await pagina.reload({ waitUntil: 'networkidle' })

    // 3b. Al volver a abrir, la ventana sabe que aquella quedó y lleva otro id.
    await nueva.click()
    await v.waitFor()
    const dice = limpio(await hasta(nota, (t) => /sí quedó/.test(t ?? ''), 15000))
    const segundo = await operacion()
    comprobar(guardado.some(([k, val]) => k === `metal-work:envio-pendiente:orden_compra_del_tablero:${ot.orden_id}` && val === primero),
      `[Logística 1440] el id que salió queda en la pestaña, por la OT (${JSON.stringify(guardado.map(([k]) => k))})`)
    comprobar(emitida.length === 1 && dice === `La orden de compra que enviaste antes sí quedó: ${emitida[0].numero}. Lo que registres ahora será otra.`
      && segundo !== primero && (await v.locator('[role="alert"]').count()) === 0,
      `[Logística 1440] tras recargar la página, al volver a abrir dice que aquella quedó, sin rojo, y lleva otro id: «${dice}»`)
    await pagina.screenshot({ path: join(CAPTURAS, 'tablero-oc-tras-recargar.png') })
    await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await v.waitFor({ state: 'hidden' })
    comprobar((await ocs()).length === 1, `[Logística 1440] y la OC está una vez (${(await ocs()).map((o) => o.numero).join(', ')})`)

    // Gerencia la aprueba con su cuenta, con el rol real: detenida no tiene «Documentos para Tesorería».
    if (emitida[0] && emitida[0].aprobacion === 'POR_APROBAR') {
      await conRol('gerencia', 'select public.aprobar_compra($1)', [emitida[0].id])
    }
    const oc = emitida[0] ? { orden_compra_id: emitida[0].id, numero: emitida[0].numero } : null

    // 3c. «Documentos para Tesorería» de esa OC: lo elegido sigue tras dos puestas al día.
    if (oc) {
      let refrescos = 0
      pagina.on('requestfinished', (q) => {
        if (q.method() === 'GET' && q.headers()['rsc'] && !q.headers()['next-router-prefetch']) refrescos++
      })
      await ir()
      const tipo = pagina.locator(`select#tipo-doc-compra-${oc.orden_compra_id}`)
      await tipo.waitFor({ timeout: 60000 })
      const form = pagina.locator('form', { has: tipo })
      const estado = async () => ({
        id: await form.locator('input[type=hidden][name=id]').inputValue(),
        tipo: await tipo.inputValue(),
        archivos: await form.locator('input[name=archivo]').evaluate((i) => i.files?.length ?? 0),
      })
      const nombre = `QA-NOTA-TABLERO-${SELLO}.pdf`
      await tipo.selectOption('OTRO')
      await form.locator('input[name=archivo]').setInputFiles({ name: nombre, mimeType: 'application/pdf', buffer: PDF(500) })
      const antes = await estado()
      const vistos = []
      for (let k = 0; k < 2; k++) {
        const r0 = refrescos
        await pagina.evaluate(() => window.next.router.refresh())
        await hasta(() => refrescos, (n) => n > r0, 30000)
        await pagina.waitForLoadState('networkidle')
        vistos.push(await estado())
      }
      comprobar(vistos.every((e) => e.id === antes.id && e.tipo === 'OTRO' && e.archivos === 1),
        `[Logística 1440] OT ${ot.numero_ot}, ${oc.numero}: lo elegido sigue tras dos puestas al día, con el mismo id (${JSON.stringify([antes, ...vistos])})`)

      // 3d. La respuesta se pierde; el reintento va con el mismo id y a la misma ruta.
      armar(nombre)
      cortando = true
      const adjuntar = form.getByRole('button', { name: 'Adjuntar' })
      await adjuntar.click()
      const aviso = () => form.locator('[role="alert"], [role="status"]').allInnerTexts().then((t) => limpio(t.join(' | '))).catch(() => '')
      const cortoDoc = await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 30000)
      cortando = false
      const idTrasElCorte = await form.locator('input[type=hidden][name=id]').inputValue()
      const cortadasDoc = corte.cortadas - 1
      await adjuntar.click()
      const dijo = await hasta(aviso, (t) => /adjuntado|ya quedó|primera vez/i.test(t ?? ''), 30000)
      const filas = await consulta(`select id, ruta_storage from documentos_compra_material where orden_compra_id = $1 and nombre_archivo = $2`,
        [oc.orden_compra_id, nombre])
      const sueltos = await consulta(`select o.name from storage.objects o where o.bucket_id = 'documentos-compras' and o.name like $1
                                        and not exists (select 1 from documentos_compra_material d where d.ruta_storage = o.name)`,
        [`compra/${oc.orden_compra_id}/%`])
      comprobar(cortadasDoc === 2 && /No llegó la respuesta/.test(cortoDoc) && idTrasElCorte === antes.id,
        `[Logística 1440] sin respuesta, el formulario se queda con el mismo id: «${cortoDoc}»`)
      comprobar(filas.length === 1 && filas[0].id === antes.id && filas[0].ruta_storage === `compra/${oc.orden_compra_id}/${antes.id}.pdf` && sueltos.length === 0,
        `[Logística 1440] el reintento entra una vez, con ese id y su ruta, y sin archivos sueltos («${dijo}»; ${filas.length} fila(s), ${sueltos.length} suelto(s))`)

      // 3e. Otro se pierde y se reenvía con otro tipo: sin ventana, el «ya quedó»
      // no pide recargar —la lista ya se puso al día—, dice que lo de esta vez no
      // se guardó, y queda el primero.
      const nombre3 = `QA-NOTA-TABLERO-3-${SELLO}.pdf`
      await tipo.selectOption('OTRO')
      await form.locator('input[name=archivo]').setInputFiles({ name: nombre3, mimeType: 'application/pdf', buffer: PDF(550) })
      armar(nombre3)
      cortando = true
      await adjuntar.click()
      await hasta(aviso, (t) => /respuesta/.test(t ?? ''), 30000)
      cortando = false
      await tipo.selectOption('COTIZACION')
      await adjuntar.click()
      const yaQuedo = await hasta(aviso, (t) => /primera vez/.test(t ?? ''), 30000)
      const deNombre3 = await consulta(`select tipo from documentos_compra_material where orden_compra_id = $1 and nombre_archivo = $2`, [oc.orden_compra_id, nombre3])
      comprobar(!/recarga la pantalla/i.test(yaQuedo) && /Lo que enviaste esta vez no se guardó: la lista ya muestra lo que quedó/.test(yaQuedo)
        && deNombre3.length === 1 && deNombre3[0].tipo === 'OTRO',
        `[Logística 1440] con otro tipo, el «ya quedó» del tablero no pide recargar y queda el primero: «${yaQuedo}» (${deNombre3.map((d) => d.tipo).join(', ')})`)

      // 3f. El siguiente, adjuntado: el cursor va al tipo del formulario nuevo, no a la página.
      const nombre2 = `QA-NOTA-TABLERO-2-${SELLO}.pdf`
      await tipo.selectOption('OTRO')
      await form.locator('input[name=archivo]').setInputFiles({ name: nombre2, mimeType: 'application/pdf', buffer: PDF(600) })
      await adjuntar.click()
      const deNombre2 = () => consulta(`select id from documentos_compra_material where orden_compra_id = $1 and nombre_archivo = $2`, [oc.orden_compra_id, nombre2])
      await hasta(deNombre2, (f) => f.length > 0, 30000)
      const enfocado = await hasta(() => pagina.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName), (x) => x === `tipo-doc-compra-${oc.orden_compra_id}`, 5000)
      const segundoDoc = await deNombre2()
      comprobar(segundoDoc.length === 1 && segundoDoc[0].id !== antes.id && enfocado === `tipo-doc-compra-${oc.orden_compra_id}`,
        `[Logística 1440] el siguiente entra con otro id y el cursor queda en «Tipo de documento» (${enfocado})`)
      await pagina.screenshot({ path: join(CAPTURAS, 'tablero-ot.png'), fullPage: true })
    }
    await pagina.unrouteAll({ behavior: 'ignoreErrors' })
    await contexto.close()
  }
}

// ---------------------------------------------------------------- 4. Tesorería, el pago de la planilla
{
  // Una planilla de dos personas, sembrada como en `probar-pagos-mueven-la-caja`.
  const caja = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)
  const numeroPlanilla = `PD-QA-${SELLO}`
  await base.query('begin')
  const { id: planilla } = await uno(
    `insert into planillas_diarias (numero, fecha, personas, total, enviada_por)
     values ($1, (now() at time zone 'America/Lima')::date, 2, 300, $2) returning id`,
    [numeroPlanilla, ids[CUENTAS.tesoreria]],
  )
  for (const [i, monto] of [[1, 100], [2, 200]]) {
    const t = await uno(
      `insert into trabajadores (nombres, apellidos, dni, creado_por)
       select 'Persona', 'Planilla QA ' || $1::text, lpad(n::text, 8, '0'), $3 from generate_series(71000000 + $2::int * 100, 71000000 + $2::int * 100 + 99) n
        where not exists (select 1 from trabajadores w where w.dni = lpad(n::text, 8, '0')) limit 1 returning id`,
      [i, Number(SELLO.slice(-4)), ids[CUENTAS.tesoreria]],
    )
    await consulta(
      `insert into planilla_diaria_personas (planilla_id, trabajador_id, nombre, horas_ordinarias, horas_extras, monto_ordinarias, monto_extras, total)
       values ($1, $2, $3, 8, 0, $4, 0, $4)`,
      [planilla, t.id, `Persona planilla QA ${SELLO} ${i}`, monto],
    )
  }
  await base.query('commit')

  // 4. Paga a la primera; la respuesta se pierde, el reintento dice que ya
  // quedó, y al cerrar la gente por pagar cambia y el botón se rehace con otra
  // llave: el cursor va al botón nuevo, no al contenido de la página.
  const { pagina, contexto } = await entrar('tesoreria', { width: 1440, height: 900 })
  const { corte, armar } = await cortarLaRespuesta(pagina)
  const v = pagina.getByRole('dialog')
  const alerta = () => v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')
  await pagina.goto(`${BASE}/planilla-diaria/${planilla}`, { waitUntil: 'networkidle' })
  const boton = pagina.locator('[data-registrar-pago]')
  // Una marca que no es atributo: el cursor busca el botón nuevo por sus `data-…`.
  await boton.evaluate((b) => { b.deAntes = true })
  await boton.click()
  await v.waitFor()
  await elegirCuenta(v, caja)
  await v.getByRole('checkbox', { name: `Persona planilla QA ${SELLO} 2` }).uncheck()
  const operacion = `OP-PD-${SELLO}`
  await v.locator('input[name="operacion"]').fill(operacion)
  await v.locator('input[name="archivo"]').setInputFiles({ name: 'comprobante.pdf', mimeType: 'application/pdf', buffer: PDF(300) })
  armar(operacion)
  cortando = true
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const corto = limpio(await hasta(alerta, (t) => /respuesta/.test(t ?? ''), 30000))
  cortando = false
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const yaQuedo = limpio(await hasta(alerta, (t) => /primera vez/.test(t ?? ''), 30000))
  const pagos = await consulta(
    `select (select count(*)::int from planilla_diaria_personas p where p.pago_id = g.id) as personas from planilla_diaria_pagos g
      where g.planilla_id = $1 and g.anulado_en is null`, [planilla])
  comprobar(corte.cortadas === 2 && /No llegó la respuesta/.test(corto) && /primera vez/.test(yaQuedo) && pagos.length === 1 && pagos[0].personas === 1,
    `[Tesorería 1440] el pago de una persona entra una vez; el reintento dice que ya quedó: «${yaQuedo}»`)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).filter({ hasText: 'Cerrar' }).click()
  await v.waitFor({ state: 'hidden' })
  const cursor = () => pagina.evaluate(() => {
    const e = document.activeElement
    return e?.hasAttribute('data-registrar-pago') ? (e.deAntes ? 'el botón de antes' : 'el botón nuevo') : (e?.tagName ?? '—')
  })
  const dondeQueda = await hasta(cursor, (c) => c === 'el botón nuevo', 15000)
  comprobar(dondeQueda === 'el botón nuevo', `[Tesorería 1440] al cerrar, el botón «Registrar pago» se rehace y el cursor va a él (${dondeQueda})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'planilla-cursor.png') })
  await pagina.unrouteAll({ behavior: 'ignoreErrors' })
  await contexto.close()
}

await navegador.close()
await base.end()
comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 4).join(' | ')}` : ''}`)
const ajenos = rechazos.filter((r) => !/: 40[09] POST \/storage\/v1\/object\//.test(r))
comprobar(ajenos.length === 0, `los únicos rechazos son los de Storage al reintento sobre la misma ruta (${rechazos.length}${ajenos.length ? `; otros: ${ajenos.slice(0, 4).join(' | ')}` : ''})`)
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTODO EN VERDE')
process.exit(fallas.length ? 1 : 0)

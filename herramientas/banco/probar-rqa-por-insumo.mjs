/**
 * La administradora sigue cada insumo de su RQA de principio a fin (Plan 8,
 * Administración, entrega 8.3): Almacén lo revisa, va en compra, viene en
 * camino, llegó, se entregó. Es la misma cuenta que sigue el supervisor en «RQ
 * por unidad» (`pasoDelInsumo`, plan 1, entrega 1.2), en la tarjeta del RQ en
 * /requerimientos, con la fecha de la OC y el metrado que la tarjeta ya lee.
 *
 * Arma en el banco, con la cuenta de Administración:
 *   - un RQA con cinco insumos que Almacén revisa con su cuenta: dos que tenía
 *     (de uno ya salió una parte, el otro salió entero) y tres que no; de esos,
 *     uno va en una OC aprobada que llega en cuatro días, otro en una OC por
 *     aprobar que la administradora esperaba hace dos días, y otro sin comprar;
 *   - un RQA recién registrado, que nadie revisó;
 *   - un RQA anulado, que no lleva pasos.
 * La OC y la salida se ponen por SQL, que ya lo prueban sus checks.
 *
 * Comprueba, a 390 y a 1440, con la cuenta de Administración:
 *   1. Cada insumo dice su paso, de principio a fin, con el de ahora marcado.
 *   2. Lo que se compra dice cuándo llega; la fecha que ya pasó no se promete.
 *   3. Lo que Almacén tenía no pasa por la compra.
 *   4. El anulado no lleva pasos; de la compra no sale el proveedor.
 *   5. Almacén y Logística, que ven el RQA pero no lo llevan, no reciben los
 *      pasos.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const correoDe = (puesto) => `${puesto}.local@metalwork.test`
/** dd/mm/aaaa de un día YYYY-MM-DD, como `fecha()` de la pantalla. */
const ddmm = (dia) => dia.split('-').reverse().join('/')

/** Lo que da la base con la sesión de esa cuenta y el rol authenticated. */
async function comoCuenta(puesto, sql, valores = []) {
  const [cuenta] = await consulta('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [cuenta.id],
    )
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

/** Escribe sin disparadores: el armazón del circuito que ya prueban sus checks. */
async function armazon(sql, valores = []) {
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const telefono = ancho <= 480
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: telefono ? 844 : 900 },
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

/** La pantalla entera, sin la marca de `next dev`. */
async function capturar(pagina, archivo) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  const ventana = pagina.viewportSize()
  const alto = await pagina.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  await pagina.setViewportSize({ width: ventana.width, height: Math.max(alto, ventana.height) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

// ------------------------------------------------ armazón
const sello = `QA ${Date.now().toString(36).toUpperCase()}`
const proveedor = `PROVEEDOR SECRETO ${sello} S.A.C.`
const [almacen] = await consulta(`select id from public.usuarios where correo = $1`, [correoDe('almacen')])
const [administracion] = await consulta(`select id from public.usuarios where correo = $1`, [correoDe('administracion')])
const material = async (sql, cual = 0) =>
  (await consulta(`select m.id from public.materiales m join public.categorias_material c on c.id = m.categoria_id where m.activo and ${sql} order by m.codigo limit 1 offset ${cual}`))[0]?.id
const papel = await material(`c.almacen = 'CONSUMIBLES'`)
const guantes = await material(`c.almacen = 'CONSUMIBLES'`, 1)
const toner = await material(`c.almacen = 'CONSUMIBLES'`, 2)
const sillas = await material(`c.almacen = 'ACCESORIOS'`)
const cinta = await material(`c.almacen = 'ACCESORIOS'`, 1)
if (![papel, guantes, toner, sillas, cinta].every(Boolean)) throw new Error('El banco no tiene los materiales de prueba (tres consumibles y dos accesorios).')

const ids = { compra: randomUUID(), nuevo: randomUUID(), anulado: randomUUID() }
const linea = (material_id, cantidad) => ({ material_id, cantidad })
const emitir = (id, justificacion, lineas) =>
  comoCuenta('administracion', `select public.emitir_requerimiento($1, 'ADMINISTRACION', (select id from public.areas where codigo = 'RRH'), 'OFICINA', $2, null, $3::jsonb)`, [
    id, justificacion, JSON.stringify(lineas),
  ])
await emitir(ids.compra, `${sello} Útiles y sillas para la oficina`, [linea(sillas, 6), linea(toner, 4), linea(papel, 10), linea(guantes, 2), linea(cinta, 3)])
await emitir(ids.nuevo, `${sello} Papel para la impresora`, [linea(papel, 5)])
await emitir(ids.anulado, `${sello} Cinta que ya no hace falta`, [linea(cinta, 1)])
await comoCuenta('administracion', `select public.anular_requerimiento($1, $2)`, [ids.anulado, `Prueba del banco ${sello}`])
const numeros = Object.fromEntries(
  (await consulta(`select id, numero from public.requerimientos where id = any($1)`, [Object.values(ids)])).map((r) => [r.id, r.numero]),
)
const llega = (await consulta(`select ((now() at time zone 'America/Lima')::date + 4)::text as d`))[0].d
const seEsperaba = (await consulta(`select ((now() at time zone 'America/Lima')::date - 2)::text as d`))[0].d

// Almacén revisa con su cuenta: tiene el papel y los guantes; las sillas, el
// tóner y la cinta no.
await comoCuenta('almacen', `select public.rq_revisar_stock($1, $2::jsonb, null)`, [
  ids.compra,
  JSON.stringify([
    { item: 1, en_stock: 0 },
    { item: 2, en_stock: 0 },
    { item: 3, en_stock: 10 },
    { item: 4, en_stock: 2 },
    { item: 5, en_stock: 0 },
  ]),
])
// La administradora compra las sillas en una OC aprobada que llega en cuatro
// días, y el tóner en una que Gerencia no aprueba todavía y que ella esperaba
// hace dos días. La cinta sigue por comprar. La OC del RQ nuevo no lleva
// `requerimiento_id` (esa columna es del RQ de materiales de antes): va como
// DIRECTA y la une cada línea, como «Generar OC», y así la lee la administradora.
const oc = randomUUID()
const ocPorAprobar = randomUUID()
await armazon(
  `insert into public.ordenes_compra_materiales (id, origen, motivo, proveedor, referencia, aprobacion, aprobado_por, aprobado_en, creado_por, fecha_estimada)
   values ($1, 'DIRECTA', $6, $2, $3, 'APROBADA', $4, now(), $4, $5::date)`,
  [oc, proveedor, `REF-${sello}`, administracion.id, llega, `Atiende el requerimiento ${numeros[ids.compra]}`],
)
await armazon(
  `insert into public.ordenes_compra_materiales (id, origen, motivo, proveedor, referencia, aprobacion, creado_por, fecha_estimada)
   values ($1, 'DIRECTA', $6, $2, $3, 'POR_APROBAR', $4, $5::date)`,
  [ocPorAprobar, proveedor, `REF-${sello}-2`, administracion.id, seEsperaba, `Atiende el requerimiento ${numeros[ids.compra]}`],
)
await armazon(
  `update public.requerimiento_lineas
      set orden_compra_id = case item when 1 then $2::uuid else $3::uuid end, atendida_en = now(), atendida_por = $4
    where requerimiento_id = $1 and item in (1, 2)`,
  [ids.compra, oc, ocPorAprobar, administracion.id],
)
await armazon(`update public.requerimientos set estado = 'EN_ATENCION', en_atencion_en = now() where id = $1`, [ids.compra])
const salida = (rq, item, material_id, cantidad, quien) =>
  armazon(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                               requerimiento_linea_id, codigo_unidad, registrado_por, registrado_en)
     select gen_random_uuid(), 'SALIDA', $3, $4, 'SALIDA_GENERAL', $5, $6,
            (select l.id from public.requerimiento_lineas l where l.requerimiento_id = $1 and l.item = $2), 'OFICINA', $7, now()`,
    [rq, item, material_id, cantidad, `Salida ${sello}`, quien, almacen.id],
  )
await salida(ids.compra, 3, papel, 4, `Carla Ríos ${sello}`)
await salida(ids.compra, 4, guantes, 2, `Pedro Salas ${sello}`)

// ------------------------------------------------ la pantalla
const tarjeta = (pagina, id) => pagina.locator(`[data-rq="${numeros[id]}"]`)
async function abrirInsumos(pagina, id) {
  const pliegue = tarjeta(pagina, id).locator('[data-insumos]')
  if ((await pliegue.count()) === 1 && (await pliegue.getAttribute('open')) === null) await pliegue.locator('> summary').click()
}
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar('administracion', ancho)
  await ir(pagina, `/requerimientos?rq=${ids.compra}`)
  comprobar((await tarjeta(pagina, ids.compra).count()) === 1, `${ancho}: ${numeros[ids.compra]} sale en /requerimientos`)
  await abrirInsumos(pagina, ids.compra)
  const insumo = (item) => tarjeta(pagina, ids.compra).locator(`[data-insumo="${item}"]`)
  const comoVa = (item) => insumo(item).locator('[data-como-va-el-insumo]')
  const paso = async (item) => comoVa(item).getAttribute('data-como-va-el-insumo').catch(() => null)
  const texto = async (item) => limpio(await comoVa(item).innerText().catch(() => ''))
  /** La línea bajo los pasos, sin lo que solo lee el lector de pantalla. */
  const leyenda = async (item) => limpio(await comoVa(item).locator('p').innerText().catch(() => ''))
  const pasos = async (item) =>
    (
      await insumo(item)
        .locator('[data-paso-del-insumo]')
        .evaluateAll((e) => e.map((x) => `${x.getAttribute('data-paso-del-insumo')}${x.getAttribute('aria-current') ? '*' : ''}`))
    ).join(' > ')

  comprobar((await paso(1)) === 'EN_CAMINO', `${ancho}: las sillas vienen en camino (${await paso(1)})`)
  comprobar((await pasos(1)) === 'POR_ATENDER > EN_COMPRA > EN_CAMINO* > EN_ALMACEN > ENTREGADO', `${ancho}: las sillas, de principio a fin: ${await pasos(1)}`)
  comprobar((await texto(1)).includes(`Llega aprox. el ${ddmm(llega)}`), `${ancho}: dicen cuándo llegan: «${await texto(1)}»`)
  comprobar((await paso(2)) === 'EN_COMPRA', `${ancho}: el tóner va en compra (${await paso(2)})`)
  comprobar((await texto(2)).includes(`Administración lo esperaba el ${ddmm(seEsperaba)}`) && !(await texto(2)).toLowerCase().includes('llega aprox.') && !(await texto(2)).includes('Logística'),
    `${ancho}: la OC por aprobar con la fecha pasada no promete un día que ya pasó, y la fecha es de quien compra: «${await texto(2)}»`)
  comprobar((await paso(3)) === 'EN_ALMACEN', `${ancho}: el papel está en almacén (${await paso(3)})`)
  comprobar((await pasos(3)) === 'POR_ATENDER > EN_ALMACEN* > ENTREGADO', `${ancho}: el papel que tenía Almacén no pasa por la compra: ${await pasos(3)}`)
  comprobar((await paso(4)) === 'ENTREGADO' && (await pasos(4)) === 'POR_ATENDER > EN_ALMACEN > ENTREGADO',
    `${ancho}: los guantes salieron enteros y van entregados aunque otro del RQ siga en compra: ${await pasos(4)}`)
  comprobar(limpio(await insumo(4).innerText()).includes(`Pedro Salas ${sello}`), `${ancho}: y la salida dice quién los recibió`)
  comprobar((await paso(5)) === 'EN_COMPRA' && !(await texto(5)).includes('Llega'),
    `${ancho}: la cinta, sin compra, no dice que llega (${await paso(5)}: «${await texto(5)}»)`)
  if (ancho === 390) {
    comprobar((await leyenda(5)) === 'Administración compra', `390: la cinta sin OC dice quién la compra: «${await leyenda(5)}»`)
    comprobar((await leyenda(1)).startsWith('En camino'), `390: en el teléfono el paso de ahora se dice en palabras: «${await leyenda(1)}»`)
    comprobar((await leyenda(4)) === 'Entregado', `390: y el entregado lo dice: «${await leyenda(4)}»`)
  } else {
    comprobar((await leyenda(1)) === `Llega aprox. el ${ddmm(llega)}`, `1440: en el monitor el nombre va bajo cada paso y la línea dice solo la fecha: «${await leyenda(1)}»`)
    comprobar(!(await comoVa(3).locator('p').isVisible()), '1440: sin fecha que decir, no queda una línea vacía bajo los pasos')
    const nombres = limpio(await comoVa(1).locator('ol').innerText())
    comprobar(nombres.startsWith('Almacén revisa') && nombres.includes('Administración compra'), `1440: los pasos dicen quién revisa y quién compra: «${nombres}»`)
  }
  const todo = await pagina.locator('main').innerText()
  comprobar(!todo.includes(proveedor), `${ancho}: los pasos no traen el proveedor`)
  await sinDesborde(pagina, `${ancho} ${numeros[ids.compra]}`)
  await capturar(pagina, `8-3-administracion-${ancho}-rqa-por-insumo.png`)

  // La lista de RQA: el recién registrado espera la revisión; el anulado no lleva pasos.
  await ir(pagina, `/requerimientos?tipo=ADMINISTRACION`)
  for (const id of [ids.nuevo, ids.anulado]) comprobar((await tarjeta(pagina, id).count()) === 1, `${ancho}: ${numeros[id]} sale en la lista de RQA`)
  await abrirInsumos(pagina, ids.nuevo)
  await abrirInsumos(pagina, ids.anulado)
  const nuevo = tarjeta(pagina, ids.nuevo).locator('[data-como-va-el-insumo]')
  comprobar((await nuevo.count()) === 1 && (await nuevo.getAttribute('data-como-va-el-insumo')) === 'POR_ATENDER',
    `${ancho}: el recién registrado espera que Almacén lo atienda (${await nuevo.getAttribute('data-como-va-el-insumo').catch(() => 'sin pasos')})`)
  comprobar((await tarjeta(pagina, ids.anulado).locator('[data-como-va-el-insumo]').count()) === 0, `${ancho}: el anulado no lleva pasos`)
  await sinDesborde(pagina, `${ancho} /requerimientos?tipo=ADMINISTRACION`)
  await capturar(pagina, `8-3-administracion-${ancho}-lista-rqa.png`)
  await contexto.close()
}

// Quien ve el RQA pero no lo lleva no recibe los pasos.
for (const puesto of ['almacen', 'logistica']) {
  const { pagina, contexto } = await entrar(puesto, 1440)
  await ir(pagina, `/requerimientos?rq=${ids.compra}`)
  const ve = await tarjeta(pagina, ids.compra).count()
  await abrirInsumos(pagina, ids.compra)
  const pasos = await pagina.locator('[data-como-va-el-insumo]').count()
  comprobar(pasos === 0, `${puesto}: ${ve ? 've el RQA' : 'no ve el RQA'} y sin los pasos de Administración (${pasos})`)
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()

// Lo que quedó se anula, no se borra: un RQ numerado es evidencia.
await comoCuenta('administracion', `select public.anular_requerimiento($1, $2)`, [ids.nuevo, `Prueba del banco ${sello}`]).catch((e) =>
  console.log(`  (no se pudo anular ${numeros[ids.nuevo]}: ${e.message})`),
)
await base.end()
if (fallas.length) {
  console.error(`\n${fallas.length} fallan.`)
  process.exit(1)
}
console.log(`\nTodo en orden. Capturas en ${CAPTURAS}`)

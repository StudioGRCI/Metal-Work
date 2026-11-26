/**
 * El supervisor sigue cada insumo de sus RQ desde «RQ por unidad» (Plan 1,
 * entrega 1.2; migración 20261126332000).
 *
 * Arma en el banco, con el supervisor de Maestranza y una unidad del padrón:
 *   - un RQ en compra con tres insumos: uno que Almacén tenía (y del que ya
 *     sacó una parte, con quién lo recibió), uno en una OC aprobada que se
 *     espera en cuatro días, y uno por comprar;
 *   - un RQ que se pasa del metrado de Diseño y espera el sustento;
 *   - un RQ ya entregado, con quién lo recibió.
 * Emite cada RQ con la cuenta del supervisor y el metrado con la de Diseño; el
 * resto del circuito (la revisión, la OC, la salida) se pone por SQL, que ya
 * lo prueba el check 474 con cada puesto.
 *
 * Comprueba, a 390 y a 1440, con la cuenta del supervisor:
 *   1. Cada RQ abre «Cómo va cada insumo» y cada insumo dice su paso, de
 *      principio a fin, con el que va ahora marcado.
 *   2. El que espera su compra dice cuándo llega; el que salió, quién lo
 *      recibió; el que se pasa del metrado, que falta el sustento.
 *   3. De la compra no sale el proveedor ni el precio.
 *   4. El supervisor de Acabados no ve esos RQ, ni en la pantalla ni en la
 *      base; Ventas no entra a la función.
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

/** Escribe sin disparadores: el armazón del circuito que ya prueba el check 474. */
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
const [mtz] = await consulta(`select id, area_id from public.usuarios where correo = $1`, [correoDe('sup.mtz')])
const [almacen] = await consulta(`select id from public.usuarios where correo = $1`, [correoDe('almacen')])
const [logistica] = await consulta(`select id from public.usuarios where correo = $1`, [correoDe('logistica')])

// Una unidad del padrón que sigue en el taller, como la ve el supervisor. El
// banco no trae ninguna con código interno: se registra una, la misma en cada corrida.
await armazon(
  `insert into public.unidades (placa, marca, modelo, codigo_interno)
   select 'Q1A-124', 'VOLVO', 'FMX 440 (prueba 1.2)', 'QA-SEGUIMIENTO'
    where not exists (select 1 from public.unidades where codigo_interno = 'QA-SEGUIMIENTO')`,
)
// Otra para el insumo que se revisó antes de que cambiara el metrado: la
// tarjeta enseña tres RQ en camino y la primera ya tiene los suyos.
await armazon(
  `insert into public.unidades (placa, marca, modelo, codigo_interno)
   select 'Q1A-125', 'VOLVO', 'FMX 440 (prueba 1.2, revisado)', 'QA-SEGUIMIENTO-B'
    where not exists (select 1 from public.unidades where codigo_interno = 'QA-SEGUIMIENTO-B')`,
)
const codigos = await comoCuenta(
  'sup.mtz',
  `select codigo from public.codigos_internos_para_elegir() where registrada and not cerrado and codigo in ('QA-SEGUIMIENTO', 'QA-SEGUIMIENTO-B') order by codigo`,
)
if (codigos.length < 2) throw new Error('El banco no tiene las unidades de prueba en el padrón: corre preparar.sh.')
const codigo = codigos[0].codigo
const codigoB = codigos[1].codigo
const material = async (sql, cual = 0) =>
  (await consulta(`select m.id from public.materiales m join public.categorias_material c on c.id = m.categoria_id where m.activo and ${sql} order by m.codigo limit 1 offset ${cual}`))[0]?.id
const plancha = await material(`c.almacen = 'MATERIA_PRIMA' and m.descripcion ilike 'plancha%'`)
const tubo = await material(`c.almacen = 'MATERIA_PRIMA' and m.descripcion ilike 'tubo%'`)
const conos = await material(`c.almacen = 'ACCESORIOS'`)
const disco = await material(`c.almacen = 'CONSUMIBLES'`)
const guantes = await material(`c.almacen = 'CONSUMIBLES'`, 1)
if (![plancha, tubo, conos, disco, guantes].every(Boolean)) throw new Error('El banco no tiene los materiales de prueba (plancha, tubo, un accesorio y un consumible).')

// Diseño metra 10 planchas para la unidad (una vez: en otra corrida ya están).
const yaMetrado = await consulta(`select 1 from public.codigo_materiales where codigo_interno = $1 and material_id = $2 and quitado_en is null`, [codigo, plancha])
if (yaMetrado.length === 0)
  await comoCuenta('diseno', `select public.guardar_material_codigo(null, $1, $2, 10, null, $3)`, [codigo, plancha, `Metrado de prueba ${sello}`])
const yaMetradoB = await consulta(`select 1 from public.codigo_materiales where codigo_interno = $1 and material_id = $2 and quitado_en is null`, [codigoB, plancha])
if (yaMetradoB.length === 0)
  await comoCuenta('diseno', `select public.guardar_material_codigo(null, $1, $2, 10, null, $3)`, [codigoB, plancha, `Metrado de prueba ${sello}`])

const ids = { compra: randomUUID(), metrado: randomUUID(), ajeno: randomUUID(), entregado: randomUUID(), faltante: randomUUID(), revisado: randomUUID() }
const linea = (material_id, cantidad) => ({ material_id, cantidad })
const emitir = (id, justificacion, lineas, delCodigo = codigo) =>
  comoCuenta('sup.mtz', `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, $4, null, $5::jsonb)`, [
    id, mtz.area_id, delCodigo, justificacion, JSON.stringify(lineas),
  ])
await emitir(ids.compra, `${sello} Tubos, conos y discos para el armado`, [linea(tubo, 6), linea(conos, 4), linea(disco, 10), linea(guantes, 2)])
await emitir(ids.metrado, `${sello} Planchas para el refuerzo del piso`, [linea(plancha, 500)])
await emitir(ids.entregado, `${sello} Conos para delimitar la zona`, [linea(conos, 2)])
await emitir(ids.faltante, `${sello} Conos y guantes para el pintado`, [linea(conos, 2), linea(guantes, 3)])
await emitir(ids.revisado, `${sello} Planchas revisadas antes del metrado`, [linea(plancha, 300)], codigoB)
// Requerimientos registra para Maestranza uno que se pasa del metrado: el
// sustento lo escribe quien lo registró, no el supervisor.
await comoCuenta('requerimientos', `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, $4, null, $5::jsonb)`, [
  ids.ajeno, mtz.area_id, codigo, `${sello} Planchas que pidió Requerimientos`, JSON.stringify([linea(plancha, 400)]),
])
const numeros = Object.fromEntries(
  (await consulta(`select id, numero from public.requerimientos where id = any($1)`, [Object.values(ids)])).map((r) => [r.id, r.numero]),
)
const hoy = (await consulta(`select (now() at time zone 'America/Lima')::date::text as d`))[0].d
const llega = (await consulta(`select ((now() at time zone 'America/Lima')::date + 4)::text as d`))[0].d
const seEsperaba = (await consulta(`select ((now() at time zone 'America/Lima')::date - 2)::text as d`))[0].d

// El RQ en compra: Almacén revisó (tenía los discos), Logística compró los
// tubos en una OC aprobada que llega en cuatro días, los conos siguen por
// comprar. Del almacén salieron 4 discos a una persona.
const oc = randomUUID()
await armazon(
  `update public.requerimientos set estado = 'EN_ATENCION', revision_stock_en = now(), en_atencion_en = now() where id = $1`,
  [ids.compra],
)
await armazon(
  `update public.requerimiento_lineas set cantidad_en_stock = case when item in (3, 4) then cantidad else 0 end,
          stock_revisado_en = now(), stock_revisado_por = $2
    where requerimiento_id = $1`,
  [ids.compra, almacen.id],
)
await armazon(
  `insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, aprobacion, aprobado_por, aprobado_en, creado_por, fecha_estimada)
   values ($1, $2, $3, $4, 'APROBADA', $5, now(), $5, $6::date)`,
  [oc, ids.compra, proveedor, `REF-${sello}`, logistica.id, llega],
)
await armazon(
  `update public.requerimiento_lineas set orden_compra_id = $2, atendida_en = now(), atendida_por = $3 where requerimiento_id = $1 and item = 1`,
  [ids.compra, oc, logistica.id],
)
// Los conos ya van en una OC que Gerencia no aprueba todavía, y Logística la
// esperaba hace dos días: no se promete una fecha que pasó.
const ocPorAprobar = randomUUID()
await armazon(
  `insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, aprobacion, creado_por, fecha_estimada)
   values ($1, $2, $3, $4, 'POR_APROBAR', $5, $6::date)`,
  [ocPorAprobar, ids.compra, proveedor, `REF-${sello}-2`, logistica.id, seEsperaba],
)
await armazon(
  `update public.requerimiento_lineas set orden_compra_id = $2, atendida_en = now(), atendida_por = $3 where requerimiento_id = $1 and item = 2`,
  [ids.compra, ocPorAprobar, logistica.id],
)

// Las planchas de la otra unidad: Almacén las revisó y Logística las compró,
// y después el RQ pasó a este código (`codigo_desde`), donde se pasan del
// metrado sin sustento: la revisión ya no las cubre (`metrado_por_linea`).
// Siguen su camino, no salen del almacén sin el visto, y su OC se esperaba
// hace dos días.
const ocRevisado = randomUUID()
await armazon(
  `update public.requerimientos set estado = 'EN_ATENCION', revision_stock_en = now() - interval '1 hour',
          en_atencion_en = now() - interval '1 hour', codigo_desde = now()
    where id = $1`,
  [ids.revisado],
)
await armazon(
  `update public.requerimiento_lineas set cantidad_en_stock = 0, stock_revisado_en = now(), stock_revisado_por = $2 where requerimiento_id = $1`,
  [ids.revisado, almacen.id],
)
await armazon(
  `insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, aprobacion, aprobado_por, aprobado_en, creado_por, fecha_estimada)
   values ($1, $2, $3, $4, 'APROBADA', $5, now(), $5, $6::date)`,
  [ocRevisado, ids.revisado, proveedor, `REF-${sello}-3`, logistica.id, seEsperaba],
)
await armazon(
  `update public.requerimiento_lineas set orden_compra_id = $2, atendida_en = now(), atendida_por = $3 where requerimiento_id = $1`,
  [ids.revisado, ocRevisado, logistica.id],
)

const salida = (rq, item, material_id, cantidad, quien) =>
  armazon(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                               requerimiento_linea_id, codigo_unidad, registrado_por, registrado_en)
     select gen_random_uuid(), 'SALIDA', $3, $4, 'SALIDA_GENERAL', $5, $6,
            (select l.id from public.requerimiento_lineas l where l.requerimiento_id = $1 and l.item = $2), $7, $8, now()`,
    [rq, item, material_id, cantidad, `Salida ${sello}`, quien, codigo, almacen.id],
  )
await salida(ids.compra, 3, disco, 4, `Juan Quispe ${sello}`)
await salida(ids.compra, 4, guantes, 2, `Luis Mamani ${sello}`)

// El entregado: Almacén lo tenía y ya lo entregó. Todo después de emitirlo, como en el taller: la revisión de antes del RQ no cuenta para el metrado.
await armazon(
  `update public.requerimientos set estado = 'ENTREGADO', revision_stock_en = now(), listo_en_almacen_en = now(),
          entregado_en = now(), entregado_por = $2
    where id = $1`,
  [ids.entregado, almacen.id],
)
await armazon(
  `update public.requerimiento_lineas set cantidad_en_stock = cantidad, stock_revisado_en = now(), stock_revisado_por = $2 where requerimiento_id = $1`,
  [ids.entregado, almacen.id],
)
await salida(ids.entregado, 1, conos, 2, `Rosa Huamán ${sello}`)

// El entregado con faltante: salieron los conos; los guantes ya no hacían falta y no salieron del kardex.
await armazon(
  `update public.requerimientos set estado = 'ENTREGADO', revision_stock_en = now(), listo_en_almacen_en = now(),
          entregado_en = now(), entregado_por = $2, faltante_al_entregar = true, motivo_del_faltante = 'Los guantes ya no hacen falta (prueba)'
    where id = $1`,
  [ids.faltante, almacen.id],
)
await armazon(
  `update public.requerimiento_lineas set cantidad_en_stock = cantidad, stock_revisado_en = now(), stock_revisado_por = $2,
          sin_salida_al_entregar = case when item = 2 then cantidad end
    where requerimiento_id = $1`,
  [ids.faltante, almacen.id],
)
await salida(ids.faltante, 1, conos, 2, `Elsa Rojas ${sello}`)

// ------------------------------------------------ la base, con cada cuenta
const desde = async (puesto) =>
  comoCuenta(puesto, `select requerimiento_id, item, visto_diseno, fecha_esperada::text, recibido_por from public.seguimiento_de_insumos($1)`, [
    Object.values(ids),
  ])
const delSupervisor = await desde('sup.mtz')
const fila = (rq, item) => delSupervisor.find((f) => f.requerimiento_id === rq && f.item === item)
comprobar(delSupervisor.length === 10, `la base le da al supervisor sus 10 insumos, también los del RQ que registró Requerimientos (${delSupervisor.length})`)
comprobar(fila(ids.revisado, 1)?.visto_diseno === 'SIN_SUSTENTO', `las planchas ya revisadas siguen sin su sustento: ${fila(ids.revisado, 1)?.visto_diseno}`)
comprobar(fila(ids.compra, 1)?.fecha_esperada === llega, `el tubo se espera el ${llega}: ${fila(ids.compra, 1)?.fecha_esperada}`)
comprobar(fila(ids.compra, 3)?.recibido_por === `Juan Quispe ${sello}`, 'los discos los recibió Juan')
comprobar(fila(ids.metrado, 1)?.visto_diseno === 'SIN_SUSTENTO', `las planchas se pasan del metrado y esperan su sustento: ${fila(ids.metrado, 1)?.visto_diseno}`)
comprobar((await desde('sup.acb')).length === 0, 'el supervisor de Acabados no recibe nada de esos RQ')
let ventas = null
try {
  await desde('ventas')
} catch (e) {
  ventas = String(e.message)
}
comprobar(ventas?.includes('No tienes permiso') ?? false, `Ventas no entra a la función (${ventas ?? 'entró'})`)

// ------------------------------------------------ la pantalla
const ruta = `/requerimientos/unidades?q=${encodeURIComponent(codigo)}`
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar('sup.mtz', ancho)
  await ir(pagina, ruta)
  const rq = (id) => pagina.locator(`[data-rq-de-la-unidad="${numeros[id]}"]`)
  for (const id of Object.values(ids).filter((x) => x !== ids.revisado))
    comprobar((await rq(id).count()) === 1, `${ancho}: ${numeros[id]} sale en la tarjeta de ${codigo}`)
  // Se abre cada «Cómo va cada insumo».
  for (const id of Object.values(ids)) {
    const pliegue = rq(id).locator('[data-insumos-del-rq] > summary')
    if ((await pliegue.count()) === 1) await pliegue.click()
  }
  const insumo = (id, item) => rq(id).locator(`[data-insumo="${item}"]`)
  const paso = async (id, item) => insumo(id, item).getAttribute('data-paso')
  const texto = async (id, item) => limpio(await insumo(id, item).innerText())

  comprobar((await paso(ids.compra, 1)) === 'EN_CAMINO', `${ancho}: el tubo va en camino (${await paso(ids.compra, 1)})`)
  comprobar((await texto(ids.compra, 1)).includes(`Llega aprox. el ${ddmm(llega)}`), `${ancho}: el tubo dice cuándo llega: «${await texto(ids.compra, 1)}»`)
  comprobar((await paso(ids.compra, 2)) === 'EN_COMPRA', `${ancho}: los conos van en compra (${await paso(ids.compra, 2)})`)
  comprobar((await texto(ids.compra, 2)).includes(`Logística lo esperaba el ${ddmm(seEsperaba)}`) && !(await texto(ids.compra, 2)).includes('llega aprox.'),
    `${ancho}: la OC por aprobar con la fecha pasada no promete un día que ya pasó: «${await texto(ids.compra, 2)}»`)
  comprobar((await paso(ids.compra, 3)) === 'EN_ALMACEN', `${ancho}: los discos están en almacén (${await paso(ids.compra, 3)})`)
  const pasosDisco = await insumo(ids.compra, 3).locator('[data-paso-del-insumo]').evaluateAll((e) => e.map((x) => x.getAttribute('data-paso-del-insumo')))
  comprobar(!pasosDisco.includes('EN_COMPRA') && !pasosDisco.includes('EN_CAMINO'), `${ancho}: los discos que tenía Almacén no pasan por la compra: ${pasosDisco.join(' > ')}`)
  comprobar((await texto(ids.compra, 3)).includes(`Salieron 4 de 10`) && (await texto(ids.compra, 3)).includes(`los recibió Juan Quispe ${sello}`),
    `${ancho}: de los discos salió una parte, y dice cuánto y quién: «${await texto(ids.compra, 3)}»`)
  comprobar((await paso(ids.compra, 4)) === 'ENTREGADO' && (await texto(ids.compra, 4)).includes(`Lo recibió Luis Mamani ${sello}`),
    `${ancho}: el insumo que salió entero va entregado aunque otro del RQ siga en compra: «${await texto(ids.compra, 4)}»`)
  const resumenCompra = limpio(await rq(ids.compra).locator('[data-resumen-de-insumos]').innerText())
  comprobar(resumenCompra.includes('1 en compra') && resumenCompra.includes(`llega aprox. el ${ddmm(llega)}`),
    `${ancho}: cerrado, el pliegue ya dice en qué va cada insumo y cuándo llega: «${resumenCompra}»`)
  const pasosTubo = await insumo(ids.compra, 1).locator('[data-paso-del-insumo]').evaluateAll((e) =>
    e.map((x) => `${x.getAttribute('data-paso-del-insumo')}${x.getAttribute('aria-current') ? '*' : ''}`),
  )
  comprobar(pasosTubo.join(' > ') === 'POR_ATENDER > EN_COMPRA > EN_CAMINO* > EN_ALMACEN > ENTREGADO', `${ancho}: el tubo, de principio a fin: ${pasosTubo.join(' > ')}`)

  comprobar((await paso(ids.metrado, 1)) === 'VISTO_DISENO', `${ancho}: las planchas esperan el visto de Diseño (${await paso(ids.metrado, 1)})`)
  comprobar((await texto(ids.metrado, 1)).includes('falta el sustento'), `${ancho}: dicen que falta el sustento: «${await texto(ids.metrado, 1)}»`)
  const resumenMetrado = limpio(await rq(ids.metrado).locator('[data-resumen-de-insumos]').innerText())
  comprobar(resumenMetrado.includes('Falta tu sustento para Diseño'), `${ancho}: cerrado, el pliegue ya dice que falta su sustento: «${resumenMetrado}»`)
  comprobar((await rq(ids.metrado).locator(`[data-pide-sustento] a[href="/requerimientos?rq=${ids.metrado}"]`).count()) === 1,
    `${ancho}: y lleva al RQ para escribirlo`)

  // El que registró Requerimientos: espera el sustento, pero no se le pide al supervisor.
  const resumenAjeno = limpio(await rq(ids.ajeno).locator('[data-resumen-de-insumos]').innerText())
  comprobar(resumenAjeno.includes('Espera el sustento para Diseño') && !resumenAjeno.includes('tu sustento'),
    `${ancho}: en el RQ de Requerimientos no le pide su sustento: «${resumenAjeno}»`)
  comprobar((await rq(ids.ajeno).locator('[data-pide-sustento]').count()) === 0 && (await rq(ids.ajeno).locator('[data-espera-sustento]').count()) === 1,
    `${ancho}: y dice que espera el de quien lo registró, sin el enlace`)

  // El entregado con faltante: los guantes no salieron y no se pintan entregados.
  comprobar((await insumo(ids.faltante, 2).getAttribute('data-faltante')) === '3', `${ancho}: los guantes del entregado con faltante no salieron (3)`)
  comprobar((await texto(ids.faltante, 2)).includes('Entregado con faltante: no salió 3'), `${ancho}: y lo dice: «${await texto(ids.faltante, 2)}»`)
  const barraGuantes = await insumo(ids.faltante, 2).locator('[data-paso-del-insumo="ENTREGADO"] > span').first().getAttribute('class')
  comprobar(!barraGuantes.includes('bg-exito') && barraGuantes.includes('bg-aviso'), `${ancho}: su paso «Entregado» no va en verde`)
  comprobar((await insumo(ids.faltante, 1).getAttribute('data-faltante')) === null && (await texto(ids.faltante, 1)).includes(`Lo recibió Elsa Rojas ${sello}`),
    `${ancho}: los conos del mismo RQ sí salieron: «${await texto(ids.faltante, 1)}»`)

  comprobar((await paso(ids.entregado, 1)) === 'ENTREGADO', `${ancho}: el entregado de esta semana sigue en la tarjeta, entregado (${await paso(ids.entregado, 1)})`)
  comprobar((await texto(ids.entregado, 1)).includes(`Lo recibió Rosa Huamán ${sello}`), `${ancho}: y dice quién lo recibió: «${await texto(ids.entregado, 1)}»`)
  const pasosEntregado = await insumo(ids.entregado, 1).locator('[data-paso-del-insumo]').evaluateAll((e) => e.map((x) => x.getAttribute('data-paso-del-insumo')))
  comprobar(pasosEntregado.join(' > ') === 'POR_ATENDER > EN_ALMACEN > ENTREGADO', `${ancho}: lo que Almacén tenía no aparece como comprado: ${pasosEntregado.join(' > ')}`)

  const todo = await pagina.locator('main').innerText()
  comprobar(!todo.includes(proveedor) && !todo.includes(`REF-${sello}`), `${ancho}: de la compra no sale el proveedor ni su referencia`)
  comprobar(!/S\/\s?\d/.test(todo), `${ancho}: ningún precio en la pantalla`)
  await sinDesborde(pagina, `${ancho} ${ruta}`)
  // Con la tarjeta a la vista, para la captura.
  await rq(ids.compra).scrollIntoViewIfNeeded()
  await capturar(pagina, `1-2-supervisor-${ancho}-rq-por-unidad.png`)

  // La otra unidad: las planchas ya revisadas y compradas que se pasan del metrado.
  await ir(pagina, `/requerimientos/unidades?q=${encodeURIComponent(codigoB)}`)
  comprobar((await rq(ids.revisado).count()) === 1, `${ancho}: ${numeros[ids.revisado]} sale en la tarjeta de ${codigoB}`)
  const pliegueB = rq(ids.revisado).locator('[data-insumos-del-rq] > summary')
  const resumenB = limpio(await rq(ids.revisado).locator('[data-resumen-de-insumos]').innerText())
  comprobar(resumenB.includes('Falta tu sustento para Diseño') && resumenB.includes(`se esperaba el ${ddmm(seEsperaba)}`) && !resumenB.includes('llega aprox.'),
    `${ancho}: cerrado, dice que falta su sustento y que se esperaba, sin prometer una fecha pasada: «${resumenB}»`)
  if ((await pliegueB.count()) === 1) await pliegueB.click()
  const pasoB = await insumo(ids.revisado, 1).getAttribute('data-paso')
  comprobar(pasoB !== 'VISTO_DISENO' && pasoB !== 'EN_COMPRA', `${ancho}: las planchas siguen su camino, no vuelven al visto (${pasoB})`)
  comprobar((await insumo(ids.revisado, 1).locator('[data-frena-la-salida]').count()) === 1 && (await texto(ids.revisado, 1)).includes('No sale del almacén hasta que Diseño lo autorice'),
    `${ancho}: y dicen que no salen sin el visto: «${await texto(ids.revisado, 1)}»`)
  comprobar((await rq(ids.revisado).locator(`[data-pide-sustento] a[href="/requerimientos?rq=${ids.revisado}"]`).count()) === 1, `${ancho}: y le piden su sustento con el enlace`)
  await sinDesborde(pagina, `${ancho} ${codigoB}`)
  await capturar(pagina, `1-2-supervisor-${ancho}-revisado-sin-sustento.png`)
  await contexto.close()
}

{
  const { pagina, contexto } = await entrar('sup.acb', 390)
  await ir(pagina, ruta)
  const ve = await pagina.locator(Object.values(ids).map((id) => `[data-rq-de-la-unidad="${numeros[id]}"]`).join(', ')).count()
  comprobar(ve === 0, `sup.acb: no ve los RQ de Maestranza (${ve})`)
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
if (fallas.length) {
  console.error(`\n${fallas.length} fallan.`)
  process.exit(1)
}
console.log(`\nTodo en orden. Capturas en ${CAPTURAS}`)

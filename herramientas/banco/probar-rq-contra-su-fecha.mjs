/**
 * Clic real sobre el plan 3, entrega 3.1: el RQ contra la fecha en que se
 * necesita y el aviso cuando llega lo comprado (migración 20261126400000).
 * Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Siembra, con el rol de cada puesto, cuatro RQ de Requerimientos: uno
 *      vencido hace tres días (Almacén tiene un insumo, Logística compra los
 *      otros dos, el conductor los deja en Almacén y Almacén valida la mitad de
 *      uno y el otro entero), uno para hoy, uno para dentro de dos días y otro
 *      para dentro de doce. Solo la fecha del vencido se corre como dueño: la
 *      base no deja pedir para atrás.
 *   2. La campana: a Requerimientos le llega un solo «Llegó a almacén» por esa
 *      recepción, con cuánto entró de cada insumo, y lo ve en /avisos.
 *   3. Requerimientos ve en cada RQ cuánto le falta o cuánto lleva vencido, y en
 *      el vencido qué insumos lo tienen así. Las pastillas «Se necesita esta
 *      semana» y «Vencido sin atender» dejan solo los que cumplen, con su cifra.
 *      El supervisor de Maestranza ve lo mismo en los de su área.
 *   4. Portería no entra a Requerimientos.
 *   5. En el teléfono (390) nada se sale. Capturas en 390 y 1440.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Corre `sql` con la sesión de esa cuenta y el rol authenticated, dentro de la transacción abierta. */
async function como(puesto, sql, valores = []) {
  const [cuenta] = await consulta('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query(`select set_config('request.jwt.claim.sub', $1, true),
    set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
  await base.query('set local role authenticated')
  try {
    return (await base.query(sql, valores)).rows
  } finally {
    // Con la transacción ya caída esto también falla: que no tape el error de verdad.
    await base.query('reset role').catch(() => {})
  }
}

// ------------------------------------------------ 1. La siembra, con el rol de cada puesto
const ids = { v: randomUUID(), h: randomUUID(), s: randomUUID(), l: randomUUID(), oc: randomUUID() }
const marca = `sonda 3.1 ${ids.v.slice(0, 4)}`
const [{ hoy }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as hoy`)
const materiales = (await consulta('select id from public.materiales where activo order by codigo limit 6')).map((m) => m.id)
const area = async (codigo) => (await consulta('select id from public.areas where codigo = $1', [codigo]))[0].id
const enDias = (n) => {
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

await base.query('begin')
try {
  const pedir = (id, areaId, que, fecha, lineas) =>
    como('requerimientos', `select public.emitir_requerimiento($1, 'OPERACION', $2, 'PLANTA', $3, $4, $5::jsonb)`, [
      id, areaId, `${que} (${marca})`, fecha, JSON.stringify(lineas),
    ])
  await pedir(ids.v, await area('MTZ'), 'Planchas y discos para el refuerzo de la tolva', hoy, [
    { material_id: materiales[1], cantidad: 6 },
    { material_id: materiales[2], cantidad: 4 },
    { material_id: materiales[3], cantidad: 2 },
  ])
  await pedir(ids.h, await area('PRD'), 'Bisagras para las puertas del furgón', hoy, [{ material_id: materiales[4], cantidad: 8 }])
  await pedir(ids.s, await area('ACB'), 'Pintura y lija para el acabado', enDias(2), [{ material_id: materiales[5], cantidad: 3 }])
  await pedir(ids.l, await area('MTZ'), 'Ejes para la próxima tolva', enDias(12), [{ material_id: materiales[0], cantidad: 2 }])
  // Se pidió hace una semana para hace tres días: solo como dueño, la base no deja pedir para atrás.
  await base.query(`set local session_replication_role = replica`)
  await base.query(`update public.requerimientos set fecha_requerida = $2, creado_en = now() - interval '7 days' where id = $1`, [ids.v, enDias(-3)])
  await base.query(`set local session_replication_role = origin`)

  await como('almacen', `select public.rq_revisar_stock($1, '[{"item":1,"en_stock":0},{"item":2,"en_stock":4},{"item":3,"en_stock":0}]', null)`, [ids.v])
  const linea = async (item) => (await consulta('select id from public.requerimiento_lineas where requerimiento_id = $1 and item = $2', [ids.v, item]))[0].id
  let [proveedor] = await consulta(`select id from public.proveedores where activo order by razon_social limit 1`)
  if (!proveedor) {
    ;[proveedor] = await consulta(`insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
      values ('20100000011', 'ACEROS DEL SUR S.A.C.', 'Av. Argentina 457, Lima', '999 111 222') returning id`)
  }
  await como('logistica', `select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, $4, null, 'CONTADO', 0, 'PEN', true)`, [
    ids.oc,
    JSON.stringify([
      { material_id: materiales[1], cantidad: 6, precio: 10, insumos: [await linea(1)] },
      { material_id: materiales[3], cantidad: 2, precio: 30, insumos: [await linea(3)] },
    ]),
    proveedor.id,
    `Cotización ${marca}`,
  ])
  await base.query('set constraints all immediate')
  await base.query('set constraints all deferred')
  await como('gerencia', 'select public.aprobar_compra($1)', [ids.oc])
  // El conductor la recoge y la deja en Almacén, con sus roles.
  await como('logistica', 'select public.programar_recojo($1, 30, null)', [ids.oc])
  await como('conductor', 'select public.marcar_compra_recogida($1)', [ids.oc])
  await como('conductor', 'select public.marcar_compra_dejada_almacen($1)', [ids.oc])
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}
// Almacén valida en una sola recepción 3 de las 6 planchas y los 2 del insumo 3,
// en su propia transacción: el aviso sale al cerrarla, uno solo con los dos insumos.
await base.query('begin')
try {
  await como('almacen', `select public.validar_ingresos_compra($1, (
      select jsonb_agg(jsonb_build_object('id', p.id, 'movimiento_id', gen_random_uuid(),
               'cantidad', case when p.material_id = $2 then 3 else p.cantidad end,
               'observacion', case when p.material_id = $2 then 'Llegaron 3, el resto llega el viernes' end))
        from public.ingresos_pendientes_almacen p where p.orden_compra_id = $1), 'GR 001-123')`, [ids.oc, materiales[1]])
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}
const [{ numero: vencido }] = await consulta('select numero from public.requerimientos where id = $1', [ids.v])
const numeros = Object.fromEntries(
  (await consulta('select id, numero from public.requerimientos where id = any($1)', [[ids.v, ids.h, ids.s, ids.l]])).map((r) => [r.id, r.numero]),
)

// ------------------------------------------------ 2. La campana
await base.query('begin')
const avisos = await como('requerimientos', `select titulo, cuerpo, ruta from public.notificaciones where origen_id = $1 and titulo like 'Llegó a almacén:%'`, [ids.v])
await base.query('rollback')
comprobar(avisos.length === 1 && avisos[0].ruta === `/requerimientos?rq=${ids.v}`,
  `a Requerimientos le llega un solo «Llegó a almacén» del ${vencido} por la recepción de dos materiales, que abre solo ese RQ (${avisos.length})`)
comprobar(/: 3 \S+ del insumo 1, .*; 2 \S+ del insumo 3, .*\(.+\)\. Mira en el RQ cuánto ya puedes recoger\.$/.test(avisos[0]?.cuerpo ?? ''),
  `y dice cuánto entró de cada insumo: «${avisos[0]?.cuerpo}»`)

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

async function capturar(pagina, archivo) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  const ventana = pagina.viewportSize()
  const alto = await pagina.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  await pagina.setViewportSize({ width: ventana.width, height: Math.min(Math.max(alto, ventana.height), 6000) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

/** De cada tarjeta a la vista: su número, la insignia del plazo y su número de días. */
const tarjetas = (pagina) =>
  pagina.locator('[data-rq]').evaluateAll((es) =>
    es.map((e) => {
      const i = e.querySelector('[data-plazo]')
      return { numero: e.dataset.rq, plazo: i ? Number(i.dataset.plazo) : null, texto: i?.textContent?.trim() ?? null }
    }),
  )

// ------------------------------------------------ 3. Lo que ve Requerimientos
{
  const { pagina, contexto } = await entrar('requerimientos')
  await ir(pagina, '/requerimientos')
  const todas = await tarjetas(pagina)
  const de = (id) => todas.find((t) => t.numero === numeros[id])
  comprobar(de(ids.v)?.texto === 'Vencido hace 3 días', `el ${numeros[ids.v]} dice «Vencido hace 3 días» (${de(ids.v)?.texto})`)
  comprobar(de(ids.h)?.texto === 'Se necesita hoy', `el ${numeros[ids.h]} dice «Se necesita hoy» (${de(ids.h)?.texto})`)
  comprobar(de(ids.s)?.texto === 'Faltan 2 días', `el ${numeros[ids.s]} dice «Faltan 2 días» (${de(ids.s)?.texto})`)
  comprobar(de(ids.l)?.texto === 'Faltan 12 días', `el ${numeros[ids.l]} dice «Faltan 12 días» (${de(ids.l)?.texto})`)
  const loVencido = (await pagina.locator(`[data-lo-vencido="${vencido}"]`).textContent())?.replace(/\s+/g, ' ').trim()
  comprobar(
    loVencido === `Se necesitaba el ${enDias(-3).split('-').reverse().join('/')}. Lo que falta: los insumos 1, 2 y 3, para recoger en Almacén; el insumo 1, por llegar.`,
    `el vencido dice qué insumos lo tienen así: «${loVencido}»`,
  )
  comprobar((await pagina.locator('[data-lo-vencido]').count()) === todas.filter((t) => t.plazo !== null && t.plazo < 0).length,
    'solo los vencidos llevan la línea de lo que los atrasa')

  // Las pastillas: con su cifra, y cada una deja solo lo suyo.
  const domingo = (7 - new Date(`${hoy}T12:00:00Z`).getUTCDay()) % 7
  for (const [valor, nombre, cumple] of [
    ['vencidos', 'Vencido sin atender', (p) => p !== null && p < 0],
    ['semana', 'Se necesita esta semana', (p) => p !== null && p >= 0 && p <= domingo],
  ]) {
    const esperados = todas.filter((t) => cumple(t.plazo)).map((t) => t.numero).sort()
    const pastilla = pagina.locator('[role="group"][aria-label="Por la fecha en que se necesita"] a', { hasText: nombre })
    comprobar((await pastilla.textContent())?.trim() === `${nombre} (${esperados.length})`, `la pastilla «${nombre}» cuenta ${esperados.length}`)
    await Promise.all([pagina.waitForURL((u) => u.searchParams.get('plazo') === valor), pastilla.click()])
    await conReact(pagina)
    const vistos = (await tarjetas(pagina)).map((t) => t.numero).sort()
    comprobar(JSON.stringify(vistos) === JSON.stringify(esperados), `«${nombre}» deja solo esos: ${vistos.join(', ')}`)
    await capturar(pagina, `rq-filtro-${valor}-1440.png`)
    await ir(pagina, '/requerimientos')
  }
  comprobar(
    (await tarjetas(pagina)).filter((t) => [ids.h, ids.s].map((i) => numeros[i]).includes(t.numero)).length === 2,
    'sin pastilla, los de hoy y de pasado mañana siguen en la lista entera',
  )

  // La campana lleva a ese RQ.
  await ir(pagina, '/avisos')
  comprobar((await pagina.getByText(`Llegó a almacén: ${vencido}`).count()) > 0, 'el aviso «Llegó a almacén» está en /avisos')
  await ir(pagina, `/requerimientos?rq=${ids.v}`)
  comprobar((await tarjetas(pagina)).map((t) => t.numero).join() === vencido, 'el enlace del aviso abre solo ese RQ')
  await contexto.close()
}

// El supervisor de Maestranza lo ve en los de su área.
{
  const { pagina, contexto } = await entrar('sup.mtz')
  await ir(pagina, '/requerimientos')
  const todas = await tarjetas(pagina)
  comprobar(todas.find((t) => t.numero === vencido)?.texto === 'Vencido hace 3 días', 'el supervisor de Maestranza ve el vencido de su área')
  comprobar(todas.every((t) => t.numero !== numeros[ids.h]), 'y no el de Producción en «De tu área»')
  comprobar((await pagina.locator('[role="group"][aria-label="Por la fecha en que se necesita"]').count()) === 1, 'con las mismas pastillas')
  await contexto.close()
}

// ------------------------------------------------ 4. Quien no debe entrar
{
  const { pagina, contexto } = await entrar('porteria')
  await pagina.goto(`${BASE}/requerimientos?plazo=vencidos`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'Portería no entra a Requerimientos')
  await base.query('begin')
  const ajenos = await como('porteria', `select count(*)::int as n from public.notificaciones where titulo like 'Llegó a almacén:%'`)
  await base.query('rollback')
  comprobar(ajenos[0].n === 0, 'ni ve los avisos de «llegó» de otra cuenta')
  await contexto.close()
}

// ------------------------------------------------ 5. Capturas, 390 y 1440
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar('requerimientos', ancho)
  await ir(pagina, `/requerimientos?rq=${ids.v}`)
  await sinDesborde(pagina, `el RQ vencido a ${ancho}`)
  await capturar(pagina, `rq-vencido-${ancho}.png`)
  await ir(pagina, '/requerimientos')
  await sinDesborde(pagina, `la lista a ${ancho}`)
  await capturar(pagina, `rq-lista-${ancho}.png`)
  await ir(pagina, '/requerimientos?plazo=semana')
  await capturar(pagina, `rq-semana-${ancho}.png`)
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola ni de hidratación ${errores.slice(0, 5).join(' | ')}`)

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} cosa(s) no cuadran:\n${fallas.map((f) => ` - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTodo en orden.')

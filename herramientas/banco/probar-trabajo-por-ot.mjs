/**
 * Clic real sobre la migración 20261126320000: el trabajo del colaborador de
 * Diseño reunido por OT, arriba de /ordenes (Plan 7, entrega 7.2). Con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. El colaborador ve «Tu trabajo por OT»: una caja por cada OT donde
 *      anotó algo, primero la de lo último que hizo, con todas las actividades
 *      que su cuenta anotó (leídas de la tabla, no de la función), con día y
 *      tipo; las OT de su equipo sin actividades suyas, juntas en un pliegue. El día lleva a la semana del informe. La lista de OT de siempre
 *      sigue debajo.
 *   2. No ve lo que anotó otro colaborador en la misma OT, y el otro
 *      colaborador ve solo lo suyo.
 *   3. Diseño, que no llena el informe, no ve la tarjeta y la base se la niega.
 *   4. El colaborador no lee la tabla de unidades.
 *   5. En el teléfono (390) nada se sale de la pantalla.
 *
 * Siembra, si faltan, una persona de Diseño en una segunda OT y actividades de
 * semanas pasadas de los dos colaboradores (sin pasar por las reglas: son
 * datos del banco). Se puede correr las veces que haga falta. Deja capturas en
 * CAPTURAS, en 390 y 1440. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * BANCO_BASE (mw_demo), BANCO_CHROMIUM, CAPTURAS.
 */
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Lo que da la base con la sesión de esa cuenta y el rol authenticated, o el error que levanta. */
async function comoCuenta(puesto, sql, valores = []) {
  const cuenta = await uno('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    return { filas: (await base.query(sql, valores)).rows, error: null }
  } catch (e) {
    return { filas: [], error: e.message }
  } finally {
    await base.query('rollback')
  }
}

// 0. Lo sembrado: una segunda OT con persona de Diseño y actividades de semanas
//    pasadas de cada colaborador.
const id = async (puesto) => (await uno('select id from public.usuarios where correo = $1', [correoDe(puesto)]))?.id
const colabId = await id('colaborador')
const colab2Id = await id('colaborador2')
if (!colabId || !colab2Id) throw new Error('Faltan las cuentas colaborador y colaborador2: corre preparar.sh.')
const ots = await consulta(`select id, numero from public.ordenes_trabajo
                             where estado not in ('ANULADA', 'TERMINADA', 'ENTREGADA', 'FACTURADA') order by numero limit 2`)
if (ots.length < 2) throw new Error('El banco necesita dos OT abiertas.')
const persona = []
for (const o of ots) {
  let p = await uno(`select id from public.ot_equipo_diseno where orden_id = $1 and funcion = 'COLABORADOR' order by nombre limit 1`, [o.id])
  if (!p) p = await uno(`insert into public.ot_equipo_diseno (orden_id, nombre, funcion) values ($1, 'Persona de Diseño 7.2', 'COLABORADOR') returning id`, [o.id])
  persona.push(p.id)
}
const SEMBRADAS = [
  [ots[0], persona[0], 'MODELADO_3D', 'Modelado de la baranda 7.2', '2026-11-03', colabId],
  [ots[0], persona[0], 'PLANO_CORTE_DXF', 'Plano de corte de la baranda 7.2', '2026-11-10', colabId],
  [ots[1], persona[1], 'PLOTEO', 'Ploteo del piso 7.2', '2026-11-12', colabId],
  [ots[0], persona[0], 'PLOTEO', 'Del otro colaborador 7.2', '2026-11-13', colab2Id],
]
await base.query('begin')
await base.query('set local session_replication_role = replica')
for (const [o, p, tipo, componente, dia, quien] of SEMBRADAS) {
  if (!(await uno('select 1 from public.diseno_tareas where componente = $1', [componente]))) {
    await base.query(`insert into public.diseno_tareas (orden_id, integrante_id, tipo, componente, fecha_inicio, fecha_entrega, creado_por)
                      values ($1, $2, $3, $4, $5, $5, $6)`, [o.id, p, tipo, componente, dia, quien])
  }
}
await base.query('commit')

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const contexto = await navegador.newContext({
    viewport: ancho <= 480 ? { width: ancho, height: 844 } : { width: ancho, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: ancho <= 480,
    isMobile: ancho <= 480,
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
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }),
    pagina.click('button[type="submit"]'),
  ])
  await pagina.waitForLoadState('networkidle')
  return { pagina, contexto }
}

async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  await conReact(pagina)
}

/**
 * Lo que esa cuenta anotó, leído de la tabla sin RLS y sin pasar por la
 * función que alimenta la pantalla: por OT, en el orden de la pantalla (la de
 * lo último primero). Así la prueba ve también lo que la función dejara fuera.
 */
async function anotadoPor(puesto) {
  const filas = await consulta(`select o.numero, count(*)::int as n, max(t.fecha_inicio)::text as ultima
                                  from public.diseno_tareas t
                                  join public.ordenes_trabajo o on o.id = t.orden_id
                                  join public.usuarios u on u.id = t.creado_por
                                 where u.correo = $1
                                 group by o.numero
                                 order by max(t.fecha_inicio) desc, o.numero`, [correoDe(puesto)])
  return filas
}

/** Las cajas de la tarjeta, abiertas, con sus actividades. */
async function trabajoEnPantalla(pagina) {
  const otras = pagina.locator('[data-trabajo-por-ot] details[data-trabajo-otras]')
  if (await otras.count() && !(await otras.evaluate((d) => d.open))) await otras.locator('summary').first().click()
  const cajas = pagina.locator('[data-trabajo-por-ot] details[data-trabajo-ot]')
  const n = await cajas.count()
  const salida = []
  for (let i = 0; i < n; i++) {
    const caja = cajas.nth(i)
    if (!(await caja.evaluate((d) => d.open))) await caja.locator('summary').click()
    salida.push({
      numero: await caja.getAttribute('data-trabajo-ot'),
      filas: await caja.locator('tr[data-actividad]').count(),
      texto: limpio(await caja.innerText()),
      dias: await caja.locator('tr[data-actividad] a[href*="/diseno/informe-semanal?semana="]').count(),
    })
  }
  return salida
}

// 1 y 2. El colaborador, en el teléfono y en el monitor.
const esperado = await anotadoPor('colaborador')
const vaciasEsperadas = (await comoCuenta('colaborador',
  `select numero from public.trabajo_de_diseno_por_ot() where actividades = '[]'::jsonb order by numero`)).filas.map((f) => f.numero)
for (const ancho of [390, 1440]) {
  const c = await entrar('colaborador', ancho)
  await ir(c.pagina, '/ordenes')
  const tarjeta = c.pagina.locator('[data-trabajo-por-ot]')
  comprobar(await tarjeta.count() === 1, `${ancho}: el colaborador ve «Tu trabajo por OT» en Órdenes`)
  const enPantalla = await trabajoEnPantalla(c.pagina)
  comprobar(
    JSON.stringify(enPantalla.map((o) => `${o.numero}:${o.filas}`)) === JSON.stringify(esperado.map((o) => `${o.numero}:${o.n}`)),
    `${ancho}: las OT y sus actividades son todas las que anotó en la tabla, en su orden (${enPantalla.map((o) => `${o.numero}:${o.filas}`).join(', ')})`,
  )
  const vacias = await c.pagina.locator('[data-trabajo-por-ot] [data-trabajo-ot-vacia]').evaluateAll((li) => li.map((l) => l.dataset.trabajoOtVacia).sort())
  comprobar(JSON.stringify(vacias) === JSON.stringify(vaciasEsperadas),
    `${ancho}: las OT de su equipo sin actividades suyas van juntas en un pliegue (${vacias.join(', ') || 'ninguna'})`)
  if (ancho === 390) {
    const alto = await c.pagina.locator('[data-trabajo-por-ot] tr[data-actividad] a').first().evaluate((a) => a.getBoundingClientRect().height)
    comprobar(alto >= 44, `390: el día se toca con el dedo (${Math.round(alto)} px)`)
  }
  comprobar(enPantalla.every((o) => o.dias === o.filas), `${ancho}: cada día lleva a la semana de su informe`)
  const todo = enPantalla.map((o) => o.texto).join(' ')
  for (const t of ['Modelado de la baranda 7.2', 'Plano de corte de la baranda 7.2', 'Ploteo del piso 7.2']) {
    comprobar(todo.includes(t), `${ancho}: sale «${t}»`)
  }
  comprobar(/Modelado 3D|Modelado/i.test(todo) && /Plano de corte/i.test(todo), `${ancho}: dice el tipo de cada actividad, no su clave`)
  comprobar(!/MODELADO_3D|PLANO_CORTE_DXF/.test(todo), `${ancho}: ninguna clave cruda en pantalla`)
  comprobar(!todo.includes('Del otro colaborador 7.2'), `${ancho}: no sale lo que anotó el otro colaborador en la misma OT`)
  // La lista de OT de siempre sigue debajo de la tarjeta.
  const despues = await tarjeta.evaluate((el) => {
    const lista = document.querySelector('input[type="search"], [data-filtros-ordenes]')
    return lista ? Boolean(el.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING) : null
  })
  comprobar(despues !== false, `${ancho}: los filtros de la lista de OT siguen, debajo de la tarjeta`)
  comprobar(await c.pagina.getByText(ots[0].numero, { exact: false }).count() > 0, `${ancho}: la lista de órdenes sigue en la pantalla`)
  const sobra = await c.pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${ancho}: nada se sale de la pantalla (sobran ${sobra} px)`)
  await c.pagina.screenshot({ path: `${CAPTURAS}/7-2-colaborador-${ancho}-ordenes.png`, fullPage: true })
  if (ancho === 1440) {
    // El día de una actividad abre la semana del informe.
    const enlace = tarjeta.locator('tr[data-actividad] a').first()
    const destino = await enlace.getAttribute('href')
    await Promise.all([c.pagina.waitForURL((u) => u.pathname === '/diseno/informe-semanal', { timeout: 30000 }), enlace.click()])
    comprobar(c.pagina.url().includes(destino ?? '§'), `el día abre su semana en el informe (${destino})`)
  }
  await c.contexto.close()
}

// 2. El otro colaborador ve solo lo suyo.
const esperado2 = await anotadoPor('colaborador2')
const otro = await entrar('colaborador2', 390)
await ir(otro.pagina, '/ordenes')
const deOtro = await trabajoEnPantalla(otro.pagina)
const textoOtro = deOtro.map((o) => o.texto).join(' ')
comprobar(textoOtro.includes('Del otro colaborador 7.2'), 'el otro colaborador ve su actividad')
comprobar(!/Modelado de la baranda 7.2|Ploteo del piso 7.2/.test(textoOtro), 'y no las del primero')
comprobar(deOtro.reduce((s, o) => s + o.filas, 0) === esperado2.reduce((s, o) => s + o.n, 0),
  `sus actividades en pantalla son las de la base (${deOtro.reduce((s, o) => s + o.filas, 0)})`)
await otro.pagina.screenshot({ path: `${CAPTURAS}/7-2-colaborador2-390-ordenes.png`, fullPage: true })
await otro.contexto.close()

// 3. Diseño no llena el informe: ni la tarjeta ni la función.
const diseno = await entrar('diseno')
await ir(diseno.pagina, '/ordenes')
comprobar(await diseno.pagina.locator('[data-trabajo-por-ot]').count() === 0, 'Diseño no ve «Tu trabajo por OT»')
await diseno.contexto.close()
const negado = await comoCuenta('diseno', 'select * from public.trabajo_de_diseno_por_ot()')
comprobar(Boolean(negado.error?.includes('Solo quien llena el informe')), 'la base se la niega a Diseño')
const negadoRrhh = await comoCuenta('rrhh', 'select * from public.trabajo_de_diseno_por_ot()')
comprobar(Boolean(negadoRrhh.error?.includes('Solo quien llena el informe')), 'y a Recursos Humanos')

// 3b. Si su puesto pierde el permiso de leer las actividades, la tarjeta dice
//     el porqué y la lista sigue. Se le quita un momento en el banco y se devuelve.
const quitados = (await consulta(`delete from public.roles_permisos rp using public.roles r
  where r.id = rp.rol_id and r.codigo = 'DISENO_COLABORADOR'
    and rp.permiso_codigo in ('diseno.planos', 'diseno.subir_pdf', 'supervision.general', 'diseno.ver_informes')
  returning rp.rol_id, rp.permiso_codigo`))
try {
  const sinPermiso = await entrar('colaborador', 390)
  await ir(sinPermiso.pagina, '/ordenes')
  const aviso = limpio(await sinPermiso.pagina.locator('[data-trabajo-por-ot] [role="status"]').innerText().catch(() => ''))
  comprobar(aviso.includes('no puede leer sus actividades') && aviso.includes('avisa al administrador'),
    `sin permiso de lectura, la tarjeta dice el porqué y no «no anotaste nada» («${aviso.slice(0, 80)}»)`)
  comprobar(await sinPermiso.pagina.getByText(ots[0].numero, { exact: false }).count() > 0, 'y la lista de órdenes sigue')
  await sinPermiso.contexto.close()
} finally {
  for (const q of quitados) {
    await base.query('insert into public.roles_permisos (rol_id, permiso_codigo) values ($1, $2) on conflict do nothing', [q.rol_id, q.permiso_codigo])
  }
}
errores.splice(0, errores.length, ...errores.filter((e) => !e.includes('trabajo por OT')))

// 4. Sin leer unidades.
const unidades = await comoCuenta('colaborador', 'select count(*)::int as n from public.unidades')
comprobar(!unidades.error && unidades.filas[0]?.n === 0, `el colaborador no lee la tabla de unidades (${unidades.error ?? unidades.filas[0]?.n})`)

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: el trabajo del colaborador por OT, solo lo suyo y de su equipo.')

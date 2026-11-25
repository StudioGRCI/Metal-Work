/**
 * Clic real sobre la migración 20261125130000: el recorrido de cada documento.
 * Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Requerimientos, Almacén, Logística y Gerencia abren un RQ de cada estado
 *      que haya en el banco: su tarjeta trae «Recorrido», cerrado dice quién lo
 *      tiene y hace cuánto, y abierto muestra los mismos pasos, en el mismo
 *      orden, que da la base con la sesión de esa cuenta: lo hecho con su
 *      puesto, su nombre y su hora; quién lo tiene ahora con sus días; y lo que
 *      falta. La tarjeta conserva lo que ya tenía (la barra de pasos y los insumos).
 *   2. En la lista entera, cada tarjeta de RQ trae su recorrido y ninguno dice
 *      «No se pudo leer».
 *   3. Ventas, Gerencia, Administración y Contabilidad ven lo mismo en cada
 *      cotización que su cuenta alcanza; el «Historial» sigue en su sitio.
 *   4. Los días salen de la base: un RQ y una cotización que esperan desde hace
 *      tres días dicen «hace 3 días». Para eso, y solo en el banco, se les
 *      corre la fecha a un RQ por atender y a una cotización por revisar (con
 *      los disparadores apagados).
 *   5. Portería no entra a ninguna de las dos pantallas y la base le niega las
 *      dos funciones.
 *   6. En el teléfono (390) nada se sale de la pantalla con el recorrido abierto.
 *
 * Usa los RQ y las cotizaciones que dejaron las demás suites (por ejemplo
 * `probar-oc-del-rq.mjs` y `probar-gerencia-aprueba-y-administracion-carga-la-ot.mjs`);
 * si el banco no tiene ninguno, lo dice y falla. Deja capturas en CAPTURAS, en
 * 390 y 1440. Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE
 * (mw_demo), BANCO_CHROMIUM, CAPTURAS.
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
const haceDias = (d) => (d <= 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`)
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

/** Los pasos que pinta un recorrido abierto, en orden. */
const pasosEnPantalla = (recorrido) =>
  recorrido.locator('li[data-recorrido-paso]').evaluateAll((lis) =>
    lis.map((li) => ({ paso: li.dataset.recorridoPaso, situacion: li.dataset.situacion, texto: li.innerText.replace(/\s+/g, ' ').trim() })),
  )

/**
 * Abre el recorrido de `tarjeta` y lo contrasta con `esperado`, lo que dio la
 * base a esa cuenta. Devuelve el texto de lo que se ve cerrado.
 */
async function contrastar(tarjeta, esperado, quien, cual) {
  const recorrido = tarjeta.locator('details[data-recorrido]')
  comprobar((await recorrido.count()) === 1, `${quien}: ${cual} trae su «Recorrido»`)
  if ((await recorrido.count()) !== 1) return ''
  comprobar(!(await recorrido.evaluate((d) => d.open)), `${quien}: ${cual} lo trae cerrado`)
  const cerrado = limpio(await recorrido.locator('summary').innerText())
  const ahora = esperado.find((p) => p.situacion === 'AHORA')
  if (ahora) {
    comprobar(
      cerrado.includes(`tiene ${ahora.puesto}`) && cerrado.includes(haceDias(ahora.dias)),
      `${quien}: cerrado, ${cual} dice quién lo tiene y hace cuánto («${cerrado}»; la base: ${ahora.puesto}, ${ahora.dias} día(s))`,
    )
  } else {
    comprobar(!/tiene/.test(cerrado) && /\d{2}\/\d{2}\/\d{4}/.test(cerrado), `${quien}: cerrado, ${cual} dice en qué terminó y cuándo («${cerrado}»)`)
  }
  await recorrido.locator('summary').click()
  comprobar(await recorrido.evaluate((d) => d.open), `${quien}: un toque lo abre`)
  const vistos = await pasosEnPantalla(recorrido)
  const camino = (ps) => ps.map((p) => `${p.paso}:${p.situacion}`).join(' > ')
  comprobar(camino(vistos) === camino(esperado) && vistos.length > 0, `${quien}: ${cual} pinta los pasos de la base, en su orden (${camino(vistos)})`)
  for (const [i, p] of esperado.entries()) {
    const v = vistos[i]
    if (!v) continue
    if (p.situacion === 'HECHO') {
      const firma = [p.puesto, p.nombre].filter(Boolean).join(' · ')
      comprobar(
        v.texto.includes(firma || 'Sin cuenta registrada') && /\d{2}\/\d{2}\/\d{4}/.test(v.texto),
        `${quien}: ${p.paso} dice quién y cuándo («${v.texto}»)`,
      )
    } else if (p.situacion === 'AHORA') {
      comprobar(
        v.texto.includes(`tiene ${p.puesto}`) && v.texto.includes(haceDias(p.dias)) && v.texto.includes('Desde el'),
        `${quien}: ${p.paso} dice quién lo tiene, hace cuánto y desde cuándo («${v.texto}»)`,
      )
    } else {
      comprobar(v.texto.startsWith('Falta: ') && !/\d{2}\/\d{2}\/\d{4}/.test(v.texto), `${quien}: ${p.paso} queda como lo que falta («${v.texto}»)`)
    }
  }
  // Ni importes ni datos de RR. HH. en ningún paso.
  const todo = limpio(await recorrido.innerText())
  comprobar(!/S\/|US\$|\bDNI\b|@/.test(todo), `${quien}: el recorrido de ${cual} no trae importes, DNI ni correos`)
  return cerrado
}

/**
 * La pantalla entera en una captura. En el teléfono la barra de abajo es fija:
 * con la captura de página entera saldría cruzada a media pantalla, así que la
 * ventana se estira a lo alto del contenido. Sin la marca de `next dev`, que no
 * es de la aplicación.
 */
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

// ---------------------------------------------------------------- lo que hay
const rqs = await consulta(
  `select distinct on (estado) id, numero, estado from public.requerimientos order by estado, creado_en desc`,
)
comprobar(rqs.length > 0, `el banco tiene RQ para mirar (${rqs.map((r) => `${r.numero} ${r.estado}`).join(', ') || 'ninguno: corre antes probar-oc-del-rq.mjs'})`)
const cots = await consulta(
  `select distinct on (estado, (orden_id is not null)) id, numero, estado, orden_id is not null as con_ot
     from public.v_cotizaciones_pdf where id is not null order by estado, (orden_id is not null), creado_en desc`,
)
comprobar(cots.length > 0, `el banco tiene cotizaciones para mirar (${cots.map((c) => `${c.numero} ${c.estado}${c.con_ot ? ' con OT' : ''}`).join(', ') || 'ninguna: corre antes probar-gerencia-aprueba-y-administracion-carga-la-ot.mjs'})`)

// 4. Solo en el banco: un RQ por atender y una cotización por revisar que esperan desde hace tres días.
// Se corre la fecha de todo lo que les pasó, con los disparadores apagados, y siempre a la misma fecha.
const haceTres = (columna) => `(((now() at time zone 'America/Lima')::date - 3) + (${columna} at time zone 'America/Lima')::time) at time zone 'America/Lima'`
const viejo = rqs.find((r) => r.estado === 'POR_ATENDER')
const vieja = cots.find((c) => c.estado === 'POR_REVISAR')
await base.query('begin')
await base.query(`set local session_replication_role = replica`)
if (viejo) {
  await base.query(`update public.requerimientos set creado_en = ${haceTres('creado_en')} where id = $1`, [viejo.id])
  await base.query(
    `update public.requerimiento_sustentos s set sustentado_en = ${haceTres('s.sustentado_en')}, decidido_en = ${haceTres('s.decidido_en')}
      where s.requerimiento_linea_id in (select id from public.requerimiento_lineas where requerimiento_id = $1)`,
    [viejo.id],
  )
}
if (vieja) {
  await base.query(`update public.cotizaciones_pdf set creado_en = ${haceTres('creado_en')}, archivo_subido_en = ${haceTres('archivo_subido_en')} where id = $1`, [vieja.id])
}
await base.query('commit')

const RQ_SQL = `select paso, situacion, puesto, nombre, dias from public.recorrido_de_requerimientos(array[$1]::uuid[]) order by orden`
const COT_SQL = `select paso, situacion, puesto, nombre, dias from public.recorrido_de_cotizaciones(array[$1]::uuid[]) order by orden`

// ------------------------------------------------------- 1 y 2. El RQ
for (const puesto of ['requerimientos', 'almacen', 'logistica', 'gerencia']) {
  const { pagina, contexto } = await entrar(puesto)
  for (const rq of rqs) {
    const { filas: esperado, error } = await comoCuenta(puesto, RQ_SQL, [rq.id])
    comprobar(!error && esperado.length > 0, `${puesto}: la base le da el recorrido del ${rq.numero} (${error ?? `${esperado.length} pasos`})`)
    await ir(pagina, `/requerimientos?rq=${rq.id}`)
    const tarjeta = pagina.locator(`[data-rq="${rq.numero}"]`)
    comprobar((await tarjeta.count()) === 1, `${puesto}: abre el ${rq.numero} (${rq.estado})`)
    if ((await tarjeta.count()) !== 1) continue
    // La anulada nunca tuvo barra de pasos: dice que se anuló.
    comprobar(
      (await tarjeta.locator('ol[aria-label^="En qué va"]').count()) === (rq.estado === 'ANULADO' ? 0 : 1) &&
        (await tarjeta.locator(`[data-insumos="${rq.numero}"]`).count()) === 1,
      `${puesto}: la tarjeta conserva ${rq.estado === 'ANULADO' ? 'sus insumos' : 'su barra de pasos y sus insumos'}`,
    )
    const cerrado = await contrastar(tarjeta, esperado, puesto, `el ${rq.numero}`)
    if (viejo && rq.id === viejo.id) comprobar(cerrado.includes('hace 3 días'), `${puesto}: el RQ que espera desde hace tres días dice «hace 3 días» («${cerrado}»)`)
  }
  if (puesto === 'requerimientos') {
    await ir(pagina, '/requerimientos')
    const tarjetas = await pagina.locator('[data-rq]').count()
    const conRecorrido = await pagina.locator('[data-rq] details[data-recorrido]').count()
    const sinLeer = await pagina.locator('[data-recorrido="sin-leer"]').count()
    comprobar(tarjetas > 0 && conRecorrido === tarjetas && sinLeer === 0, `en la lista entera cada RQ trae su recorrido (${conRecorrido} de ${tarjetas}; sin leer: ${sinLeer})`)
    // El recorrido no contradice a su tarjeta: lo que ella llama «Ya llegó todo»
    // lo tiene Almacén, no quien compra.
    const pares = await pagina.locator('[data-rq]').evaluateAll((ts) =>
      ts.map((t) => ({
        numero: t.dataset.rq,
        tarjeta: t.innerText.replace(/\s+/g, ' '),
        paso: t.querySelector('ol[aria-label^="En qué va"] [aria-current="step"]')?.dataset.paso ?? null,
        recorrido: t.querySelector('details[data-recorrido] summary')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
      })),
    )
    const yaLlego = pares.filter((p) => p.tarjeta.includes('Ya llegó todo'))
    comprobar(
      yaLlego.every((p) => p.recorrido.includes('Lo tiene Almacén')),
      `los ${yaLlego.length} RQ que su tarjeta da por «Ya llegó todo» los tiene Almacén (${yaLlego.map((p) => `${p.numero}: ${p.recorrido}`).join(' | ') || 'ninguno en el banco'})`,
    )
    const listos = pares.filter((p) => p.paso === 'EN_ALMACEN' && !p.tarjeta.includes('Ya llegó todo'))
    comprobar(
      listos.every((p) => !/Lo tiene (Logística|Gerencia|Conductor)/.test(p.recorrido)),
      `los ${listos.length} RQ que su tarjeta pone «Para recoger» no los tiene quien compra (${listos.map((p) => `${p.numero}: ${p.recorrido}`).join(' | ') || 'ninguno'})`,
    )
  }
  await contexto.close()
}

// ------------------------------------------------------- 3. La cotización
for (const puesto of ['ventas', 'gerencia', 'administracion', 'contabilidad']) {
  const { pagina, contexto } = await entrar(puesto)
  await ir(pagina, '/cotizaciones/pdf?estado=todas')
  if (pagina.url().includes('/sin-permiso')) {
    comprobar(false, `${puesto}: entra a Cotización`)
    await contexto.close()
    continue
  }
  let vistas = 0
  for (const c of cots) {
    const { filas: esperado, error } = await comoCuenta(puesto, COT_SQL, [c.id])
    const laVe = (await comoCuenta(puesto, 'select 1 from public.cotizaciones_pdf where id = $1', [c.id])).filas.length === 1
    comprobar(!error && (esperado.length > 0) === laVe, `${puesto}: la base le da el recorrido de la ${c.numero} solo si la ve (la ve: ${laVe}; pasos: ${esperado.length}${error ? `; ${error}` : ''})`)
    const tarjeta = pagina.locator(`li[id="${c.id}"]`)
    if (!laVe) {
      comprobar((await tarjeta.count()) === 0, `${puesto}: la ${c.numero} (${c.estado}) no está en su pantalla`)
      continue
    }
    if ((await tarjeta.count()) !== 1) {
      // Fuera del filtro que abre esta cuenta: se busca por su número.
      await ir(pagina, `/cotizaciones/pdf?estado=todas&q=${encodeURIComponent(c.numero)}`)
    }
    comprobar((await tarjeta.count()) === 1, `${puesto}: ve la ${c.numero} (${c.estado}${c.con_ot ? ', con OT' : ''})`)
    if ((await tarjeta.count()) !== 1) continue
    const cerrado = await contrastar(tarjeta, esperado, puesto, `la ${c.numero}`)
    if (vieja && c.id === vieja.id) comprobar(cerrado.includes('tiene Gerencia') && cerrado.includes('hace 3 días'), `${puesto}: la cotización que espera desde hace tres días lo dice («${cerrado}»)`)
    vistas += 1
  }
  comprobar(vistas > 0, `${puesto}: vio el recorrido de ${vistas} cotización(es)`)
  const sinLeer = await pagina.locator('[data-recorrido="sin-leer"]').count()
  comprobar(sinLeer === 0, `${puesto}: ninguna cotización dice «No se pudo leer el recorrido»`)
  await contexto.close()
}

// ------------------------------------------------------- 5. Portería
{
  const { pagina, contexto } = await entrar('porteria')
  for (const ruta of ['/requerimientos', '/cotizaciones/pdf']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `Portería no entra a ${ruta} (${new URL(pagina.url()).pathname})`)
  }
  await contexto.close()
  if (rqs[0]) {
    const { error } = await comoCuenta('porteria', RQ_SQL, [rqs[0].id])
    comprobar(/No tienes permiso para ver los requerimientos/.test(error ?? ''), `la base le niega a Portería el recorrido de un RQ («${error}»)`)
  }
  if (cots[0]) {
    const { error } = await comoCuenta('porteria', COT_SQL, [cots[0].id])
    comprobar(/No tienes permiso para ver las cotizaciones/.test(error ?? ''), `y el de una cotización («${error}»)`)
  }
}

// ------------------------------------------------------- 6. Capturas, 390 y 1440
const paraCaptura = rqs.find((r) => r.estado === 'SIN_STOCK') ?? rqs.find((r) => r.estado === 'EN_ATENCION') ?? viejo ?? rqs[0]
const cotParaCaptura = cots.find((c) => c.con_ot) ?? cots[0]
for (const ancho of [390, 1440]) {
  if (paraCaptura) {
    for (const [puesto, rq] of [['requerimientos', paraCaptura], ...(viejo && viejo.id !== paraCaptura.id ? [['almacen', viejo]] : [])]) {
      const { pagina, contexto } = await entrar(puesto, ancho)
      await ir(pagina, `/requerimientos?rq=${rq.id}`)
      const recorrido = pagina.locator(`[data-rq="${rq.numero}"] details[data-recorrido]`)
      await capturar(pagina, `recorrido-rq-${puesto}-cerrado-${ancho}.png`)
      await recorrido.locator('summary').click()
      await recorrido.scrollIntoViewIfNeeded()
      await sinDesborde(pagina, `el RQ con su recorrido abierto, ${puesto} a ${ancho}`)
      const pasos = await pasosEnPantalla(recorrido)
      console.log(`     ${puesto} a ${ancho}, ${rq.numero}:\n${pasos.map((p) => `       - [${p.situacion}] ${p.texto}`).join('\n')}`)
      await capturar(pagina, `recorrido-rq-${puesto}-abierto-${ancho}.png`)
      await contexto.close()
    }
  }
  if (cotParaCaptura) {
    for (const [puesto, c] of [['ventas', cotParaCaptura], ...(vieja ? [['gerencia', vieja]] : [])]) {
      const { pagina, contexto } = await entrar(puesto, ancho)
      await ir(pagina, `/cotizaciones/pdf?estado=todas&q=${encodeURIComponent(c.numero)}`)
      const recorrido = pagina.locator(`li[id="${c.id}"] details[data-recorrido]`)
      if ((await recorrido.count()) !== 1) {
        comprobar(false, `${puesto} a ${ancho}: la ${c.numero} está para la captura`)
        await contexto.close()
        continue
      }
      await recorrido.locator('summary').click()
      await recorrido.scrollIntoViewIfNeeded()
      await sinDesborde(pagina, `la cotización con su recorrido abierto, ${puesto} a ${ancho}`)
      const pasos = await pasosEnPantalla(recorrido)
      console.log(`     ${puesto} a ${ancho}, ${c.numero}:\n${pasos.map((p) => `       - [${p.situacion}] ${p.texto}`).join('\n')}`)
      await capturar(pagina, `recorrido-cotizacion-${puesto}-abierto-${ancho}.png`)
      await contexto.close()
    }
  }
}

comprobar(errores.length === 0, `sin errores de consola ni de hidratación ${errores.slice(0, 5).join(' | ')}`)

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} cosa(s) no cuadran:\n${fallas.map((f) => ` - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTodo en orden.')

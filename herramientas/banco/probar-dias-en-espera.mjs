/**
 * Clic real sobre la migración 20261125140000: los días en espera de cada fila.
 * Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Gerencia, en «Aprobación de compras y servicios», ve en cada compra por
 *      aprobar cuánto lleva esperando («hace 5 días»), el mismo número que da la
 *      base con su sesión, y la que más espera va arriba. Logística consulta la
 *      misma lista con las mismas insignias.
 *   2. Almacén y Logística, en «Atención de requerimiento», ven en cada RQ abierto
 *      quién lo tiene y hace cuántos días, el mismo número que da su recorrido.
 *      Lo que ya estaba (las insignias de estado, «espera(n) por ti», los
 *      botones) sigue; dentro de lo que le toca a cada uno, el que más espera va
 *      arriba. En el historial, el entregado y el anulado no llevan días.
 *   3. Portería no entra a ninguna de las dos.
 *   4. En el teléfono (390) nada se sale de la pantalla. Capturas en 390 y 1440.
 *
 * Solo en el banco, y con los disparadores apagados, corre la hora en que se
 * pidió la aprobación de las compras por aprobar (0, 2, 5… días atrás) para que
 * el orden se note. Usa las compras y los RQ que dejaron las demás suites
 * (`probar-oc-del-rq.mjs`, `probar-oc-de-varios-rq.mjs`). Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const haceDias = (d) => (d <= 0 ? 'desde hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`)
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Lo que da la base con la sesión de esa cuenta y el rol authenticated. */
async function comoCuenta(puesto, sql, valores = []) {
  const [cuenta] = await consulta('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    return (await base.query(sql, valores)).rows
  } finally {
    await base.query('rollback')
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

/** La pantalla entera, sin la barra fija del teléfono cruzada a media página ni la marca de `next dev`. */
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

/** De cada insignia de días: el número, el texto y desde cuándo. */
const insignias = (raiz) =>
  raiz.locator('[data-dias-en-espera]').evaluateAll((es) =>
    es.map((e) => ({ dias: Number(e.dataset.diasEnEspera), desde: e.dataset.desde ?? null, texto: e.innerText.replace(/\s+/g, ' ').trim(), lector: e.textContent.replace(/\s+/g, ' ').trim() })),
  )
const enOrden = (lista) => lista.every((x, i) => i === 0 || Date.parse(lista[i - 1]) <= Date.parse(x))

// ------------------------------------------------ armazón: las compras por aprobar, a distintas edades
const porAprobar = await consulta(
  `select id, coalesce(numero, referencia) as nombre from public.ordenes_compra_materiales where aprobacion = 'POR_APROBAR' order by creado_en`,
)
comprobar(porAprobar.length > 0, `el banco tiene compras por aprobar (${porAprobar.length}; si no, corre probar-oc-de-varios-rq.mjs)`)
await base.query('begin')
await base.query('set local session_replication_role = replica')
// La más vieja por creación queda como la más reciente por pedido: el orden de la pantalla no puede salir de otra columna.
for (const [i, c] of porAprobar.entries()) {
  const atras = [0, 5, 2, 9, 1][i % 5]
  await base.query(
    `update public.ordenes_compra_materiales
        set aprobacion_pedida_en = (((now() at time zone 'America/Lima')::date - $2::int) + time '10:30') at time zone 'America/Lima'
      where id = $1`,
    [c.id, atras],
  )
}
await base.query('commit')

// ------------------------------------------------ 1. Aprobación de compras
for (const puesto of ['gerencia', 'logistica']) {
  const { pagina, contexto } = await entrar(puesto)
  await ir(pagina, '/compras/aprobacion')
  if (pagina.url().includes('/sin-permiso')) {
    comprobar(puesto === 'logistica', `${puesto} entra a Aprobación de compras`)
    await contexto.close()
    continue
  }
  const esperado = await comoCuenta(
    puesto,
    `select tipo, id, numero, pedida_en, public.dias_en_espera(pedida_en) as dias from public.documentos_por_aprobar() where aprobacion = 'POR_APROBAR' order by pedida_en`,
  )
  const seccion = pagina.locator('section').filter({ has: pagina.getByRole('heading', { name: /^Por aprobar/ }) })
  const vistas = await insignias(seccion)
  comprobar(vistas.length === esperado.length && vistas.length > 0, `${puesto}: cada compra por aprobar trae sus días (${vistas.length} de ${esperado.length})`)
  comprobar(
    vistas.map((v) => v.dias).join(',') === esperado.map((e) => e.dias).join(','),
    `${puesto}: los días son los de la base y la que más espera va arriba (pantalla ${vistas.map((v) => v.dias).join(', ')}; base ${esperado.map((e) => e.dias).join(', ')})`,
  )
  comprobar(enOrden(vistas.map((v) => v.desde)), `${puesto}: de la más antigua a la más nueva`)
  comprobar(vistas.every((v) => v.lector === `Espera ${haceDias(v.dias)}`), `${puesto}: dice «hace N días» y el lector oye «Espera hace N días» (${vistas.map((v) => v.lector).join(' | ')})`)
  // Lo de antes sigue: «Por aprobar» y, para quien aprueba, sus botones.
  const porAprobarInsignias = await seccion.getByText('Por aprobar', { exact: true }).count()
  comprobar(porAprobarInsignias === esperado.length, `${puesto}: cada una sigue con su «Por aprobar» (${porAprobarInsignias})`)
  if (puesto === 'gerencia') {
    const botones = await seccion.getByRole('button', { name: /^Aprobar/ }).count()
    comprobar(botones === esperado.length, `gerencia: y con su botón de aprobar (${botones})`)
  }
  await contexto.close()
}

// ------------------------------------------------ 2. Atención de requerimiento
for (const puesto of ['almacen', 'logistica']) {
  const { pagina, contexto } = await entrar(puesto)
  await ir(pagina, '/requerimientos/atencion')
  const filas = await pagina.locator('tr[id^="rq-"]').evaluateAll((trs) =>
    trs.map((tr) => {
      const i = tr.querySelector('[data-dias-en-espera]')
      return {
        id: tr.id.slice(3),
        numero: tr.querySelector('p')?.innerText.trim().split(/\s/)[0],
        dias: i ? Number(i.dataset.diasEnEspera) : null,
        desde: i?.dataset.desde ?? null,
        lector: i?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        frenado: Boolean(tr.querySelector('[data-freno]')),
        estado: tr.querySelector('td:nth-child(3) [class*="rounded-full"]')?.innerText.trim() ?? '',
      }
    }),
  )
  const ids = filas.map((f) => f.id)
  const ahora = ids.length
    ? await comoCuenta(
        puesto,
        `select documento::text as id, dias, en, puesto from public.recorrido_de_requerimientos($1::uuid[]) where situacion = 'AHORA'`,
        [ids],
      )
    : []
  const porId = new Map(ahora.map((a) => [a.id, a]))
  comprobar(filas.length > 0, `${puesto}: la bandeja tiene RQ abiertos (${filas.length})`)
  const malos = filas.filter((f) => {
    const a = porId.get(f.id)
    return !a || f.dias !== Number(a.dias) || !f.lector.startsWith(`Lo tiene ${a.puesto} `)
  })
  comprobar(malos.length === 0, `${puesto}: cada RQ dice quién lo tiene y sus días, los del recorrido (${filas.map((f) => `${f.numero} ${f.lector}`).join(' | ')})`)
  const leyenda = await pagina.getByText(/espera(n)? por ti\.$|Ninguno espera por ti\./).count()
  comprobar(leyenda === 1, `${puesto}: sigue el «… espera(n) por ti»`)
  // Los frenados por el metrado van al final, como antes; antes de ellos, por grupos, el que más espera arriba.
  const primerFrenado = filas.findIndex((f) => f.frenado)
  comprobar(primerFrenado === -1 || filas.slice(primerFrenado).every((f) => f.frenado), `${puesto}: los que esperan el metrado siguen al final`)
  if (puesto === 'logistica') {
    // Logística no revisa ni entrega: lo suyo es lo que compra. Los demás van en un solo grupo, del más antiguo al más nuevo.
    const suyos = filas.filter((f) => !f.frenado && /compra|Por comprar|Sin stock/i.test(f.estado))
    const otros = filas.filter((f) => !f.frenado && !suyos.includes(f))
    comprobar(enOrden(otros.map((f) => f.desde)), `${puesto}: lo que no le toca va del más antiguo al más nuevo (${otros.map((f) => `${f.numero} ${f.dias}`).join(', ')})`)
  }
  await ir(pagina, '/requerimientos/atencion?vista=todos')
  const historial = await pagina.locator('tr[id^="rq-"]').evaluateAll((trs) =>
    trs.map((tr) => ({
      estado: tr.querySelector('td:nth-child(3) span span')?.textContent.trim() ?? '',
      dias: Boolean(tr.querySelector('[data-dias-en-espera]')),
    })),
  )
  const cerrados = historial.filter((f) => /^(Entregado|Anulado)/.test(f.estado))
  const abiertos = historial.filter((f) => !/^(Entregado|Anulado)/.test(f.estado))
  comprobar(cerrados.length > 0 && cerrados.every((f) => !f.dias), `${puesto}: en el historial, los ${cerrados.length} entregados o anulados no llevan días`)
  comprobar(abiertos.every((f) => f.dias), `${puesto}: y los ${abiertos.length} abiertos sí`)
  await contexto.close()
}

// ------------------------------------------------ 3. Portería
{
  const { pagina, contexto } = await entrar('porteria')
  for (const ruta of ['/requerimientos/atencion', '/compras/aprobacion']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `Portería no entra a ${ruta}`)
  }
  await contexto.close()
}

// ------------------------------------------------ 4. Capturas, 390 y 1440
for (const ancho of [390, 1440]) {
  for (const [puesto, ruta, archivo] of [
    ['almacen', '/requerimientos/atencion', 'dias-atencion-almacen'],
    ['gerencia', '/compras/aprobacion', 'dias-aprobacion-gerencia'],
  ]) {
    const { pagina, contexto } = await entrar(puesto, ancho)
    await ir(pagina, ruta)
    await sinDesborde(pagina, `${ruta}, ${puesto} a ${ancho}`)
    await capturar(pagina, `${archivo}-${ancho}.png`)
    await contexto.close()
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

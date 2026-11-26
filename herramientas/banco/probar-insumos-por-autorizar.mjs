/**
 * Clic real sobre «Insumos por autorizar» (plan 6, entrega 6.2): días en
 * espera, quién pidió y, tras autorizar, el recorrido del RQ. Con la cuenta de
 * cada puesto, nunca ADMIN:
 *
 *   1. Diseño ve en «Esperan tu visto» cada RQ con quién lo pidió (el puesto
 *      del paso de registro) y los días que lleva esperándolo, lo mismo que da
 *      la base con su sesión; el de sustento más antiguo, arriba. Si otro
 *      insumo del RQ espera sustento, dice quién lo tiene. La firma del
 *      sustento va por puesto, sin el nombre de la persona.
 *   2. En «Esperan el sustento», los días y el puesto de quien lo tiene.
 *   3. En «Ya autorizados por Diseño», el RQ autorizado con su recorrido: lo tiene
 *      Almacén, y abierto dice que Diseño lo autorizó.
 *   4. Capturas en 390 y 1440, sin nada fuera de la pantalla.
 *   5. Diseño autoriza con un toque y el RQ pasa a «Ya autorizados», con el
 *      recorrido en Almacén. Al final se deshace, para poder repetir la sonda.
 *   6. Logística y el supervisor no entran.
 *
 * Necesita lo que siembran `sembrar-diseno-por-codigo.sql` y
 * `sembrar-insumos-por-autorizar.sql`. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_CHROMIUM, CAPTURAS.
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

/** Cada tarjeta de RQ de una sección: número, quién pidió, días y lo que dice el recorrido. */
const tarjetas = (pagina, seccion) =>
  pagina.locator(`section[aria-labelledby="${seccion}"] [data-rq]`).evaluateAll((es) =>
    es.map((e) => ({
      numero: e.dataset.rq,
      pidio: e.querySelector('[data-pidio]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      dias: e.querySelector('[data-dias-en-espera]')?.dataset.diasEnEspera ?? null,
      espera: e.querySelector('[data-dias-en-espera]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      ahora: e.querySelector('[data-recorrido-ahora]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    })),
  )

const sembrados = await consulta(`select id, numero from public.requerimientos where justificacion like '%(banco 6.2)' order by creado_en`)
if (sembrados.length < 4) throw new Error('Falta lo sembrado: corre sembrar-insumos-por-autorizar.sql.')
const ids = sembrados.map((r) => r.id)
/** Lo que da la base, con la sesión de Diseño: quién pidió y quién lo tiene ahora. */
async function recorridoEnLaBase() {
  const filas = await comoCuenta(
    'diseno',
    `select q.numero, r.paso, r.situacion, r.puesto, r.dias, r.en
       from public.recorrido_de_requerimientos($1::uuid[]) r join public.requerimientos q on q.id = r.documento
      where r.paso = 'REGISTRO' or r.situacion = 'AHORA'`,
    [ids],
  )
  const de = new Map()
  for (const f of filas) {
    const r = de.get(f.numero) ?? {}
    if (f.paso === 'REGISTRO') r.pidio = f.puesto
    if (f.situacion === 'AHORA') Object.assign(r, { quien: f.puesto, dias: f.dias, en: f.en, paso: f.paso })
    de.set(f.numero, r)
  }
  return de
}
const enBase = await recorridoEnLaBase()
/** Los RQ que esperan el visto de Diseño, del sustento más antiguo al más nuevo, según la base. */
const esperanVistoEnLaBase = async () => {
  const filas = await comoCuenta(
    'diseno',
    `select q.numero, min(m.sustentado_en) as desde
       from public.metrado_de_requerimientos($1::uuid[]) m join public.requerimientos q on q.id = m.requerimiento_id
      where m.estado = 'POR_AUTORIZAR' group by q.numero order by 2`,
    [ids],
  )
  return filas.map((f) => f.numero)
}
const nombres = (await consulta(`select nombres, apellidos from public.usuarios where correo like 'sup.%.local@metalwork.test'`))
  .map((u) => `${u.nombres} ${u.apellidos}`)
const porPaso = (paso) => [...enBase].filter(([, r]) => r.paso === paso).sort(([, a], [, b]) => a.en - b.en).map(([n]) => n)

// ------------------------------------------------ 1 a 3. Diseño, en el monitor
{
  const { pagina, contexto } = await entrar('diseno')
  await ir(pagina, '/requerimientos/metrado')

  const visto = await tarjetas(pagina, 'por-autorizar')
  const esperanVisto = await esperanVistoEnLaBase()
  comprobar(esperanVisto.length >= 3, `la base tiene al menos tres RQ que esperan a Diseño (${esperanVisto.join(', ')})`)
  comprobar(
    JSON.stringify(visto.map((t) => t.numero)) === JSON.stringify(esperanVisto),
    `«Esperan tu visto» va del sustento más antiguo al más nuevo: ${visto.map((t) => t.numero).join(', ')} (base: ${esperanVisto.join(', ')})`,
  )
  for (const t of visto) {
    const b = enBase.get(t.numero)
    comprobar(t.pidio === `Pidió: ${b?.pidio}`, `${t.numero}: «${t.pidio}» es el puesto que da la base (${b?.pidio})`)
    comprobar(t.dias === String(b?.dias), `${t.numero}: espera ${t.dias} días, como da la base (${b?.dias})`)
    // Si lo tiene otro (un insumo espera sustento), se dice quién; si lo tiene Diseño, solo los días.
    comprobar(
      b?.paso === 'VISTO_DISENO' ? !t.espera?.includes('·') : t.espera?.startsWith(`${b?.quien} ·`),
      `${t.numero}: «${t.espera}» (lo tiene ${b?.quien}, paso ${b?.paso})`,
    )
    const texto = await pagina.locator(`section[aria-labelledby="por-autorizar"] [data-rq="${t.numero}"]`).textContent()
    comprobar(!nombres.some((n) => texto.includes(n)), `${t.numero}: ningún nombre de persona en la tarjeta, solo puestos`)
  }
  comprobar(visto.some((t) => enBase.get(t.numero)?.paso === 'SUSTENTO'), 'hay un RQ con un insumo que espera el visto y otro el sustento (el caso mixto)')

  const sustento = await tarjetas(pagina, 'sin-sustento')
  // Los que esperan sustento y ningún visto: el mixto ya va arriba, en «Esperan tu visto».
  const esperanSustento = porPaso('SUSTENTO').filter((n) => !esperanVisto.includes(n))
  comprobar(
    JSON.stringify(sustento.map((t) => t.numero)) === JSON.stringify(esperanSustento),
    `«Esperan el sustento» lleva los RQ que da la base: ${sustento.map((t) => t.numero).join(', ')}`,
  )
  for (const t of sustento) {
    const b = enBase.get(t.numero)
    comprobar(t.espera?.startsWith(`${b?.quien} ·`) && t.dias === String(b?.dias), `${t.numero}: «${t.espera}», quién lo tiene y hace cuánto`)
  }

  const autorizados = await tarjetas(pagina, 'ya-autorizados')
  const yaAutorizados = [...enBase].filter(([, r]) => r.paso === 'REVISION_STOCK').map(([n]) => n)
  comprobar(
    autorizados.length > 0 && yaAutorizados.every((n) => autorizados.some((t) => t.numero === n)),
    `«Ya los autorizaste» lleva ${yaAutorizados.join(', ')} (${autorizados.map((t) => t.numero).join(', ')})`,
  )
  for (const t of autorizados.filter((x) => yaAutorizados.includes(x.numero))) {
    const b = enBase.get(t.numero)
    comprobar(t.ahora?.includes(`Lo tiene ${b?.quien}`), `${t.numero}: el recorrido dice «${t.ahora}»`)
    const tarjeta = pagina.locator(`section[aria-labelledby="ya-autorizados"] [data-rq="${t.numero}"]`)
    await tarjeta.locator('[data-recorrido] summary').click()
    const abierto = (await tarjeta.locator('[data-recorrido]').textContent()).replace(/\s+/g, ' ')
    comprobar(abierto.includes('Diseño lo autorizó') && abierto.includes('Registrado'), `${t.numero}: abierto, el recorrido dice que Diseño lo autorizó`)
  }
  await contexto.close()
}

// ------------------------------------------------ 3b. Si Diseño amplía el metrado, el autorizado sigue ahí
{
  const autorizado = [...enBase].find(([, r]) => r.paso === 'REVISION_STOCK')?.[0]
  const [{ codigo }] = await consulta('select codigo_interno as codigo from public.requerimientos where numero = $1', [autorizado])
  const ampliar = async (por) => {
    await base.query('begin')
    await base.query('set local session_replication_role = replica')
    await base.query('update public.codigo_materiales set cantidad = cantidad + $2 where codigo_interno = $1 and quitado_en is null', [codigo, por])
    await base.query('commit')
  }
  await ampliar(100)
  try {
    const [m] = await comoCuenta('diseno', 'select m.estado, m.decision from public.metrado_de_requerimientos($1::uuid[]) m', [
      [sembrados.find((r) => r.numero === autorizado).id],
    ])
    const { pagina, contexto } = await entrar('diseno')
    await ir(pagina, '/requerimientos/metrado')
    const siguen = await tarjetas(pagina, 'ya-autorizados')
    comprobar(
      m?.estado === 'EN_METRADO' && m?.decision === 'AUTORIZADO' && siguen.some((t) => t.numero === autorizado),
      `con el metrado de ${codigo} ampliado, ${autorizado} queda «en el metrado» y sigue en «Ya autorizados» (${m?.estado})`,
    )
    await contexto.close()
  } finally {
    await ampliar(-100)
  }
}

// ------------------------------------------------ 4. Capturas, 390 y 1440
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar('diseno', ancho)
  await ir(pagina, '/requerimientos/metrado')
  await sinDesborde(pagina, `Insumos por autorizar a ${ancho}`)
  const primero = pagina.locator('section[aria-labelledby="ya-autorizados"] [data-recorrido] summary').first()
  if (await primero.count()) await primero.click()
  await capturar(pagina, `6-2-insumos-por-autorizar-${ancho}.png`)
  await contexto.close()
}

// ------------------------------------------------ 5. Diseño autoriza con un toque
{
  const numero = porPaso('VISTO_DISENO').at(-1)
  const { pagina, contexto } = await entrar('diseno', 390)
  await ir(pagina, '/requerimientos/metrado')
  const tarjeta = pagina.locator(`section[aria-labelledby="por-autorizar"] [data-rq="${numero}"]`)
  await tarjeta.getByRole('button', { name: /^Autorizar/ }).click()
  await pagina
    .locator(`section[aria-labelledby="ya-autorizados"] [data-rq="${numero}"]`)
    .waitFor({ timeout: 30000 })
    .catch(() => {})
  await conReact(pagina)
  const despues = await tarjetas(pagina, 'ya-autorizados')
  const fila = despues.find((t) => t.numero === numero)
  comprobar(Boolean(fila), `${numero} pasó a «Ya los autorizaste» tras el toque`)
  comprobar(fila?.ahora?.includes('Lo tiene Almacén'), `${numero}: su recorrido dice que ya lo tiene Almacén («${fila?.ahora}»)`)
  comprobar(
    !(await tarjetas(pagina, 'por-autorizar')).some((t) => t.numero === numero),
    `${numero} ya no espera tu visto`,
  )
  const [estado] = await comoCuenta(
    'diseno',
    `select m.estado from public.metrado_de_requerimientos($1::uuid[]) m`,
    [[sembrados.find((r) => r.numero === numero).id]],
  )
  comprobar(estado?.estado === 'AUTORIZADO', `en la base, el insumo de ${numero} quedó autorizado (${estado?.estado})`)
  await contexto.close()
  // Se deshace, sin disparadores, para poder repetir la sonda: el visto vuelve a faltar.
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  await base.query(
    `update public.requerimiento_sustentos s set decision = null, nota_decision = null, decidido_por = null, decidido_en = null
       from public.requerimiento_lineas l join public.requerimientos q on q.id = l.requerimiento_id
      where s.requerimiento_linea_id = l.id and q.numero = $1`,
    [numero],
  )
  await base.query('commit')
}

// ------------------------------------------------ 6. Quien no autoriza no entra
for (const puesto of ['logistica', 'sup.mtz']) {
  const { pagina, contexto } = await entrar(puesto)
  await ir(pagina, '/requerimientos/metrado')
  comprobar(
    new URL(pagina.url()).pathname === '/sin-permiso' && (await pagina.locator('[data-rq]').count()) === 0,
    `${puesto} no entra a Insumos por autorizar (${new URL(pagina.url()).pathname})`,
  )
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

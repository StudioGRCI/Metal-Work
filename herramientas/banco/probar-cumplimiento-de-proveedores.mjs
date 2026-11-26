/**
 * Clic real sobre la migración 20261126463000 (Plan 4.3): el cumplimiento de
 * cada proveedor en el padrón. Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Logística, en «Proveedores», ve en cada fila lo mismo que da la base con
 *      su sesión: cuántas compras, cuántas a tiempo de las que llegaron y
 *      cuántas con devolución. Sin importes.
 *   2. En el teléfono (390) el cumplimiento baja bajo el nombre, en un renglón;
 *      a 1 024 la tabla cabe en su caja sin deslizarse de costado,
 *      y nada se sale de la pantalla.
 *   3. Almacén, que ve el padrón, lo ve igual; Ventas no entra al padrón.
 *   4. Si la base no contesta el cumplimiento, el padrón sale igual y lo dice.
 *   5. Capturas en 390 y 1440 con la cuenta de Logística.
 *
 * Solo lee, salvo el paso 4, que le quita a `authenticated` el permiso de
 * ejecutar la función un momento y se lo devuelve. Variables: BANCO_CLAVE, BASE
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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
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
  await pagina.setViewportSize({ width: ventana.width, height: Math.max(alto, ventana.height) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

/** La tabla se desliza dentro de su caja sin que la página se corra: se mide la caja, no el documento. */
async function tablaSinCorrerse(pagina, donde) {
  const sobra = await pagina.evaluate(() =>
    Math.max(0, ...[...document.querySelectorAll('table')].map((t) => {
      const caja = t.closest('.overflow-x-auto') ?? t.parentElement
      return caja.scrollWidth - caja.clientWidth
    })),
  )
  comprobar(sobra <= 0, `${donde}: la tabla cabe sin deslizarse de costado (sobran ${sobra} px)`)
}

/** Lo que la pantalla tiene que decir, armado igual que `Cumplimiento`, en minúsculas para comparar. */
function esperado(c) {
  if (!c || c.compras === 0) return 'sin compras todavía'
  const veces = (n, una, varias) => `${n} ${n === 1 ? una : varias}`
  const partes = [veces(c.compras, 'compra', 'compras')]
  if (c.llegaron === 0) partes.push('ninguna llegó completa todavía')
  else if (c.medidas > 0) partes.push(`${c.a_tiempo} de ${c.medidas} ${c.medidas === 1 ? 'llegada' : 'llegadas'} a tiempo`)
  if (c.sin_fecha > 0) partes.push(`${veces(c.sin_fecha, 'llegó', 'llegaron')} sin fecha prometida`)
  if (c.atrasadas > 0) partes.push(`${veces(c.atrasadas, 'atrasada', 'atrasadas')} sin llegar completa${c.atrasadas === 1 ? '' : 's'}`)
  if (c.nuestras > 0) partes.push(`${veces(c.nuestras, 'atrasada', 'atrasadas')} por pago, transporte o aprobación (no ${c.nuestras === 1 ? 'cuenta' : 'cuentan'})`)
  partes.push(c.devueltas > 0 ? `${c.devueltas} con devolución` : 'sin devoluciones')
  return partes
}
function dice(texto, c) {
  const e = esperado(c)
  const t = texto.toLowerCase()
  return Array.isArray(e) ? e.every((p) => t.includes(p)) && t.split(/;|·/).length === e.length : t === e
}

/** Cada fila del padrón en pantalla, con lo que dice su cumplimiento visible. */
async function filasDelPadron(pagina) {
  return pagina.locator('tr[data-proveedor]').evaluateAll((filas) =>
    filas.map((f) => {
      const visible = [...f.querySelectorAll('[data-cumplimiento]')].filter((e) => e.offsetParent !== null)
      return { id: f.dataset.proveedor, visibles: visible.length, texto: (visible[0]?.textContent ?? '').replace(/\s+/g, ' ').trim() }
    }),
  )
}

async function cuadraConLaBase(pagina, puesto, ancho) {
  const filas = await filasDelPadron(pagina)
  comprobar(filas.length > 0, `${puesto} a ${ancho}: el padrón tiene filas (${filas.length})`)
  const datos = await comoCuenta(
    puesto,
    'select proveedor::text as id, compras, llegaron, medidas, a_tiempo, devueltas, atrasadas, sin_fecha, nuestras from public.cumplimiento_de_proveedores($1::uuid[])',
    [filas.map((f) => f.id)],
  )
  const porId = new Map(datos.map((d) => [d.id, d]))
  const malas = filas.filter((f) => f.visibles !== 1 || !dice(f.texto, porId.get(f.id)))
  comprobar(
    malas.length === 0,
    `${puesto} a ${ancho}: cada fila muestra un cumplimiento y es el de la base` +
      (malas.length ? ` (no cuadran: ${malas.map((m) => `«${m.texto}» ×${m.visibles}`).join(', ')})` : ''),
  )
  comprobar(
    filas.every((f) => !/S\/|US\$|\$\s?\d/.test(f.texto)),
    `${puesto} a ${ancho}: el cumplimiento no lleva importes`,
  )
  return { filas, porId }
}

// ------------------------------------------------ 1 y 2. Logística, en el monitor y en el teléfono
for (const ancho of [1440, 1024, 390]) {
  const { pagina, contexto } = await entrar('logistica', ancho)
  await ir(pagina, '/proveedores')
  const { filas, porId } = await cuadraConLaBase(pagina, 'logistica', ancho)
  const conCompras = filas.filter((f) => (porId.get(f.id)?.compras ?? 0) > 0)
  comprobar(conCompras.length > 0, `logistica a ${ancho}: al menos un proveedor con compras (${conCompras.map((f) => `«${f.texto}»`).join(', ')})`)
  if (ancho === 1440) {
    comprobar(
      (await pagina.getByRole('columnheader', { name: 'Cumplimiento' }).count()) === 1,
      'logistica a 1440: la columna «Cumplimiento» está en la cabecera',
    )
  } else if (ancho === 390) {
    const enLaPrimera = await pagina
      .locator('tr[data-proveedor] td:first-child [data-cumplimiento]:visible')
      .count()
    comprobar(enLaPrimera === filas.length, `logistica a 390: el cumplimiento baja bajo el nombre en cada fila (${enLaPrimera})`)
  }
  await sinDesborde(pagina, `/proveedores, Logística a ${ancho}`)
  if (ancho !== 390) await tablaSinCorrerse(pagina, `/proveedores, Logística a ${ancho}`)
  if (ancho !== 1024) await capturar(pagina, `proveedores-${ancho}.png`)
  await contexto.close()
}

// ------------------------------------------------ 3. Almacén lo ve; Ventas no entra al padrón
{
  const { pagina, contexto } = await entrar('almacen')
  await ir(pagina, '/proveedores')
  await cuadraConLaBase(pagina, 'almacen', 1440)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('ventas')
  await ir(pagina, '/proveedores')
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `ventas va a /sin-permiso (${new URL(pagina.url()).pathname})`)
  comprobar((await pagina.locator('[data-cumplimiento]').count()) === 0, 'ventas no ve ningún cumplimiento')
  await contexto.close()
}

// ------------------------------------------------ 4. La base no contesta el cumplimiento
{
  const { pagina, contexto } = await entrar('logistica')
  await consulta('revoke execute on function public.cumplimiento_de_proveedores(uuid[]) from authenticated')
  try {
    // El servidor anota el error en su consola; el navegador no tiene por qué verlo.
    await ir(pagina, '/proveedores')
    const aviso = limpio(await pagina.getByRole('status').filter({ hasText: 'cumplimiento' }).first().textContent().catch(() => ''))
    comprobar(aviso.startsWith('No se pudo leer el cumplimiento'), `sin respuesta de la base, la pantalla lo dice: «${aviso}»`)
    comprobar((await pagina.locator('tr[data-proveedor]').count()) > 0, 'sin respuesta de la base, el padrón sale igual')
    comprobar((await pagina.locator('[data-cumplimiento]').count()) === 0, 'sin respuesta de la base, no inventa cifras')
  } finally {
    await consulta('grant execute on function public.cumplimiento_de_proveedores(uuid[]) to authenticated')
  }
  await contexto.close()
  // En desarrollo Next le pasa al navegador lo que el servidor anotó: aquí es el error buscado, no uno de la pantalla.
  for (let i = errores.length - 1; i >= 0; i--)
    if (errores[i].includes('No se pudo leer el cumplimiento de los proveedores: permission denied')) errores.splice(i, 1)
}

comprobar(errores.length === 0, `sin errores de consola ni de hidratación ${errores.slice(0, 5).join(' | ')}`)

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} cosa(s) no cuadran:\n${fallas.map((f) => ` - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTodo en orden.')

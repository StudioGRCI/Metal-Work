/**
 * El inicio de cada puesto, entrega 3 del plan de orden y diseño (2026-11-25):
 * «Te toca» arriba, con el enlace a cada pendiente; las cifras después, en
 * filas llenas; «Tus módulos» al final en el teléfono.
 *
 *   1. Con la cuenta de cada puesto, a 1440 × 900: «Te toca» es lo primero
 *      bajo el encabezado; cada fila lleva a una pantalla de su menú; lo que
 *      suman sus filas es lo que dice arriba y lo que cuentan los globos del
 *      menú; las cifras van en filas llenas; nada se sale por el costado.
 *   2. Con la misma cuenta, a 390: «Te toca» empieza en la primera pantalla,
 *      cada fila mide 44 px para el dedo, «Tus módulos» va al final y nada se
 *      sale por el costado.
 *   3. Con el rol de Gerencia y de Contabilidad, tres cuentas son las de la
 *      base (y el monto de las compras por aprobar, «sin IGV»), y tocar su
 *      fila abre su pantalla.
 *   4. Una cuenta que no se puede leer (una política que le da error a la
 *      cuenta de RR. HH., y se quita al terminar) sale como «No se pudo
 *      contar», nunca como «Nada te espera».
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_CHROMIUM.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR =
  process.env.BANCO_CHROMIUM ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((r) => existsSync(r))
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const PUESTOS = [
  'gerencia', 'gerencia.comercial', 'gerencia.produccion', 'administracion', 'almacen', 'logistica', 'mantenimiento',
  'conductor', 'contabilidad', 'diseno', 'colaborador', 'porteria', 'rrhh', 'requerimientos',
  'sup.prd', 'sup.mtz', 'sup.acb', 'tesoreria', 'tramitador', 'ventas',
]
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

try {
const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, viewport) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  pagina.on('pageerror', (e) => errores.push(`pageerror ${e.message.slice(0, 300)}`))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', `${puesto}.local@metalwork.test`)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${puesto}`)
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await pagina.waitForSelector('main h1')
  return { pagina, contexto, errores }
}

/** Lo que dice «Te toca»: sus filas (texto, enlace, cantidad, monto, alto) y su cabecera. */
const leerTeToca = (pagina) =>
  pagina.evaluate(() => {
    const tarjeta = document.querySelector('[data-te-toca]')
    if (!tarjeta) return null
    const bloques = [...tarjeta.parentElement.children]
    // `data-cantidad`: no toda fila empieza con su número («Tu reporte diario de hoy…»).
    const filas = [...tarjeta.querySelectorAll('li a')].map((a) => {
      const caja = a.getBoundingClientRect()
      const texto = a.innerText.replace(/\s+/g, ' ').trim()
      return {
        texto,
        href: a.getAttribute('href'),
        cantidad: Number(a.dataset.cantidad ?? NaN),
        monto: a.querySelector('[data-monto]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        alto: caja.height,
      }
    })
    // La cabecera de la tarjeta: «Te toca» y, debajo, «En M pantallas de tu menú · N sin comprobar».
    const cabecera = tarjeta.firstElementChild?.innerText.replace(/\s+/g, ' ').trim() ?? ''
    return {
      primero: bloques[0] === tarjeta,
      arriba: Math.round(tarjeta.getBoundingClientRect().top + window.scrollY),
      filas,
      cabecera,
      sinComprobar: [...tarjeta.querySelectorAll('li a')].filter((a) => a.innerText.includes('No se pudo contar')).length,
      vacio: Boolean(tarjeta.querySelector('[data-sin-datos]')),
    }
  })

// ---------------------------------------------------------------- 1. monitor
console.log('1. Cada puesto, a 1440 × 900')
for (const puesto of PUESTOS) {
  const { pagina, contexto, errores } = await entrar(puesto, { width: 1440, height: 900 })
  const te = await leerTeToca(pagina)
  const menu = await pagina.evaluate(() => {
    const base = (r) => r.split(/[?#]/)[0]
    const nav = document.querySelector('aside nav[aria-label="Menú principal"]')
    const rutas = new Set([...nav.querySelectorAll('a[href]')].map((a) => base(a.getAttribute('href'))))
    // Un globo por ruta: la misma pantalla en dos grupos lleva el mismo número.
    const globos = new Map()
    for (const a of nav.querySelectorAll('a[aria-label]')) {
      const n = a.getAttribute('aria-label').match(/, (\d+) pendientes?$/)
      if (n) globos.set(base(a.getAttribute('href')), Number(n[1]))
    }
    return { rutas: [...rutas], globos: [...globos.values()].reduce((s, n) => s + n, 0) }
  })
  // Por cada rejilla de cifras, sus renglones: cuántas tarjetas y si el último llega al borde.
  const cifras = await pagina.evaluate(() => {
    const renglones = new Map()
    for (const r of document.querySelectorAll('main section .rotulo-indicador')) {
      const tarjeta = r.closest('a, div.grid > *')
      const grid = tarjeta?.parentElement
      if (!grid) continue
      const g = grid.getBoundingClientRect()
      const t = tarjeta.getBoundingClientRect()
      const clave = `${Math.round(g.top)}|${Math.round(t.top)}`
      const fila = renglones.get(clave) ?? { n: 0, derecha: 0, borde: g.right }
      renglones.set(clave, { ...fila, n: fila.n + 1, derecha: Math.max(fila.derecha, t.right) })
    }
    const porRejilla = new Map()
    for (const [clave, fila] of renglones) {
      const g = clave.split('|')[0]
      porRejilla.set(g, [...(porRejilla.get(g) ?? []), fila])
    }
    return [...porRejilla.values()].map((filas) => ({ cuantas: filas.map((f) => f.n), llenas: filas.every((f) => f.borde - f.derecha < 2) }))
  })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  if (!te) {
    comprobar(menu.globos === 0, `${puesto}: sin cuentas que llevar, no hay «Te toca» ni globos en el menú`)
  } else {
    comprobar(te.primero, `${puesto}: «Te toca» es lo primero bajo el encabezado`)
    const fuera = te.filas.filter((f) => !menu.rutas.includes(f.href.split(/[?#]/)[0]))
    comprobar(fuera.length === 0, `${puesto}: cada fila lleva a una pantalla de su menú${fuera.length ? ` (no: ${fuera.map((f) => f.href).join(', ')})` : ''}`)
    const suma = te.filas.reduce((n, f) => n + (Number.isNaN(f.cantidad) ? 0 : f.cantidad), 0)
    comprobar(te.vacio ? te.filas.length === 0 && menu.globos === 0 : suma === menu.globos,
      `${puesto}: ${te.vacio ? 'dice «Nada te espera» y el menú no tiene globos' : `${te.filas.length} filas suman ${suma}, lo que cuentan los globos del menú (${menu.globos})`}`)
    const pantallas = new Set(te.filas.filter((f) => !Number.isNaN(f.cantidad)).map((f) => f.href.split(/[?#]/)[0])).size
    comprobar(pantallas > 1 ? te.cabecera.includes(`En ${pantallas} pantallas`) : !/pantallas/.test(te.cabecera),
      `${puesto}: la cabecera dice en cuántas pantallas espera algo (${te.cabecera})`)
  }
  const disparejas = cifras.filter((r) => !r.llenas || r.cuantas.some((n) => n !== r.cuantas[0]))
  comprobar(disparejas.length === 0, `${puesto}: las cifras van en filas llenas (${cifras.map((r) => r.cuantas.join('+') + (r.llenas ? '' : ' con hueco')).join(' · ') || 'sin cifras'})`)
  comprobar(ancho <= 1440, `${puesto}: nada se sale por el costado (${ancho} px)`)
  comprobar(errores.length === 0, `${puesto}: sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  if (puesto === 'administracion') await pagina.screenshot({ path: join(CAPTURAS, 'te-toca-administracion-1440.png') })
  await contexto.close()
}

// ---------------------------------------------------------------- 2. teléfono
console.log('2. Cada puesto, a 390')
for (const puesto of PUESTOS) {
  const { pagina, contexto, errores } = await entrar(puesto, { width: 390, height: 844 })
  const te = await leerTeToca(pagina)
  const orden = await pagina.evaluate(() => {
    const bloques = [...(document.querySelector('[data-te-toca]')?.parentElement ?? document.querySelector('main section')?.parentElement ?? document.body).children]
    return { ultimo: bloques.at(-1)?.getAttribute('aria-label') ?? null, ancho: document.documentElement.scrollWidth }
  })
  if (te) {
    comprobar(te.arriba < 400, `${puesto}: «Te toca» empieza en la primera pantalla (${te.arriba} px)`)
    const bajas = te.filas.filter((f) => f.alto < 44)
    comprobar(bajas.length === 0, `${puesto}: cada fila mide 44 px o más para el dedo${bajas.length ? ` (${bajas.map((f) => Math.round(f.alto)).join(', ')})` : ''}`)
  }
  comprobar(orden.ultimo === 'Tus módulos', `${puesto}: «Tus módulos» va al final (${orden.ultimo})`)
  comprobar(orden.ancho <= 390, `${puesto}: nada se sale por el costado (${orden.ancho} px)`)
  comprobar(errores.length === 0, `${puesto}: sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  if (puesto === 'tesoreria') await pagina.screenshot({ path: join(CAPTURAS, 'te-toca-tesoreria-390.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 3. contra la base, con el rol de cada puesto
console.log('3. Las cuentas son las de la base con el rol de cada puesto, y cada fila lleva a su pantalla')
/** Una lectura con la sesión de la cuenta, como la hace la pantalla: RLS y funciones con su `auth.uid()`. */
async function conSuRol(puesto, sql) {
  const { rows: [u] } = await base.query('select id from public.usuarios where correo = $1', [`${puesto}.local@metalwork.test`])
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [u.id])
    await base.query('set local role authenticated')
    return (await base.query(sql)).rows
  } finally {
    await base.query('rollback')
  }
}
const CRUCES = [
  {
    puesto: 'gerencia', fila: /trabajos? sin orden por aprobar/,
    sql: `select count(*)::int as n, null::numeric as pen from public.v_flota_avance_diario where revision = 'PENDIENTE'`,
  },
  {
    // Lo que vale va sin IGV, en soles, como en Aprobación de compras.
    puesto: 'gerencia', fila: /compras? (o|y) servicios? por aprobar/, rotulo: 'sin IGV',
    // En soles lo que está en soles o ya tiene su cambio, como la cuenta.
    sql: `select count(*)::int as n, sum(case when monto_pen is not null or moneda is distinct from 'USD' then coalesce(monto_pen, monto) end) as pen
            from public.documentos_por_aprobar() where aprobacion = 'POR_APROBAR'`,
  },
  {
    puesto: 'contabilidad', fila: /sin factura/,
    sql: `select count(*)::int as n, null::numeric as pen from public.compras_sin_factura()`,
  },
]
for (const cruce of CRUCES) {
  const [{ n, pen }] = await conSuRol(cruce.puesto, cruce.sql)
  const { pagina, contexto, errores } = await entrar(cruce.puesto, { width: 1440, height: 900 })
  const te = await leerTeToca(pagina)
  const fila = te?.filas.find((f) => cruce.fila.test(f.texto))
  comprobar(n === 0 ? !fila : fila?.cantidad === n, `${cruce.puesto}: «${cruce.fila.source}» dice ${fila?.cantidad ?? 0} y la base, con su rol, ${n}`)
  if (fila && cruce.rotulo) {
    const esperado = `S/ ${Number(pen).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cruce.rotulo}`
    comprobar(fila.monto === esperado, `${cruce.puesto}: su monto dice «${fila.monto}» (la base: «${esperado}»)`)
  }
  if (fila) {
    await pagina.locator(`[data-te-toca] a[href="${fila.href}"]`).click()
    await pagina.waitForURL((u) => u.pathname === fila.href.split(/[?#]/)[0], { timeout: 30000 }).catch(() => {})
    comprobar(new URL(pagina.url()).pathname === fila.href.split(/[?#]/)[0], `${cruce.puesto}: tocar la fila abre ${fila.href}`)
  }
  comprobar(errores.length === 0, `${cruce.puesto}: sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 4. una cuenta que falla
console.log('4. Una cuenta que no se puede leer no sale como «nada»')
{
  // Solo para la cuenta de RR. HH.: leer los reportes diarios le da error.
  const { rows: [u] } = await base.query(`select id from public.usuarios where correo = 'rrhh.local@metalwork.test'`)
  // Si una corrida anterior se cortó con la política puesta, se quita antes.
  await base.query('drop policy if exists prb_te_toca_falla on public.reportes_diarios')
  await base.query(`create policy prb_te_toca_falla on public.reportes_diarios as restrictive for select to authenticated
    using (auth.uid() is distinct from '${u.id}'::uuid or (auth.uid()::text || 'x')::int = 0)`)
  // El error sale solo al evaluarse con esa cuenta: un \`1 / 0\` lo calcula
  // Postgres al planear la consulta y fallaba para todas.
  try {
    const { pagina, contexto } = await entrar('rrhh', { width: 1440, height: 900 })
    const te = await leerTeToca(pagina)
    comprobar(te && !te.vacio, 'no dice «Nada te espera por ahora»')
    comprobar(te?.sinComprobar === 1, 'una fila dice «No se pudo contar lo que te espera»')
    comprobar(/1 sin comprobar/.test(te?.cabecera ?? ''), `la cabecera dice que falta comprobar una (${te?.cabecera})`)
    await pagina.screenshot({ path: join(CAPTURAS, 'te-toca-sin-comprobar-1440.png') })
    await contexto.close()
    // Otra cuenta que también lee los reportes diarios no se entera.
    const otra = await entrar('sup.prd', { width: 1440, height: 900 })
    const suya = await leerTeToca(otra.pagina)
    comprobar(suya && suya.sinComprobar === 0, 'la falla es solo de RR. HH.: Supervisión de Producción cuenta sus reportes sin problema')
    await otra.contexto.close()
  } finally {
    await base.query('drop policy if exists prb_te_toca_falla on public.reportes_diarios')
  }
}

await navegador.close()
if (fallas.length) {
  console.log(`\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}`)
  process.exitCode = 1
} else console.log('\nTodo pasa.')
} finally {
  await base.end()
}

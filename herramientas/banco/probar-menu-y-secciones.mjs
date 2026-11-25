/**
 * El menú y el marco de la entrega 2 del plan de orden y diseño (2026-11-25):
 * menú lateral compacto con grupos que se pliegan y lo recuerdan, y una sola
 * fila de secciones para la OT y el código interno.
 *
 *   1. Con la cuenta de cada uno de los 18 puestos, a 1440 × 900, el menú
 *      entra entero sin deslizar y no repite ícono entre dos pantallas.
 *   2. Con Administración: un grupo plegado sigue plegado al recargar y
 *      vuelve a abrirse; plegado, la pantalla que se abre dentro de él lo abre
 *      solo; y al recargar en una ventana baja, la entrada activa queda a la
 *      vista dentro del menú sin mover la página.
 *   3. La OT, en el monitor: sus secciones van en la fila de arriba, no en la
 *      barra lateral.
 *   4. El código interno, en el teléfono: entrar no deja la página a media
 *      pantalla, y cambiar de sección deja la fila a la vista.
 *
 * Necesita una OT y una unidad con código interno: si el banco no trae
 * unidad con código, le pone uno de prueba (`PRB_SECCIONES`) a la primera.
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
  'gerencia', 'gerencia.comercial', 'gerencia.produccion', 'administracion', 'almacen', 'logistica',
  'conductor', 'contabilidad', 'diseno', 'colaborador', 'porteria', 'rrhh', 'requerimientos',
  'sup.prd', 'sup.mtz', 'sup.acb', 'tesoreria', 'ventas',
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
const { rows: [orden] } = await base.query('select id, numero from public.ordenes_trabajo order by numero limit 1')
let { rows: [unidad] } = await base.query(
  'select codigo_interno from public.unidades where codigo_interno is not null and activo order by codigo_interno limit 1',
)
if (!unidad) {
  ;({ rows: [unidad] } = await base.query(`update public.unidades set codigo_interno = 'PRB_SECCIONES'
     where id = (select id from public.unidades where activo order by placa limit 1) returning codigo_interno`))
}
await base.end()
if (!orden || !unidad) {
  console.error('El banco no trae una OT o una unidad: corre preparar.sh.')
  process.exit(1)
}

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
  return { pagina, contexto, errores }
}

const MENU = 'aside nav[aria-label="Menú principal"]'

// ---------------------------------------------------------------- 1. cada puesto
console.log('1. El menú de cada puesto, a 1440 × 900')
for (const puesto of PUESTOS) {
  const { pagina, contexto, errores } = await entrar(puesto, { width: 1440, height: 900 })
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const m = await pagina.evaluate((sel) => {
    const nav = document.querySelector(sel)
    const filas = [...nav.querySelectorAll('a[href]')].map((a) => ({
      ruta: a.getAttribute('href').split('?')[0],
      icono: [...(a.querySelector('svg')?.classList ?? [])].find((c) => c.startsWith('lucide-') && c !== 'lucide-icon'),
      titulo: a.textContent.trim(),
    }))
    const porIcono = {}
    for (const f of filas) (porIcono[f.icono] ??= new Map()).set(f.ruta, f.titulo)
    return {
      alto: nav.scrollHeight,
      visible: nav.clientHeight,
      entradas: filas.length,
      repetidos: Object.entries(porIcono).filter(([, r]) => r.size > 1).map(([i, r]) => `${i}: ${[...r.values()].join(' / ')}`),
    }
  }, MENU)
  comprobar(m.alto <= m.visible + 1, `${puesto}: ${m.entradas} entradas en ${m.alto} de ${m.visible} px`)
  comprobar(m.repetidos.length === 0, `${puesto}: ningún ícono repetido${m.repetidos.length ? ` (${m.repetidos.join('; ')})` : ''}`)
  comprobar(errores.length === 0, `${puesto}: sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 2. pliegues
console.log('2. Los grupos de Administración se pliegan y lo recuerdan')
{
  const { pagina, contexto, errores } = await entrar('administracion', { width: 1440, height: 900 })
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const botones = pagina.locator(`${MENU} button[aria-expanded]`)
  comprobar((await botones.count()) > 0, 'el menú tiene grupos que se pliegan')
  // El último grupo, que no es el de la pantalla abierta (el inicio).
  const grupo = botones.last()
  const titulo = (await grupo.textContent()).trim()
  const lista = pagina.locator(`[id="${await grupo.getAttribute('aria-controls')}"]`)
  const primera = await lista.locator('a[href]').first().getAttribute('href')
  await grupo.click()
  comprobar((await grupo.getAttribute('aria-expanded')) === 'false' && (await lista.isHidden()), `«${titulo}» se pliega`)
  await pagina.reload({ waitUntil: 'networkidle' })
  await pagina.waitForTimeout(300)
  comprobar((await grupo.getAttribute('aria-expanded')) === 'false' && (await lista.isHidden()), `«${titulo}» sigue plegado al recargar`)
  await pagina.screenshot({ path: join(CAPTURAS, 'menu-y-secciones-1-plegado.png') })

  // Plegado, la pantalla que se abre dentro de él lo abre solo.
  await pagina.goto(`${BASE}${primera}`, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(300)
  comprobar((await grupo.getAttribute('aria-expanded')) === 'true', `al entrar a ${primera}, «${titulo}» se abre solo`)
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(300)
  comprobar((await grupo.getAttribute('aria-expanded')) === 'false', `al volver al inicio, «${titulo}» vuelve a como lo dejó`)
  await grupo.click()
  await pagina.reload({ waitUntil: 'networkidle' })
  await pagina.waitForTimeout(300)
  comprobar((await grupo.getAttribute('aria-expanded')) === 'true', `«${titulo}» se vuelve a abrir y queda abierto al recargar`)

  // Ventana baja: el menú desliza y la entrada activa tiene que verse al cargar.
  await pagina.setViewportSize({ width: 1440, height: 560 })
  const rutas = await pagina.locator(`${MENU} a[href]`).evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  const ultima = rutas.at(-1)
  await pagina.goto(`${BASE}${ultima}`, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(400)
  const v = await pagina.evaluate((sel) => {
    const nav = document.querySelector(sel)
    const a = nav.querySelector('a[aria-current="page"]')
    if (!a) return null
    const n = nav.getBoundingClientRect()
    const r = a.getBoundingClientRect()
    return { dentro: r.top >= n.top && r.bottom <= n.bottom, desliza: nav.scrollTop, pagina: window.scrollY }
  }, MENU)
  await pagina.screenshot({ path: join(CAPTURAS, 'menu-y-secciones-2-activa-a-la-vista.png') })
  comprobar(v?.dentro === true, `al cargar ${ultima} en una ventana de 560 px, su entrada se ve en el menú (desliza ${v?.desliza} px)`)
  comprobar(v?.pagina === 0, 'y la página no se movió')
  comprobar(errores.length === 0, `sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 3. la OT
console.log(`3. La OT ${orden.numero}, en el monitor`)
{
  const { pagina, contexto, errores } = await entrar('administracion', { width: 1440, height: 900 })
  await pagina.goto(`${BASE}/ordenes/${orden.id}`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`nav[aria-label="Secciones de la OT ${orden.numero}"]`)
  comprobar(await fila.isVisible(), 'la fila de secciones se ve arriba del contenido')
  comprobar((await fila.locator('a[aria-current="page"]').count()) === 1, 'marca una sección elegida')
  const enMenu = await pagina.locator(`${MENU} a[href*="/ordenes/${orden.id}"]`).count()
  comprobar(enMenu === 0, 'la barra lateral ya no lleva las secciones de la OT')
  await fila.getByRole('link', { name: /^Historial/ }).click()
  await pagina.waitForURL(/vista=bitacora/)
  comprobar(
    (await fila.locator('a[aria-current="page"]').textContent()).startsWith('Historial'),
    'tocar «Historial» la marca elegida',
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'menu-y-secciones-3-ot.png') })
  comprobar(errores.length === 0, `sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 4. el código interno
console.log(`4. El código interno ${unidad.codigo_interno}, en el teléfono`)
{
  const { pagina, contexto, errores } = await entrar('administracion', { width: 390, height: 844 })
  await pagina.goto(`${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent(unidad.codigo_interno)}`, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(400)
  comprobar((await pagina.evaluate(() => window.scrollY)) < 10, 'entrar deja la página arriba, no a media pantalla')
  const fila = pagina.locator(`nav[aria-label="Secciones del código ${unidad.codigo_interno}"]`)
  comprobar((await fila.count()) === 1, 'el código lleva la misma fila de secciones que la OT')
  const otra = fila.locator('a:not([aria-current])').last()
  const nombre = (await otra.textContent()).trim()
  await otra.click()
  await pagina.waitForURL(/vista=/)
  await pagina.waitForTimeout(600)
  const caja = await fila.boundingBox()
  comprobar(caja && caja.y >= 0 && caja.y < 844 / 2, `al tocar «${nombre}» la fila queda arriba, a la vista (${Math.round(caja?.y ?? -1)} px)`)
  const elegida = await fila.locator('a[aria-current="page"]').boundingBox()
  comprobar(elegida && elegida.x >= 0 && elegida.x + elegida.width <= 390, 'y la pestaña elegida se ve entera, sin deslizar a mano')
  await pagina.screenshot({ path: join(CAPTURAS, 'menu-y-secciones-4-codigo-telefono.png') })
  comprobar(errores.length === 0, `sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
if (fallas.length) {
  console.log(`\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}`)
  process.exit(1)
}
console.log('\nTodo pasa.')

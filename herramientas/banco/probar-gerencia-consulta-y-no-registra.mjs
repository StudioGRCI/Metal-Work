/**
 * Clic real sobre la decisión de StudioGRCI del 2026-10-20 (migración
 * 20261020206000): «Quitar, menos anular». Gerencia consulta y aprueba;
 * registrar en el almacén, en compras y en producción es de cada puesto.
 *
 * Con la cuenta de cada puesto: el almacén y Logística ven sus botones para
 * registrar en el kardex y en las compras; Gerencia abre las mismas pantallas,
 * las lee y no tiene ninguno. En los trabajos sin orden Gerencia aprueba pero
 * no registra uno nuevo; el catálogo de materiales, la gestión de recojos y el
 * alta de un trabajo sin orden ya no le abren. Sigue anulando una OT.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

// Los botones que registran algo. Ver, buscar, filtrar o descargar no cuentan,
// y aprobar, devolver o anular son de Gerencia: van aparte.
const REGISTRA = /^(Registrar|Nuevo|Nueva|Agregar|Conteo|Contar|Emitir|Corregir|Mandar|Programar|Dar de alta|Crear|Cargar|Subir|Despachar|Recibir|Entregar|Fijar)/i

// Cada pantalla con el puesto que registra en ella.
const PANTALLAS = [
  ['/almacen/kardex', 'el kardex', 'almacen.local@metalwork.test'],
  ['/compras/ordenes', 'las órdenes de compra', 'logistica.local@metalwork.test'],
  ['/compras/servicios', 'las órdenes de servicio', 'logistica.local@metalwork.test'],
  ['/avance/trabajos', 'los trabajos sin orden', 'sup.prd.local@metalwork.test'],
]
// Lo que era solo para registrar y ya no le abre.
const CERRADAS = [
  ['/materiales', 'el catálogo de materiales'],
  ['/avance/trabajos/nueva', 'el alta de un trabajo sin orden'],
  ['/compras/gestion', 'la gestión de recojos'],
]

// Un trabajo sin orden con un reporte por aprobar, para ver que Gerencia lo
// aprueba. Se siembra por debajo de las políticas con una marca propia; el
// supervisor de Producción figura como quien lo reportó.
const sello = `QA-GER-${Date.now().toString().slice(-6)}`
let trabajoId = null
{
  const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
  await base.connect()
  const [sup] = (await base.query("select id, area_id from public.usuarios where correo = 'sup.prd.local@metalwork.test'")).rows
  const [flota] = (await base.query(
    "insert into public.flota_unidades (trabajo, descripcion, cliente) values ($1, 'Trabajo de prueba de Gerencia', 'QA') returning id",
    [sello],
  )).rows
  await base.query(
    "insert into public.flota_avances (flota_id, area_id, descripcion, registrado_por) values ($1, $2, $3, $4)",
    [flota.id, sup.area_id, `Avance ${sello}`, sup.id],
  )
  trabajoId = flota.id
  await base.end()
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}

async function botones(pagina) {
  const nombres = await pagina.locator('main').getByRole('button').evaluateAll((bs) =>
    bs.filter((b) => b.offsetParent !== null).map((b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()),
  )
  const enlaces = await pagina.locator('main').getByRole('link').evaluateAll((as) =>
    as.filter((a) => a.offsetParent !== null).map((a) => (a.getAttribute('aria-label') || a.innerText || '').replace(/\s+/g, ' ').trim()),
  )
  return [...nombres, ...enlaces].filter((n) => REGISTRA.test(n))
}

const delPuesto = new Map()
for (const correo of new Set(PANTALLAS.map(([, , c]) => c))) {
  const { pagina, contexto } = await entrar(correo)
  for (const [ruta, titulo] of PANTALLAS.filter(([, , c]) => c === correo)) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const suyos = await botones(pagina)
    delPuesto.set(ruta, suyos)
    comprobar(suyos.length > 0, `${correo.split('.local')[0]} registra en ${titulo}: ${suyos.join(', ')}`)
  }
  await contexto.close()
}

{
  const { pagina, contexto, errores } = await entrar('gerencia.local@metalwork.test')
  for (const [ruta, titulo] of PANTALLAS) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const texto = (await pagina.locator('main').innerText()).replace(/\s+/g, ' ')
    comprobar(pagina.url().endsWith(ruta) && texto.length > 40, `Gerencia abre y lee ${titulo}`)
    const suyos = await botones(pagina)
    comprobar(suyos.length === 0, `y no registra nada${suyos.length ? `: ${suyos.join(', ')}` : ''} (el puesto ve ${delPuesto.get(ruta).length})`)
    if (ruta === '/almacen/kardex') await pagina.screenshot({ path: join(CAPTURAS, 'gerencia-kardex-sin-botones.png'), fullPage: true })
  }

  // Los trabajos sin orden los sigue aprobando.
  {
    await pagina.goto(`${BASE}/avance/trabajos/${trabajoId}`, { waitUntil: 'networkidle' })
    const aprobar = await pagina.locator('main').getByRole('button', { name: /^Aprobar/ }).count()
    comprobar(aprobar > 0, 'Gerencia sigue teniendo «Aprobar» en un trabajo sin orden')
  }

  // Y sigue anulando una OT.
  const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
  await base.connect()
  const [ot] = (await base.query("select id from public.ordenes_trabajo where estado = 'EN_PROCESO' limit 1")).rows
  await base.end()
  if (ot) {
    await pagina.goto(`${BASE}/ordenes/${ot.id}`, { waitUntil: 'networkidle' })
    const anular = await pagina.locator('main').getByRole('button', { name: /^Anular/ }).count()
    comprobar(anular > 0, 'Gerencia sigue teniendo «Anular» en una OT en proceso')
  } else {
    comprobar(false, 'hay una OT en proceso en el banco para ver que Gerencia la anula')
  }

  for (const [ruta, titulo] of CERRADAS) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(!pagina.url().endsWith(ruta), `${titulo} ya no le abre (va a ${new URL(pagina.url()).pathname})`)
  }
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
console.log(fallas.length ? `\n${fallas.length} comprobación(es) fallaron.` : '\nTodo bien: cada puesto registra lo suyo y Gerencia consulta y aprueba.')
process.exit(fallas.length ? 1 : 0)

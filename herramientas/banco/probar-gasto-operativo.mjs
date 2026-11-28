/**
 * Clic real sobre «Gasto operativo» (plan del gasto operativo, entrega 2), con
 * la cuenta de cada puesto (nunca ADMIN). DKS, 2026-11-27: lo que las áreas
 * piden para trabajar va como gasto operativo; Gerencia y Administración lo ven
 * de todas las áreas, cada supervisor el de la suya.
 *
 *   1. Gerencia y Administración entran desde su menú: el total del mes es lo
 *      que la base suma, «Por área» trae una fila por área y tocar una deja
 *      solo sus líneas.
 *   2. El supervisor de Producción y el de Maestranza ven solo lo de su área,
 *      sin «Por área» ni la mano de obra, y su total es el de su área en la base.
 *   3. Almacén no la abre.
 *
 * Antes, el banco con gasto cargado a PLANTA (salidas de RQ del área y OS).
 * Capturas a 390 y 1440 en CAPTURAS/gasto-operativo.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS,
 * BANCO_CHROMIUM.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => `${puesto}.local@metalwork.test`
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'gasto-operativo')
mkdirSync(carpeta, { recursive: true })

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
const centimos = (t) => Number((t ?? '').replace(/[^\d]/g, ''))

/** Lo que la base suma en el mes, con la sesión de esa cuenta: lo mismo que lee la pantalla. */
async function totalDe(correo, area = null) {
  await base.query('begin')
  try {
    const [u] = await consulta('select id from public.usuarios where correo = $1', [correo])
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [
      u.id,
      JSON.stringify({ sub: u.id, role: 'authenticated' }),
    ])
    await base.query('set local role authenticated')
    const [f] = await consulta(
      `select coalesce(sum(soles) filter (where suma), 0)::numeric(14,2)::text as soles, count(*)::int as lineas,
              count(*) filter (where grupo = 'MANO_OBRA')::int as mano_obra,
              count(*) filter (where grupo = 'SUBCONTRATOS')::int as subcontratos, count(distinct area)::int as areas
         from public.gasto_operativo(date_trunc('month', now() at time zone 'America/Lima')::date,
                                     (date_trunc('month', now() at time zone 'America/Lima') + interval '1 month - 1 day')::date)
        where $1::text is null or area = $1`,
      [area],
    )
    return f
  } finally {
    await base.query('rollback')
  }
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1440) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
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

async function sinDesborde(pagina, quien) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  comprobar(sobra <= 0, `${quien}: la página no se sale de costado (${sobra} px)`)
}

// ------------------------------------------------ 1. Gerencia y Administración
for (const puesto of ['gerencia', 'administracion']) {
  const correo = cuenta(puesto)
  const esperado = await totalDe(correo)
  for (const ancho of [390, 1440]) {
    const { pagina, contexto, errores } = await entrar(correo, ancho)
    const quien = `${puesto} a ${ancho}`
    await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    // Desde su menú: en el monitor la barra lateral; en el teléfono, «Más».
    const enlace = pagina.locator('a[href="/gasto-operativo"]').first()
    if (ancho === 390) {
      const mas = pagina.getByRole('button', { name: /Más/ }).first()
      if (await mas.isVisible().catch(() => false)) await mas.click()
    } else {
      const grupo = pagina.getByRole('button', { name: /Finanzas|Administración/ }).first()
      if (!(await enlace.isVisible().catch(() => false)) && (await grupo.isVisible().catch(() => false))) await grupo.click()
    }
    comprobar((await enlace.count()) > 0, `${quien}: «Gasto operativo» está en su menú`)
    await pagina.goto(`${BASE}/gasto-operativo`, { waitUntil: 'networkidle' })
    const total = limpio(await pagina.locator('[data-total]').innerText())
    comprobar(centimos(total) === centimos(esperado.soles), `${quien}: el total del mes (${total}) es lo que suma la base (S/ ${esperado.soles})`)
    const filas = pagina.locator('[data-por-area] tbody tr')
    comprobar((await filas.count()) === esperado.areas, `${quien}: «Por área» trae ${esperado.areas} áreas (${await filas.count()})`)
    comprobar((await pagina.locator('[data-lineas-gasto-operativo] tbody tr').count()) === esperado.lineas, `${quien}: una fila por línea (${esperado.lineas})`)
    await sinDesborde(pagina, quien)
    await pagina.screenshot({ path: join(carpeta, `${puesto}-${ancho}.png`), fullPage: true })

    // Tocar Maestranza deja solo lo suyo.
    const mtz = await totalDe(correo, 'Maestranza')
    await Promise.all([pagina.waitForURL(/area=/), pagina.locator('[data-por-area] tbody a', { hasText: 'Maestranza' }).click()])
    await pagina.waitForLoadState('networkidle')
    const deMtz = limpio(await pagina.locator('[data-total]').innerText())
    comprobar(centimos(deMtz) === centimos(mtz.soles), `${quien}: con Maestranza el total es el suyo (${deMtz} = S/ ${mtz.soles})`)
    comprobar((await pagina.locator('[data-lineas-gasto-operativo] tbody tr').count()) === mtz.lineas, `${quien}: y solo sus ${mtz.lineas} líneas`)
    if (ancho === 1440 && puesto === 'gerencia') await pagina.screenshot({ path: join(carpeta, `${puesto}-maestranza-${ancho}.png`), fullPage: true })
    // El área elegida sigue al cambiar de mes, aunque ese mes no tenga gasto.
    const antes = new URL(pagina.url()).searchParams.get('mes')
    await pagina.getByRole('link', { name: 'Mes anterior' }).click()
    await pagina.waitForURL((u) => u.searchParams.get('mes') !== antes && u.searchParams.has('mes'))
    await pagina.waitForLoadState('networkidle')
    comprobar(new URL(pagina.url()).searchParams.has('area'), `${quien}: el mes anterior sigue con Maestranza`)
    comprobar(limpio(await pagina.locator('[data-cifras-gasto-operativo] dt').first().innerText()) === 'Gasto de Maestranza', `${quien}: y lo dice`)
    comprobar(errores.length === 0, `${quien}: sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
}

// ------------------------------------------------ 2. Cada supervisor, su área
for (const [puesto, area] of [
  ['sup.prd', 'Producción'],
  ['sup.mtz', 'Maestranza'],
]) {
  const correo = cuenta(puesto)
  const esperado = await totalDe(correo)
  comprobar(esperado.mano_obra === 0, `${puesto}: la base no le da mano de obra`)
  comprobar(esperado.subcontratos === 0, `${puesto}: ni subcontratos`)
  for (const ancho of [390, 1440]) {
    const { pagina, contexto, errores } = await entrar(correo, ancho)
    const quien = `${puesto} a ${ancho}`
    await pagina.goto(`${BASE}/gasto-operativo`, { waitUntil: 'networkidle' })
    const total = limpio(await pagina.locator('[data-total]').innerText())
    comprobar(centimos(total) === centimos(esperado.soles), `${quien}: su total (${total}) es el de ${area} en la base (S/ ${esperado.soles})`)
    comprobar((await pagina.locator('[data-por-area]').count()) === 0, `${quien}: no ve «Por área»`)
    comprobar((await pagina.locator('[data-grupo="MANO_OBRA"]').count()) === 0, `${quien}: ni la mano de obra`)
    comprobar((await pagina.locator('[data-linea^="SUBCONTRATOS"]').count()) === 0, `${quien}: ni los subcontratos`)
    comprobar((await pagina.locator('[data-lineas-gasto-operativo] tbody tr').count()) === Math.max(esperado.lineas, 1), `${quien}: sus ${esperado.lineas} líneas`)
    // Pedir otra área por la dirección no cambia nada.
    await pagina.goto(`${BASE}/gasto-operativo?area=sin-area`, { waitUntil: 'networkidle' })
    comprobar(centimos(await pagina.locator('[data-total]').innerText()) === centimos(esperado.soles), `${quien}: ?area= no le abre otra área`)
    await sinDesborde(pagina, quien)
    await pagina.goto(`${BASE}/gasto-operativo`, { waitUntil: 'networkidle' })
    await pagina.screenshot({ path: join(carpeta, `${puesto}-${ancho}.png`), fullPage: true })
    comprobar(errores.length === 0, `${quien}: sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
}

// ------------------------------------------------ 3. Almacén no la abre
{
  const { pagina, contexto } = await entrar(cuenta('almacen'), 1440)
  await pagina.goto(`${BASE}/gasto-operativo`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-total]').count()) === 0, 'almacén: no ve el gasto operativo')
  comprobar((await pagina.locator('a[href="/gasto-operativo"]').count()) === 0, 'almacén: ni lo tiene en su menú')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallan` : '\nTodo pasa')
process.exit(fallas.length ? 1 : 0)

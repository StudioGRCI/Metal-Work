/**
 * Cuentas por cobrar con la cuenta de Costos y Materiales, que entra con
 * `tesoreria.ver_documentos` y responde las salidas de vehículos con
 * `tesoreria.liberar`, pero no lee las cotizaciones aprobadas
 * (`cotizaciones_para_facturar` le responde «sin permiso»). Antes se le caía
 * la pantalla entera; ahora:
 *
 *   1. Costos abre Cuentas por cobrar, ve las facturas y las salidas por revisar,
 *      sin «Cotizaciones aprobadas» y sin decirle que un código «no tiene
 *      cotización aprobada» (no lo sabe: no la lee).
 *   2. Tesorería sigue viendo lo cobrado de cada código junto a cada salida.
 *
 * Costos no es una cuenta del banco: el script da de alta la suya,
 * `costos.cobrar@banco.test`, con la clave del banco. Necesita al menos una
 * salida por revisar con código interno (las siembra
 * `probar-facturas-en-otra-moneda.mjs`).
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const COSTOS = process.env.COSTOS ?? 'costos.cobrar@banco.test'
const TESORERIA = process.env.TESORERIA ?? 'tesoreria.local@metalwork.test'
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
const uno = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

// La cuenta de Costos y Materiales, si no está.
if (!process.env.COSTOS) {
  let fila = await uno('select id from public.usuarios where correo = $1', [COSTOS])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [COSTOS])
    await base.query(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
       select $1, 'COSTOS Y MATERIALES', 'Banco por cobrar', $2, r.id from public.roles r where r.codigo = 'COSTOS'`,
      [fila.id, COSTOS],
    )
  }
  await base.query(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [COSTOS, CLAVE])
}
const { n: pendientes } = await uno(
  `select count(*)::int as n from public.registro_vehiculo_revisiones r join public.registro_vehiculos v on v.id = r.registro_id
    where r.estado = 'PENDIENTE' and v.codigo_interno is not null`,
)
if (!pendientes) throw new Error('El banco no tiene salidas por revisar con código interno: corre antes probar-facturas-en-otra-moneda.mjs.')
await base.end()

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, deviceScaleFactor: 2, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('response', (r) => r.status() >= 500 && errores.push(`${correo}: ${r.status()} ${r.url().slice(0, 120)}`))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'load' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}), pagina.click('button[type="submit"]')])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const w = viewport.width
  {
    const { pagina, contexto } = await entrar(COSTOS, viewport)
    const r = await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
    const texto = (await pagina.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
    comprobar(r?.status() === 200 && /Cuentas por cobrar/.test(texto) && !/No se pudieron leer|Algo salió mal/.test(texto),
      `Costos ${w}: abre Cuentas por cobrar (${r?.status()})`)
    comprobar((await pagina.locator('[data-revision]').count()) === pendientes, `Costos ${w}: ve las ${pendientes} salidas por revisar`)
    comprobar((await pagina.locator('[data-cobro-del-codigo]').count()) === 0, `Costos ${w}: no se le dice nada de lo cobrado, que no lee`)
    comprobar(!/Cotizaciones aprobadas/.test(texto), `Costos ${w}: sin «Cotizaciones aprobadas»`)
    const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho <= w, `Costos ${w}: no se corre de costado (${ancho} px)`)
    await pagina.locator('#salidas-por-revisar').scrollIntoViewIfNeeded().catch(() => {})
    await pagina.screenshot({ path: join(CAPTURAS, `por-cobrar-costos-${w}.png`) })
    await contexto.close()
  }
  {
    const { pagina, contexto } = await entrar(TESORERIA, viewport)
    await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
    comprobar((await pagina.locator('[data-cobro-del-codigo]').count()) === pendientes, `Tesorería ${w}: sigue viendo lo cobrado junto a cada salida`)
    comprobar((await pagina.getByText('Cotizaciones aprobadas').count()) > 0, `Tesorería ${w}: sigue viendo «Cotizaciones aprobadas»`)
    await contexto.close()
  }
}
await navegador.close()
if (errores.length) {
  console.log(`Errores:\n${errores.join('\n')}`)
  fallas.push('errores de consola o 5xx')
}
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo bien')
process.exit(fallas.length ? 1 : 0)

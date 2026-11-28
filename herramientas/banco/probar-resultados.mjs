/**
 * Recorre los resultados de Metal Work (migración 20261128100000) con la cuenta
 * de cada puesto, nunca ADMIN:
 *
 *   1. Gerencia y Contabilidad tienen «Resultados» en su menú y ven el mes de
 *      hoy: cada código interno facturado con su ingreso, su costo y su
 *      ganancia, y el total de Metal Work. Las cifras de la pantalla son las que
 *      da `resultados_metal_work` en la base, con el rol real.
 *   2. El día y el año: las pastillas cambian la escala y las flechas el periodo;
 *      un periodo sin facturas lo dice, no sale en blanco.
 *   3. Administración y Almacén no entran: van a /sin-permiso y no tienen el
 *      enlace en el menú.
 *   4. A 390 y 1440 px nada se sale de costado. Las capturas quedan en CAPTURAS.
 *   5. Lo que la auditoría encontró, mirado contra otra fuente que el reporte:
 *      el mes pasado sin horas resta el sueldo de la oficina que da
 *      `sueldos_oficina_del_mes`; el código sin costo lo dice; lo que todavía
 *      no suma en el gasto operativo se avisa; un periodo que no existe lo dice.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { esperarReactAlNavegar } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
/** «S/ 21,198.07» o «-S/ 5.03» → número. */
const numero = (t) => {
  const s = limpio(t).replace(/[^\d.,-]/g, '').replace(/,/g, '')
  return s ? Number(s) : NaN
}

/** Lo que da la base con la sesión del puesto, en una transacción que se deshace. */
async function resultadosEnLaBase(correo, desde, hasta) {
  await base.query('begin')
  try {
    const [{ id }] = (await base.query('select id from public.usuarios where correo = $1', [correo])).rows
    await base.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
    await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id])
    await base.query('set local role authenticated')
    return (await base.query('select * from public.resultados_metal_work($1, $2)', [desde, hasta])).rows
  } finally {
    await base.query('rollback')
  }
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1440, height: 900 }) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima', deviceScaleFactor: 2 })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
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

async function seSaleDeCostado(pagina) {
  return pagina.evaluate(() => {
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth
    const cajas = [...document.querySelectorAll('[data-por-codigo], [data-total-metal-work], [data-cifras-resultados]')].map(
      (c) => c.scrollWidth - c.clientWidth,
    )
    return Math.max(doc, ...cajas)
  })
}

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const mes = hoy.slice(0, 7)
const ultimo = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate()

// 1 · Gerencia y Contabilidad: el mes de hoy, contra la base.
for (const [puesto, correo] of [
  ['gerencia', 'gerencia.local@metalwork.test'],
  ['contabilidad', 'contabilidad.local@metalwork.test'],
]) {
  console.log(`\n${puesto}`)
  const enBase = await resultadosEnLaBase(correo, `${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`)
  const codigos = enBase.filter((f) => f.tipo === 'CODIGO')

  for (const ancho of [1440, 390]) {
    const { pagina, contexto, errores } = await entrar(correo, { width: ancho, height: ancho < 500 ? 844 : 900 })
    // El menú: en el teléfono va dentro del botón del menú, así que se mira en el monitor.
    if (ancho === 1440) {
      comprobar((await pagina.locator('nav a[href="/resultados"]').count()) > 0, `${puesto}: «Resultados» está en su menú`)
    }
    await pagina.goto(`${BASE}/resultados`, { waitUntil: 'networkidle' })
    comprobar(new URL(pagina.url()).pathname === '/resultados', `${puesto} ${ancho}: entra a /resultados`)
    comprobar(limpio(await pagina.locator('[data-periodo]').textContent()).length > 0, `${puesto} ${ancho}: dice el periodo («${limpio(await pagina.locator('[data-periodo]').textContent())}»)`)

    const filas = pagina.locator('[data-codigo]')
    comprobar((await filas.count()) === codigos.length, `${puesto} ${ancho}: ${codigos.length} códigos como en la base (pantalla ${await filas.count()})`)
    for (const c of codigos) {
      const fila = pagina.locator(`[data-codigo="${c.clave}"]`)
      const texto = limpio(await fila.textContent().catch(() => ''))
      const ganancia = c.ganancia === null ? null : Number(c.ganancia).toLocaleString('en-US', { minimumFractionDigits: 2 })
      comprobar(ganancia === null || texto.includes(ganancia), `${puesto} ${ancho}: ${c.clave} muestra la ganancia ${ganancia}`)
    }

    const total = enBase.reduce(
      (s, f) => (f.tipo === 'CODIGO' ? (f.ganancia === null ? s : s + Number(f.ganancia)) : s - Number(f.soles)),
      0,
    )
    const gananciaEnPantalla = numero(await pagina.locator('[data-renglon="ganancia"] dd').first().textContent().catch(() => ''))
    comprobar(Math.abs(gananciaEnPantalla - Math.round(total * 100) / 100) < 0.011, `${puesto} ${ancho}: ganancia de Metal Work ${gananciaEnPantalla} = ${total.toFixed(2)} de la base`)
    const cifra = numero(await pagina.locator('[data-cifra="ganancia"] dd').first().textContent().catch(() => ''))
    comprobar(cifra === gananciaEnPantalla, `${puesto} ${ancho}: la cifra de arriba dice lo mismo que el total`)

    const sale = await seSaleDeCostado(pagina)
    comprobar(sale <= 0, `${puesto} ${ancho}: nada se sale de costado (${sale} px)`)
    await pagina.screenshot({ path: join(CAPTURAS, `resultados-mes-${puesto}-${ancho}.png`), fullPage: true })

    if (puesto === 'gerencia') {
      // 2 · El año y el día, por las pastillas; y un día sin facturas.
      await pagina.getByRole('link', { name: 'Año', exact: true }).click()
      await pagina.waitForURL((u) => u.searchParams.get('periodo') === hoy.slice(0, 4))
      await pagina.waitForLoadState('networkidle')
      comprobar(limpio(await pagina.locator('[data-periodo]').textContent()).includes(hoy.slice(0, 4)), `gerencia ${ancho}: «Año» lleva a ${hoy.slice(0, 4)}`)
      comprobar((await seSaleDeCostado(pagina)) <= 0, `gerencia ${ancho}: el año no se sale de costado`)
      await pagina.screenshot({ path: join(CAPTURAS, `resultados-ano-gerencia-${ancho}.png`), fullPage: true })

      await pagina.getByRole('link', { name: 'Día', exact: true }).click()
      await pagina.waitForURL((u) => u.searchParams.get('periodo')?.length === 10)
      await pagina.waitForLoadState('networkidle')
      comprobar(new URL(pagina.url()).searchParams.get('periodo') === hoy, `gerencia ${ancho}: «Día» desde el año de hoy lleva a hoy`)

      await pagina.goto(`${BASE}/resultados?periodo=2020-01-01`, { waitUntil: 'networkidle' })
      comprobar((await pagina.locator('[data-codigo]').count()) === 0, `gerencia ${ancho}: un día sin facturas no tiene filas`)
      const vacio = limpio(await pagina.locator('[data-por-codigo]').textContent())
      comprobar(/Ninguna factura de venta el 1 de enero de 2020/.test(vacio), `gerencia ${ancho}: lo dice («${vacio.slice(0, 90)}»)`)
      comprobar(!(await pagina.locator('[data-total-metal-work]').textContent()).includes('-0.00'), `gerencia ${ancho}: el cero no sale «S/ -0.00»`)
      await pagina.screenshot({ path: join(CAPTURAS, `resultados-dia-vacio-gerencia-${ancho}.png`), fullPage: true })

      // Lo que viene después de hoy no se pide: vuelve al mes de hoy.
      await pagina.goto(`${BASE}/resultados?periodo=2999-01`, { waitUntil: 'networkidle' })
      comprobar(limpio(await pagina.locator('[data-periodo]').textContent()).length > 0 && (await pagina.locator('[data-codigo]').count()) === codigos.length, `gerencia ${ancho}: un mes futuro cae al de hoy`)
    }
    comprobar(errores.length === 0, `${puesto} ${ancho}: sin errores en la consola${errores.length ? ` (${errores[0]})` : ''}`)
    await contexto.close()
  }
}

// 5 · Lo que encontró la auditoría.
{
  console.log('\nlo que encontró la auditoría')
  const pasado = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7)
  const [{ horas }] = (await base.query('select count(*)::int as horas from public.horas_por_codigo_del_mes($1)', [`${pasado}-01`])).rows
  const [{ sueldo }] = (await base.query('select coalesce(sum(monto), 0)::numeric as sueldo from public.sueldos_oficina_del_mes($1)', [`${pasado}-01`])).rows
  const { pagina, contexto } = await entrar('gerencia.local@metalwork.test')
  await pagina.goto(`${BASE}/resultados?periodo=${pasado}`, { waitUntil: 'networkidle' })
  const parte = pagina.locator('[data-parte="SUELDOS_OFICINA"]')
  if (horas === 0 && Number(sueldo) > 0) {
    comprobar(Math.abs(numero(await parte.locator('.tabular').textContent().catch(() => '')) - Number(sueldo)) < 0.011,
      `${pasado}, sin horas en ninguna unidad: resta el sueldo de la oficina, S/ ${sueldo}`)
  } else {
    comprobar((await parte.count()) === 0, `${pasado} tiene horas (${horas}) o no tiene sueldo: no sale el sueldo sin repartir`)
  }
  await pagina.screenshot({ path: join(CAPTURAS, `resultados-mes-pasado-gerencia-1440.png`), fullPage: true })

  await pagina.goto(`${BASE}/resultados`, { waitUntil: 'networkidle' })
  const sinCosto = await resultadosEnLaBase('gerencia.local@metalwork.test', `${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`)
  for (const c of sinCosto.filter((f) => f.tipo === 'CODIGO' && Number(f.costo_del_codigo) === 0)) {
    comprobar((await pagina.locator(`[data-codigo="${c.clave}"] [data-aviso-codigo="Sin costo cargado"]`).count()) === 1, `${c.clave}, sin costo: lo dice`)
  }
  const pendientes = sinCosto.filter((f) => f.tipo === 'GASTO_OPERATIVO').reduce((s, f) => s + Number(f.pendientes ?? 0), 0)
  comprobar((await pagina.locator('[data-renglon="operativo"] [data-pendientes]').count()) === (pendientes > 0 ? 1 : 0),
    `el gasto operativo avisa lo que todavía no suma (${pendientes} líneas)`)
  comprobar(!(await pagina.locator('[data-total-metal-work]').textContent()).includes('-0.00'), 'el mes de hoy no tiene «S/ -0.00»')

  await pagina.goto(`${BASE}/resultados?periodo=2026-02-30`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-periodo-no-valido]').count()) === 1, 'un 30 de febrero dice que no existe y qué muestra')
  await contexto.close()
}

// 3 · Quien no debe no entra.
for (const [puesto, correo] of [
  ['administracion', 'administracion.local@metalwork.test'],
  ['almacen', 'almacen.local@metalwork.test'],
]) {
  console.log(`\n${puesto}`)
  const { pagina, contexto } = await entrar(correo)
  comprobar((await pagina.locator('nav a[href="/resultados"]').count()) === 0, `${puesto}: no tiene «Resultados» en el menú`)
  await pagina.goto(`${BASE}/resultados`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `${puesto}: /resultados lo lleva a /sin-permiso (${new URL(pagina.url()).pathname})`)
  let negado = false
  try {
    await resultadosEnLaBase(correo, `${mes}-01`, hoy)
  } catch (e) {
    negado = /No tienes permiso/.test(e.message)
  }
  comprobar(negado, `${puesto}: la base tampoco se lo da`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo bien.')
process.exit(fallas.length ? 1 : 0)

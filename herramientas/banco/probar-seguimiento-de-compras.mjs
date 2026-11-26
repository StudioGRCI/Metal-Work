/**
 * Clic real sobre la migración 20261126420000 (Plan 4.2): quién tiene cada
 * compra y por qué se atrasó. Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Logística, en «Órdenes de compra», ve en cada OC quién la tiene y hace
 *      cuántos días: lo mismo que da la base con su sesión.
 *   2. Anota el motivo del atraso de una OC atrasada tocando «Anotar» tres
 *      veces: entra una sola fila, con su puesto, y la fila lo dice.
 *   3. Corrige la fecha prometida de otra: la fila dice «(corregida)», la fecha
 *      anterior queda en el recorrido y la OC no cambia en la base.
 *   4. En «Órdenes de servicio», el motivo de la OS atrasada.
 *   5. Gerencia y Almacén ven el recorrido y el motivo, sin los botones.
 *   6. En el teléfono (390) nada se sale de la pantalla. Capturas en 390 y 1440.
 *
 * Escribe en el banco (las anotaciones no se borran: son evidencia). Usa las OC
 * y OS atrasadas que dejó la semilla de la 4.1. Variables: BANCO_CLAVE, BASE
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
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

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

const hoy = (await consulta(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as d`))[0].d

// ------------------------------------------------ armazón: dos OC atrasadas y una OS atrasada
const atrasadas = await comoCuenta(
  'logistica',
  `select c.id, coalesce(c.numero, c.referencia) as nombre, p.esperada::text as esperada
     from public.ordenes_compra_materiales c
     cross join lateral public.plazos_de_compras(array[c.id]) p
    where p.atrasada order by p.dias_atraso desc, c.numero`,
)
if (atrasadas.length < 2) throw new Error('El banco necesita al menos dos OC atrasadas: corre la semilla de la 4.1.')
const [ocMotivo, ocFecha] = atrasadas
const [osAtrasada] = await comoCuenta(
  'logistica',
  `select s.id, s.numero as nombre from public.ordenes_servicio s cross join lateral public.plazos_de_servicios(array[s.id]) p
    where p.atrasada order by s.numero limit 1`,
)
const fila = (pagina, nombre) => pagina.locator(`tr[data-compra="${nombre}"]`)

// ------------------------------------------------ 1. Quién la tiene
{
  const { pagina, contexto } = await entrar('logistica')
  await ir(pagina, '/compras/ordenes')
  for (const oc of atrasadas) {
    const [ahora] = await comoCuenta(
      'logistica',
      `select puesto, dias from public.recorrido_de_ordenes_compra(array[$1::uuid]) where situacion = 'AHORA' order by orden limit 1`,
      [oc.id],
    )
    const resumen = limpio(await fila(pagina, oc.nombre).locator('[data-recorrido-ahora]').textContent().catch(() => ''))
    comprobar(
      ahora ? resumen.includes(`La tiene ${ahora.puesto}`) : resumen === '',
      `${oc.nombre}: la fila dice quién la tiene como la base (${ahora?.puesto ?? 'nadie'}; dice «${resumen}»)`,
    )
  }

  // ------------------------------------------------ 2. El motivo, con tres toques
  const antes = Number((await consulta('select count(*) from public.seguimiento_de_compras where orden_compra_id = $1', [ocMotivo.id]))[0].count)
  await fila(pagina, ocMotivo.nombre).getByRole('button', { name: /motivo del atraso/i }).click()
  const ventana = pagina.getByRole('dialog')
  await ventana.getByLabel('Por qué se atrasó').selectOption('PROVEEDOR')
  await ventana.getByLabel('Nota').fill('El proveedor no tenía stock; avisó que llega el lunes.')
  const anotar = ventana.getByRole('button', { name: 'Anotar' })
  await Promise.all([anotar.click(), anotar.click({ force: true }).catch(() => {}), anotar.click({ force: true }).catch(() => {})])
  await pagina.getByRole('status').filter({ hasText: 'Motivo del atraso anotado' }).first().waitFor({ timeout: 15000 })
  await pagina.waitForLoadState('networkidle')
  const filas = await consulta(
    `select s.motivo, s.nota, public.puesto_de(s.registrado_por) as puesto from public.seguimiento_de_compras s
      where s.orden_compra_id = $1 order by s.registrado_en desc`,
    [ocMotivo.id],
  )
  comprobar(filas.length === antes + 1, `tres toques en «Anotar» dejan una sola fila (${filas.length - antes})`)
  comprobar(filas[0]?.motivo === 'PROVEEDOR' && filas[0]?.puesto === 'Logística', `el motivo queda con el puesto de Logística (${filas[0]?.puesto})`)
  const ultimo = limpio(await fila(pagina, ocMotivo.nombre).locator('[data-ultimo-motivo]').first().textContent())
  comprobar(ultimo.startsWith('Atraso: Proveedor · El proveedor no tenía stock') && ultimo.includes('Logística'), `la fila dice el motivo: «${ultimo}»`)

  // ------------------------------------------------ 3. La fecha corregida
  const [{ n: corregidas }] = await consulta(
    `select count(*)::int as n from public.seguimiento_de_compras where orden_compra_id = $1 and tipo = 'FECHA_ESPERADA'`,
    [ocFecha.id],
  )
  const nueva = (await consulta(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [hoy, 3 + corregidas]))[0].d
  const [{ fecha_estimada: original }] = await consulta('select fecha_estimada::text from public.ordenes_compra_materiales where id = $1', [ocFecha.id])
  await fila(pagina, ocFecha.nombre).getByRole('button', { name: /corregir la fecha/i }).click()
  await ventana.getByLabel('Fecha nueva que prometió el proveedor').fill(nueva)
  await ventana.getByLabel('Por qué cambia').selectOption('TRANSPORTE')
  await ventana.getByRole('button', { name: 'Corregir' }).click()
  await pagina.getByRole('status').filter({ hasText: 'Fecha prometida corregida' }).first().waitFor({ timeout: 15000 })
  await pagina.waitForLoadState('networkidle')
  const plazo = limpio(await fila(pagina, ocFecha.nombre).locator('td').nth(3).locator('[data-plazo]').textContent())
  comprobar(plazo.includes(`Prometida ${ddmm(nueva)} (corregida)`), `la fila dice la fecha nueva, corregida: «${plazo}»`)
  const [{ fecha_estimada: despues }] = await consulta('select fecha_estimada::text from public.ordenes_compra_materiales where id = $1', [ocFecha.id])
  comprobar(despues === original, `la OC no cambia en la base (${original} → ${despues})`)
  await fila(pagina, ocFecha.nombre).locator('[data-recorrido] summary').click()
  const corregido = limpio(await fila(pagina, ocFecha.nombre).locator('[data-recorrido-paso="FECHA_CORREGIDA"]').last().textContent())
  comprobar(corregido.includes(`al ${ddmm(nueva)}`) && corregido.includes('Transporte'), `el recorrido guarda la fecha anterior y la nueva: «${corregido}»`)
  await ir(pagina, '/compras/ordenes?ver=atrasadas')
  comprobar((await fila(pagina, ocFecha.nombre).count()) === 0, `${ocFecha.nombre}, con la fecha corregida, sale de «Atrasadas»`)
  await contexto.close()
}

// ------------------------------------------------ 4. La OS
if (osAtrasada) {
  const { pagina, contexto } = await entrar('logistica')
  await ir(pagina, '/compras/servicios')
  const filaOs = pagina.locator(`tr[data-servicio="${osAtrasada.nombre}"]`)
  await filaOs.getByRole('button', { name: /motivo del atraso/i }).click()
  const ventana = pagina.getByRole('dialog')
  await ventana.getByLabel('Por qué se atrasó').selectOption('PAGO')
  await ventana.getByRole('button', { name: 'Anotar' }).click()
  await pagina.getByRole('status').filter({ hasText: 'Motivo del atraso anotado' }).first().waitFor({ timeout: 15000 })
  await pagina.waitForLoadState('networkidle')
  const ultimo = limpio(await filaOs.locator('[data-ultimo-motivo]').first().textContent())
  comprobar(ultimo.startsWith('Atraso: Pago'), `la OS dice su motivo: «${ultimo}»`)
  const resumen = limpio(await filaOs.locator('[data-recorrido-ahora]').textContent().catch(() => ''))
  comprobar(resumen.length > 0, `la OS dice quién la tiene: «${resumen}»`)
  await contexto.close()
} else {
  comprobar(false, 'el banco no tiene una OS atrasada')
}

// ------------------------------------------------ 5. Gerencia y Almacén consultan sin anotar
for (const puesto of ['gerencia', 'almacen']) {
  const { pagina, contexto } = await entrar(puesto)
  await ir(pagina, '/compras/ordenes')
  const f = fila(pagina, ocMotivo.nombre)
  comprobar((await f.locator('[data-recorrido]').count()) === 1, `${puesto} ve el recorrido de ${ocMotivo.nombre}`)
  comprobar((await f.locator('[data-ultimo-motivo]').count()) > 0, `${puesto} ve el motivo del atraso`)
  comprobar((await pagina.getByRole('button', { name: /motivo del atraso|corregir la fecha/i }).count()) === 0, `${puesto} no tiene los botones para anotar`)
  await contexto.close()
}

// ------------------------------------------------ 6. Capturas, 390 y 1440
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar('logistica', ancho)
  for (const [ruta, archivo, abrir] of [
    ['/compras/ordenes?ver=atrasadas', 'seguimiento-oc', `tr[data-compra="${ocMotivo.nombre}"] [data-recorrido] summary`],
    ['/compras/servicios', 'seguimiento-os', osAtrasada ? `tr[data-servicio="${osAtrasada.nombre}"] [data-recorrido] summary` : null],
  ]) {
    await ir(pagina, ruta)
    if (abrir) await pagina.locator(abrir).click()
    await sinDesborde(pagina, `${ruta}, Logística a ${ancho}`)
    await capturar(pagina, `${archivo}-${ancho}.png`)
  }
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

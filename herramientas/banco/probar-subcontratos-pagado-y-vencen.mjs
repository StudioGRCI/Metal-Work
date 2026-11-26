/**
 * Plan 8, entrega 8.2: en «Subcontratos», cada uno con las fechas de su
 * contrato, las reales que anota el supervisor, lo pagado y el saldo, y el
 * filtro «Vencen pronto» (siete días). Clic real con la cuenta de cada puesto,
 * nunca ADMIN:
 *
 *   1. Administración registra (por la misma función que la pantalla, con su
 *      rol) tres subcontratos más del código de uno que ya tiene un recibo
 *      pagado: uno vence en 3 días, uno venció hace 2 y otro vence en 20.
 *   2. En la lista, el del recibo pagado dice lo pagado en bruto y su saldo,
 *      sacados de la base; cada uno, las fechas de su contrato.
 *   3. «Vencen pronto» deja los que vencen en siete días o ya vencieron sin fin
 *      real, el más vencido arriba, con su insignia; el de 20 días no sale.
 *   4. Con el fin real que anota el supervisor de su área, ya no vence.
 *   5. Tesorería ve lo mismo con sus importes; Logística no entra.
 *   6. A 390 px nada se sale y lo pagado y el saldo se leen en la fila.
 *
 * Necesita haber corrido antes `probar-subcontratos.mjs` (deja un subcontrato
 * con un recibo pagado) y las cuentas `*.local@metalwork.test`.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  administracion: 'administracion.local@metalwork.test',
  tesoreria: 'tesoreria.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
  supervisorPrd: 'sup.prd.local@metalwork.test',
}
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0] ?? null

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const soles = (n) => `S/ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Corre `sql` con la sesión de la cuenta y el rol authenticated, y lo deja hecho. */
async function como(correo, sql, valores = []) {
  const cuenta = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correo}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ------------------------------------------------------------ 1. Los subcontratos
const pagado = await uno(`
  select s.id, s.numero, s.codigo_interno, s.subcontratista_id, s.monto,
         a.codigo as area,
         coalesce((select sum(r.monto_bruto) from public.recibos_honorarios r
                    where r.subcontrato_id = s.id and r.anulado_en is null
                      and exists (select 1 from public.pagos_recibo_honorarios p where p.recibo_id = r.id and p.anulado_en is null)), 0) as bruto
    from public.subcontratos s join public.areas a on a.id = s.area_id
   where s.estado <> 'ANULADO'
     and exists (select 1 from public.recibos_honorarios r join public.pagos_recibo_honorarios p on p.recibo_id = r.id
                  where r.subcontrato_id = s.id and r.anulado_en is null and p.anulado_en is null)
   order by s.creado_en desc limit 1`)
if (!pagado) {
  console.error('No hay un subcontrato con un recibo pagado: corre antes probar-subcontratos.mjs.')
  process.exit(1)
}
const hoy = (await uno(`select (now() at time zone 'America/Lima')::date::text as d`)).d
const dia = async (n) => (await uno(`select ($1::date + $2::int)::text as d`, [hoy, n])).d
const sello = String(Date.now()).slice(-5)
const nuevos = {}
for (const [clave, dias] of [['pronto', 3], ['vencido', -2], ['lejos', 20]]) {
  const id = (await uno('select gen_random_uuid() as id')).id
  await como(CUENTAS.administracion, `select public.registrar_subcontrato($1, $2, $3, $4, 'PEN', 1200, $5::date, $6::date, $7)`, [
    id, pagado.subcontratista_id, pagado.codigo_interno, `Prueba 8.2 ${clave} ${sello}: soldadura de refuerzos`,
    await dia(dias - 10), await dia(dias), pagado.area,
  ])
  nuevos[clave] = (await uno('select id, numero, fecha_fin::text as fin from public.subcontratos where id = $1', [id]))
}
comprobar(Object.values(nuevos).every(Boolean), `Administración registra tres subcontratos (${Object.values(nuevos).map((n) => n?.numero).join(', ')})`)

// Lo que «Vencen pronto» debe traer, según la base.
const esperados = await consulta(`
  select numero, (fecha_fin - $1::date) as dias from public.subcontratos
   where estado = 'VIGENTE' and fin_real is null and fecha_fin is not null and fecha_fin - $1::date <= 7
   order by fecha_fin, numero`, [hoy])

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport = { width: 1440, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.locator('input[name="correo"], input[type="email"]').first().fill(correo)
  await pagina.locator('input[type="password"]').first().fill(CLAVE)
  await pagina.locator('button[type="submit"]').first().click()
  await pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 })
  return { pagina, contexto }
}
const fila = (pagina, numero) => pagina.locator(`[data-subcontrato="${numero}"]`)

// ------------------------------------------------------------ 2 y 3. Administración
{
  const { pagina, contexto } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
  const fp = fila(pagina, pagado.numero)
  const celda = limpio(await fp.locator('[data-pagado-y-saldo]').first().textContent().catch(() => ''))
  const saldo = Number(pagado.monto) - Number(pagado.bruto)
  comprobar(celda.includes(soles(pagado.bruto)) && celda.includes(`Saldo ${soles(saldo)}`),
    `${pagado.numero}: pagado en bruto ${soles(pagado.bruto)} y saldo ${soles(saldo)}, como en la base («${celda}»)`)
  const cabecera = limpio(await pagina.locator('thead').first().textContent())
  comprobar(cabecera.includes('Pagado en bruto y saldo'), `la columna dice qué es lo pagado («${cabecera}»)`)
  const fechas = limpio(await fila(pagina, nuevos.lejos.numero).locator('[data-fechas-contrato]').textContent().catch(() => ''))
  comprobar(fechas.startsWith('Contrato:') && fechas.includes(nuevos.lejos.fin.split('-').reverse().join('/')),
    `cada uno dice las fechas de su contrato («${fechas}»)`)
  comprobar((await fila(pagina, nuevos.lejos.numero).locator('[data-vence]').count()) === 0, 'el que vence en 20 días no lleva insignia')
  await pagina.screenshot({ path: join(CAPTURAS, '8-2-administracion-1440-1-subcontratos.png') })

  // «Vencen pronto».
  const pastilla = pagina.getByRole('link', { name: /Vencen pronto/ })
  const textoPastilla = limpio(await pastilla.textContent())
  comprobar(textoPastilla === `Vencen pronto (${esperados.length})`, `la pastilla cuenta los que vencen pronto («${textoPastilla}», la base: ${esperados.length})`)
  await pastilla.click()
  await pagina.waitForURL((u) => u.searchParams.get('estado') === 'pronto', { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  const numeros = await pagina.locator('[data-subcontrato]').evaluateAll((l) => l.map((e) => e.getAttribute('data-subcontrato')))
  comprobar(JSON.stringify(numeros) === JSON.stringify(esperados.map((e) => e.numero)),
    `«Vencen pronto» trae los de la base, el más vencido arriba (${numeros.join(', ')})`)
  comprobar(!numeros.includes(nuevos.lejos.numero), 'el de 20 días no sale')
  const insVencido = limpio(await fila(pagina, nuevos.vencido.numero).locator('[data-vence]').textContent().catch(() => ''))
  const insPronto = limpio(await fila(pagina, nuevos.pronto.numero).locator('[data-vence]').textContent().catch(() => ''))
  comprobar(insVencido === 'Venció hace 2 días' && insPronto === 'Vence en 3 días', `con su insignia («${insVencido}», «${insPronto}»)`)
  await pagina.waitForTimeout(1000)
  await pagina.screenshot({ path: join(CAPTURAS, '8-2-administracion-1440-2-vencen-pronto.png') })

  // 4. El supervisor anota que terminó: ya no vence.
  const supervisor = `sup.${pagado.area.toLowerCase()}.local@metalwork.test`
  await como(supervisor, `select public.marcar_fechas_reales_subcontrato($1, $2::date, $3::date)`, [nuevos.pronto.id, await dia(-7), hoy])
  await pagina.reload({ waitUntil: 'networkidle' })
  comprobar((await fila(pagina, nuevos.pronto.numero).count()) === 0, 'con su fin real anotado, ya no vence pronto')
  await contexto.close()
}

// ------------------------------------------------------------ 5. Tesorería y Logística
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(`${BASE}/subcontratos?estado=pronto`, { waitUntil: 'networkidle' })
  const celda = limpio(await fila(pagina, nuevos.vencido.numero).locator('[data-pagado-y-saldo]').first().textContent().catch(() => ''))
  comprobar(celda.includes('Saldo S/ 1,200.00'), `Tesorería, que ya ve los importes, ve lo pagado y el saldo («${celda}»)`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
  comprobar(!new URL(pagina.url()).pathname.startsWith('/subcontratos') || (await pagina.locator('[data-subcontrato]').count()) === 0,
    `Logística no entra (${new URL(pagina.url()).pathname})`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.supervisorPrd)
  await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-pagado-y-saldo]').count()) === 0, `el supervisor no ve importes en Subcontratos (${new URL(pagina.url()).pathname})`)
  await contexto.close()
}

// ------------------------------------------------------------ 6. Teléfono
{
  const { pagina, contexto } = await entrar(CUENTAS.administracion, { width: 390, height: 844 })
  await pagina.goto(`${BASE}/subcontratos?estado=pronto`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `a 390 px nada se sale (${ancho} px)`)
  const enFila = limpio(await fila(pagina, nuevos.vencido.numero).locator('p[data-pagado-y-saldo]').textContent().catch(() => ''))
  comprobar(enFila.includes('Pagado S/ 0.00 en bruto') && enFila.includes('Saldo S/ 1,200.00'), `en el teléfono, lo pagado y el saldo van en la fila («${enFila}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, '8-2-administracion-390-vencen-pronto.png') })
  await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
  await fila(pagina, pagado.numero).scrollIntoViewIfNeeded().catch(() => {})
  await pagina.screenshot({ path: join(CAPTURAS, '8-2-administracion-390-subcontratos.png') })
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length) {
  console.log('\nErrores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo en orden.')
process.exit(fallas.length ? 1 : 0)

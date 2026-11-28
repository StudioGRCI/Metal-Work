/**
 * El pendiente «órdenes terminadas con el costo sin cerrar» (2026-11-28): le
 * llega a quien puede cerrarlo, cuenta solo lo que se cierra en el expediente y
 * lleva a esas mismas órdenes.
 *
 *   1. Administración (cierra por `ordenes.editar` + `costos.ver`) lo tiene en
 *      «Te toca»: 1, la 0005-2026, ENTREGADA y sin código interno. La
 *      0004-2026, ENTREGADA con código interno, no cuenta: su costo se cierra en
 *      Códigos internos. Antes pedía `costos.controlar_ot` y no le llegaba.
 *   2. Su fila lleva a `/ordenes?costo=por-cerrar`, que lista la 0005 (ENTREGADA,
 *      que la ruta de antes, `?estado=TERMINADA`, no mostraba) y no la 0004, con
 *      «Costo por cerrar» marcado. A 1440 y a 390, sin salirse de costado.
 *   3. En el expediente de la 0005, «Cerrar el costo» con clic real: la base
 *      guarda el cierre a nombre de Administración, «Te toca» ya no lo cuenta y
 *      la lista dice que no queda ninguna.
 *   4. Gerencia (consulta) y Requerimientos (no ve el costo) no lo reciben, y a
 *      Gerencia la dirección del filtro no le filtra ni le ofrece la casilla.
 *
 * Solo en el banco: deja la 0005-2026 ENTREGADA (con los disparadores apagados)
 * y quita su cierre de costo al empezar, para poder correrla otra vez.
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
const TEXTO = 'con el costo sin cerrar'
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

// --- Datos del banco -----------------------------------------------------------
await base.query('begin')
await base.query("set local session_replication_role = replica")
await base.query("update ordenes_trabajo set estado = 'ENTREGADA' where numero = '0005-2026'")
await base.query("delete from ot_cierres_costo where orden_id = (select id from ordenes_trabajo where numero = '0005-2026')")
await base.query('commit')
const { rows: ordenes } = await base.query(
  `select o.numero, o.estado, o.tipo_trabajo, u.codigo_interno
     from ordenes_trabajo o left join unidades u on u.id = o.unidad_id
    where o.numero in ('0004-2026', '0005-2026') order by o.numero`,
)
console.log('Órdenes de la prueba:', ordenes.map((o) => `${o.numero} ${o.estado} ${o.tipo_trabajo} «${o.codigo_interno ?? ''}»`).join(' · '))
const id0005 = (await base.query("select id from ordenes_trabajo where numero = '0005-2026'")).rows[0].id

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, viewport = { width: 1440, height: 900 }) {
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

/** La fila del pendiente en «Te toca», o null. */
async function filaDelPendiente(pagina) {
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await pagina.waitForSelector('main h1')
  return pagina.evaluate((texto) => {
    const a = [...document.querySelectorAll('[data-te-toca] li a')].find((x) => x.innerText.includes(texto))
    return a ? { texto: a.innerText.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') } : null
  }, TEXTO)
}

/** Los números de OT que lista la pantalla (tabla del monitor o tarjetas del teléfono). */
const numerosListados = (pagina) =>
  pagina.evaluate(() => [...new Set((document.querySelector('main')?.innerText.match(/\b\d{4}-20\d\d\b/g) ?? []))])

const seSaleDeCostado = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)

try {
  // 1 y 2. Administración, a 1440.
  const adm = await entrar('administracion')
  const fila = await filaDelPendiente(adm.pagina)
  comprobar(fila !== null, `Administración tiene el pendiente en «Te toca»: ${fila?.texto ?? 'no está'}`)
  comprobar(fila?.texto.startsWith('1 '), 'cuenta 1: la 0005 sin código, no la 0004 con código interno')
  comprobar(fila?.href === '/ordenes?costo=por-cerrar', `lleva a /ordenes?costo=por-cerrar (${fila?.href})`)
  if (fila) {
    await Promise.all([adm.pagina.waitForURL(/costo=por-cerrar/), adm.pagina.click(`[data-te-toca] li a[href="${fila.href}"]`)])
    await adm.pagina.waitForSelector('main h1')
  }
  const listadas = await numerosListados(adm.pagina)
  comprobar(listadas.includes('0005-2026') && !listadas.includes('0004-2026'), `la lista trae la 0005 (ENTREGADA) y no la 0004: ${listadas.join(', ')}`)
  const casilla = adm.pagina.getByLabel('Costo por cerrar')
  comprobar((await casilla.count()) === 1 && (await casilla.isChecked()), '«Costo por cerrar» está marcado')
  const descripcion = await adm.pagina.locator('main header p, main h1 ~ p').first().innerText().catch(() => '')
  console.log('     encabezado:', descripcion)
  comprobar(!(await seSaleDeCostado(adm.pagina)), 'a 1440 nada se sale de costado')
  await adm.pagina.screenshot({ path: join(CAPTURAS, 'costo-por-cerrar-administracion-1440.png'), fullPage: true })

  // Desmarcar la casilla vuelve a la lista entera.
  await Promise.all([adm.pagina.waitForURL((u) => !u.search.includes('costo=')), casilla.click()])
  await adm.pagina.waitForSelector('main h1')
  const todas = await numerosListados(adm.pagina)
  comprobar(todas.includes('0004-2026') && todas.includes('0005-2026'), `desmarcada, vuelve la lista entera: ${todas.join(', ')}`)

  // A 390.
  const tel = await entrar('administracion', { width: 390, height: 844 })
  await tel.pagina.goto(`${BASE}/ordenes?costo=por-cerrar`, { waitUntil: 'networkidle' })
  await tel.pagina.waitForSelector('main h1')
  const enTelefono = await numerosListados(tel.pagina)
  comprobar(enTelefono.includes('0005-2026') && !enTelefono.includes('0004-2026'), `a 390 también la 0005 sola: ${enTelefono.join(', ')}`)
  comprobar(!(await seSaleDeCostado(tel.pagina)), 'a 390 nada se sale de costado')
  await tel.pagina.screenshot({ path: join(CAPTURAS, 'costo-por-cerrar-administracion-390.png'), fullPage: true })

  // 3. Cerrar el costo con clic real en el expediente.
  await adm.pagina.goto(`${BASE}/ordenes/${id0005}/expediente`, { waitUntil: 'networkidle' })
  const pliegue = adm.pagina.getByText('Cerrar el costo de esta OT')
  comprobar((await pliegue.count()) > 0, 'el expediente de la 0005 ofrece «Cerrar el costo de esta OT»')
  if ((await pliegue.count()) > 0) {
    await pliegue.first().click()
    await adm.pagina.getByRole('button', { name: 'Cerrar el costo' }).click()
    await adm.pagina.getByText('Costo cerrado en').first().waitFor({ timeout: 15000 }).catch(() => {})
  }
  const { rows: cierres } = await base.query(
    `select r.codigo from ot_cierres_costo c join usuarios u on u.id = c.cerrado_por join roles r on r.id = u.rol_id where c.orden_id = $1`,
    [id0005],
  )
  comprobar(cierres.length === 1 && cierres[0].codigo === 'ADMINISTRACION', `la base guardó el cierre a nombre de ${cierres[0]?.codigo ?? 'nadie'}`)
  const despues = await filaDelPendiente(adm.pagina)
  comprobar(despues === null, `cerrado, «Te toca» ya no lo cuenta${despues ? `: ${despues.texto}` : ''}`)
  await adm.pagina.goto(`${BASE}/ordenes?costo=por-cerrar`, { waitUntil: 'networkidle' })
  const vacio = await adm.pagina.getByText('Ninguna orden terminada con el costo por cerrar').count()
  comprobar(vacio === 1, 'la lista dice que no queda ninguna por cerrar')
  await adm.pagina.screenshot({ path: join(CAPTURAS, 'costo-por-cerrar-vacio-1440.png'), fullPage: true })

  // 4. Gerencia y Requerimientos.
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  await base.query('delete from ot_cierres_costo where orden_id = $1', [id0005])
  await base.query('commit')
  for (const puesto of ['gerencia', 'requerimientos']) {
    const s = await entrar(puesto)
    const suya = await filaDelPendiente(s.pagina)
    comprobar(suya === null, `${puesto} no lo recibe, con la 0005 abierta otra vez${suya ? `: ${suya.texto}` : ''}`)
    if (puesto === 'gerencia') {
      await s.pagina.goto(`${BASE}/ordenes?costo=por-cerrar`, { waitUntil: 'networkidle' })
      const suyas = await numerosListados(s.pagina)
      comprobar(suyas.includes('0004-2026'), `a Gerencia la dirección no le filtra: ${suyas.join(', ')}`)
      comprobar((await s.pagina.getByLabel('Costo por cerrar').count()) === 0, 'ni le ofrece la casilla')
    }
    comprobar(s.errores.length === 0, `${puesto}: sin errores de consola${s.errores.length ? `: ${s.errores.join(' | ')}` : ''}`)
    await s.contexto.close()
  }
  comprobar(adm.errores.length + tel.errores.length === 0, `Administración: sin errores de consola${adm.errores.length + tel.errores.length ? `: ${[...adm.errores, ...tel.errores].join(' | ')}` : ''}`)
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)

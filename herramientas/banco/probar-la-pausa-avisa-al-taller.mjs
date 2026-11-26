/**
 * Clic real: la OT que Administración pausa o reanuda avisa a la supervisión del
 * taller (DKS eligió «Avisar a los supervisores», 2026-11-26; migración
 * 20261126338000). Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Se siembra un código interno para la OT en proceso del banco, con una
 *      etapa abierta de Maestranza y otra de Acabados, y una terminada de
 *      Producción.
 *   2. administracion.local pausa la OT con su motivo.
 *   3. sup.mtz.local, en el teléfono (390), ve en Avisos «Orden … pausada» con el
 *      motivo; al tocarlo llega a Planos y etapas con el código buscado.
 *      sup.prd.local, cuya etapa ya terminó, no recibe nada.
 *   4. administracion.local la reanuda; sup.acb.local, en el monitor (1440), ve
 *      «Orden … reanudada».
 *   Y lo que el aviso promete: en proceso, «Sin reporte de hoy» le pide el
 *   código a Maestranza; pausada, ya no. La ventana de pausar dice a quién le
 *   llega el motivo.
 *
 * Deja la OT como la encontró (en proceso y con su unidad) y quita lo sembrado, también sus avisos.
 * Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
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
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

// ------------------------------------------------ 1. Lo que se siembra
const [orden] = await consulta(`select id, numero, unidad_id from public.ordenes_trabajo where estado = 'EN_PROCESO' order by numero limit 1`)
if (!orden) throw new Error('El banco no tiene ninguna OT en proceso: corre preparar.sh.')
const sufijo = Date.now().toString(36).slice(-4).toUpperCase()
const codigo = `BANCO-AVISO-${sufijo}`
const [sup] = await consulta(`select id from public.usuarios where correo = $1`, [correoDe('sup.mtz')])
await base.query('begin')
await base.query('set local session_replication_role = replica')
const [unidad] = await consulta(
  `insert into public.unidades (cliente_id, codigo_interno, marca)
   select cliente_id, $1, 'Prueba del aviso' from public.ordenes_trabajo where id = $2 returning id`,
  [codigo, orden.id],
)
await consulta(`update public.ordenes_trabajo set unidad_id = $1 where id = $2`, [unidad.id, orden.id])
await consulta(
  `insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, fin_real, creado_por, de_area)
   select $1, x.orden, x.nombre, a.id, current_date - 6, current_date + 4, current_date - 5, x.fin_real, $2, true
     from (values (1, 'Armado del aviso', 'MTZ', null::date), (2, 'Pintura del aviso', 'ACB', null::date),
                  (3, 'Corte del aviso', 'PRD', current_date - 1)) x(orden, nombre, area, fin_real)
     join public.areas a on a.codigo = x.area`,
  [codigo, sup.id],
)
await base.query('commit')
const estadoDe = async () => (await consulta('select estado::text as estado, motivo_pausa from public.ordenes_trabajo where id = $1', [orden.id]))[0]
const avisosDe = async (puesto) =>
  consulta(
    `select n.titulo, n.cuerpo, n.ruta from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
      where u.correo = $1 and n.origen_id = $2 and n.titulo like $3 order by n.creado_en`,
    // Solo los de este código: la OT del banco ya trae otros avisos (el de aprobada).
    [correoDe(puesto), orden.id, `% · ${codigo}`],
  )

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
  await conReact(pagina)
  return { pagina, contexto }
}

async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  await conReact(pagina)
}

async function capturar(pagina, archivo) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
}

async function esperarEstado(esperado) {
  for (let i = 0; i < 40; i++) {
    const e = await estadoDe()
    if (e.estado === esperado) return e
    await new Promise((r) => setTimeout(r, 250))
  }
  return estadoDe()
}

const boton = (pagina, texto) => pagina.getByRole('button', { name: texto, exact: true })
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

try {
  // ---------------------------------------------- 2. Administración pausa
  const motivo = `Falta el chasis del cliente (prueba ${sufijo})`
  {
    // Antes de pausar, el código le pide el reporte a Maestranza.
    const mtz = await entrar('sup.mtz', 1440)
    await ir(mtz.pagina, '/planos')
    comprobar((await mtz.pagina.locator(`[data-codigo-sin-reporte="${codigo}"]`).count()) === 1, `en proceso, «Sin reporte de hoy» le pide ${codigo} a Maestranza`)
    await mtz.contexto.close()

    const { pagina, contexto } = await entrar('administracion', 1440)
    await ir(pagina, `/ordenes/${orden.id}`)
    await boton(pagina, 'Pausar').click()
    const ventana = pagina.getByRole('dialog')
    const explica = limpio(await ventana.innerText())
    comprobar(explica.includes('les llega a los supervisores de las áreas con una etapa abierta'), 'la ventana dice que el motivo les llega a los supervisores')
    await capturar(pagina, 'aviso-pausa-1440-ventana.png')
    await ventana.locator('textarea[name="motivo"]').fill(motivo)
    await ventana.getByRole('button', { name: 'Confirmar' }).click()
    const pausada = await esperarEstado('PAUSADA')
    comprobar(pausada.estado === 'PAUSADA', `Administración pausó la OT ${orden.numero}`)
    await contexto.close()
  }

  // ---------------------------------------------- 3. El supervisor de Maestranza, en el teléfono
  {
    const titulo = `Orden ${orden.numero} pausada · ${codigo}`
    const enBase = await avisosDe('sup.mtz')
    comprobar(enBase.length === 1 && enBase[0].titulo === titulo, `a Maestranza le llegó un aviso: ${JSON.stringify(enBase.map((a) => a.titulo))}`)
    comprobar((await avisosDe('sup.prd')).length === 0, 'a Producción, con su etapa terminada, no le llegó nada')
    comprobar((await avisosDe('administracion')).length === 0, 'a quien pausó no le llega su propio aviso')

    const { pagina, contexto } = await entrar('sup.mtz', 390)
    await ir(pagina, '/avisos')
    const fila = pagina.getByRole('button', { name: new RegExp(titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    comprobar((await fila.count()) === 1, `en Avisos ve «${titulo}»`)
    const dice = limpio(await fila.textContent().catch(() => ''))
    comprobar(dice.includes(`Motivo: ${motivo}`) && dice.includes('La pausó Administración'), `con quién la pausó y el motivo: «${dice.slice(0, 220)}»`)
    comprobar(dice.includes(`el código ${codigo} no te pide el reporte diario`), 'y que ese código ya no le pide el reporte')
    const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    comprobar(sobra <= 0, `a 390 nada se sale de la pantalla (sobran ${sobra} px)`)
    await capturar(pagina, 'aviso-pausa-390-avisos.png')
    await fila.click()
    await pagina.waitForURL((u) => u.pathname === '/planos', { timeout: 20000 }).catch(() => {})
    await pagina.locator('main').getByText(codigo, { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {})
    const url = new URL(pagina.url())
    comprobar(url.pathname === '/planos' && url.searchParams.get('q') === codigo, `al tocarlo llega a Planos y etapas con el código buscado (${url.pathname}${url.search})`)
    comprobar(limpio(await pagina.locator('main').innerText()).includes(codigo), `y ahí está el código ${codigo}`)
    await capturar(pagina, 'aviso-pausa-390-planos.png')
    // Lo que el aviso promete: la bandeja ya no le pide ese código.
    await ir(pagina, '/planos')
    comprobar((await pagina.locator(`[data-codigo-sin-reporte="${codigo}"]`).count()) === 0, `pausada, «Sin reporte de hoy» ya no le pide ${codigo}`)
    await contexto.close()
  }

  // ---------------------------------------------- 4. Reanuda; Acabados lo ve en el monitor
  {
    const { pagina, contexto } = await entrar('administracion', 1440)
    await ir(pagina, `/ordenes/${orden.id}`)
    await boton(pagina, 'Reanudar').click()
    const reanudada = await esperarEstado('EN_PROCESO')
    comprobar(reanudada.estado === 'EN_PROCESO', 'Administración la reanudó')
    await contexto.close()

    const titulo = `Orden ${orden.numero} reanudada · ${codigo}`
    const acb = await entrar('sup.acb', 1440)
    await ir(acb.pagina, '/avisos')
    const fila = acb.pagina.getByRole('button', { name: new RegExp(titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    comprobar((await fila.count()) === 1, `Acabados ve «${titulo}»`)
    const dice = limpio(await fila.textContent().catch(() => ''))
    comprobar(dice.includes(`El código ${codigo} vuelve a pedir tu reporte diario`), `y que vuelve a pedir el reporte: «${dice.slice(0, 200)}»`)
    await capturar(acb.pagina, 'aviso-pausa-1440-reanudada.png')
    await acb.contexto.close()
    comprobar((await avisosDe('sup.mtz')).length === 2, 'Maestranza tiene los dos avisos: pausada y reanudada')
  }

  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
} finally {
  // La OT vuelve a quedar en proceso y con su unidad de antes.
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  await base.query(`update public.ordenes_trabajo set estado = 'EN_PROCESO', motivo_pausa = null, unidad_id = $1 where id = $2`, [orden.unidad_id, orden.id])
  // Y se va lo sembrado: si no, cada corrida suma un código con etapas abiertas al tablero y a «Sin reporte de hoy».
  await base.query(`delete from public.notificaciones where origen_id = $1 and titulo like $2`, [orden.id, `% · ${codigo}`])
  await base.query(`delete from public.codigo_etapas where codigo_interno = $1`, [codigo])
  await base.query(`delete from public.unidades where id = $1`, [unidad.id])
  await base.query('commit')
  await navegador.close()
  await base.end()
}

console.log(fallas.length === 0 ? '\nTODO EN VERDE' : `\n${fallas.length} FALLAS`)
process.exit(fallas.length === 0 ? 0 : 1)

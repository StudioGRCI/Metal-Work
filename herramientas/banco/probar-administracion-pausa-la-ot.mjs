/**
 * Clic real: Administración pausa una OT en proceso, con su motivo, y la
 * reanuda (DKS, 2026-11-26; migración 20261126337000). Con la cuenta de cada
 * puesto, nunca ADMIN:
 *
 *   1. administracion.local abre una OT en proceso: ve «Pausar» y no ve
 *      «Terminar». Pausa con su motivo; la base la deja pausada con ese motivo.
 *   2. Con la OT pausada ve «Reanudar»; al tocarlo, la base la deja en proceso.
 *   3. Lo mismo en el teléfono (390), con capturas, y nada se sale de la
 *      pantalla.
 *   4. Con una pestaña vieja (otro ya la pausó o la reanudó), pausar no pisa
 *      el motivo y reanudar no dice «no tienes permiso».
 *   5. Gerencia abre la misma OT y no ve «Pausar». El supervisor no entra a la
 *      OT.
 *
 * Deja la OT como la encontró (en proceso). Variables: BANCO_CLAVE, BASE
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
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

// La OT en proceso del banco: la primera que esté en proceso.
const [orden] = await consulta(`select id, numero from public.ordenes_trabajo where estado = 'EN_PROCESO' order by numero limit 1`)
if (!orden) throw new Error('El banco no tiene ninguna OT en proceso: corre preparar.sh.')
const estadoDe = async () => (await consulta('select estado::text as estado, motivo_pausa from public.ordenes_trabajo where id = $1', [orden.id]))[0]

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
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

const boton = (pagina, texto) => pagina.getByRole('button', { name: texto, exact: true })

async function esperarEstado(esperado) {
  for (let i = 0; i < 40; i++) {
    const e = await estadoDe()
    if (e.estado === esperado) return e
    await new Promise((r) => setTimeout(r, 250))
  }
  return estadoDe()
}

try {
  for (const ancho of [1440, 390]) {
    const { pagina, contexto } = await entrar('administracion', ancho)
    await ir(pagina, `/ordenes/${orden.id}`)
    comprobar((await boton(pagina, 'Pausar').count()) === 1, `${ancho}: Administración ve «Pausar» en la OT ${orden.numero}`)
    comprobar((await boton(pagina, 'Terminar').count()) === 0, `${ancho}: Administración no ve «Terminar»`)
    await capturar(pagina, `pausa-administracion-${ancho}-en-proceso.png`)

    const motivo = `El cliente no envió el chasis (prueba ${ancho})`
    await boton(pagina, 'Pausar').click()
    const ventana = pagina.getByRole('dialog')
    await ventana.locator('textarea[name="motivo"]').fill(motivo)
    await capturar(pagina, `pausa-administracion-${ancho}-motivo.png`)
    await ventana.getByRole('button', { name: 'Confirmar' }).click()
    const pausada = await esperarEstado('PAUSADA')
    comprobar(pausada.estado === 'PAUSADA' && pausada.motivo_pausa === motivo, `${ancho}: la base dejó la OT pausada con su motivo (${JSON.stringify(pausada)})`)
    await pagina.waitForLoadState('networkidle')
    await conReact(pagina)
    await boton(pagina, 'Reanudar').waitFor({ timeout: 15000 }).catch(() => {})
    comprobar((await boton(pagina, 'Reanudar').count()) === 1, `${ancho}: con la OT pausada ve «Reanudar»`)
    await sinDesborde(pagina, `${ancho}, OT pausada`)
    await capturar(pagina, `pausa-administracion-${ancho}-pausada.png`)

    await boton(pagina, 'Reanudar').click()
    const reanudada = await esperarEstado('EN_PROCESO')
    comprobar(reanudada.estado === 'EN_PROCESO', `${ancho}: la base dejó la OT en proceso otra vez (${reanudada.estado})`)
    await pagina.waitForLoadState('networkidle')
    await boton(pagina, 'Pausar').waitFor({ timeout: 15000 }).catch(() => {})
    comprobar((await boton(pagina, 'Pausar').count()) === 1, `${ancho}: reanudada, vuelve a ofrecer «Pausar»`)
    await contexto.close()
  }

  // Una pestaña vieja: otro ya cambió la OT. No pisa el motivo ni dice «no tienes permiso».
  {
    const replica = async (sql, valores) => {
      await base.query('begin')
      await base.query('set local session_replication_role = replica')
      await base.query(sql, valores)
      await base.query('commit')
    }
    const { pagina, contexto } = await entrar('administracion', 1440)
    await ir(pagina, `/ordenes/${orden.id}`)
    await replica(`update public.ordenes_trabajo set estado = 'PAUSADA', motivo_pausa = 'Lo pausó otro (prueba)' where id = $1`, [orden.id])
    await boton(pagina, 'Pausar').click()
    const ventana = pagina.getByRole('dialog')
    await ventana.locator('textarea[name="motivo"]').fill('Otro motivo que no debe entrar')
    await ventana.getByRole('button', { name: 'Confirmar' }).click()
    const aviso = ventana.locator('[role="alert"]')
    await aviso.waitFor({ timeout: 15000 }).catch(() => {})
    const textoPausa = ((await aviso.textContent().catch(() => '')) ?? '').trim()
    comprobar(textoPausa.includes('ya está pausada') && textoPausa.includes('Lo pausó otro'), `pestaña vieja: pausar la ya pausada dice cómo está («${textoPausa}»)`)
    comprobar((await estadoDe()).motivo_pausa === 'Lo pausó otro (prueba)', 'pestaña vieja: el motivo de quien la pausó no se pisa')
    await contexto.close()

    const otra = await entrar('administracion', 1440)
    await ir(otra.pagina, `/ordenes/${orden.id}`)
    await replica(`update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = $1`, [orden.id])
    await boton(otra.pagina, 'Reanudar').click()
    const avisoReanudar = otra.pagina.locator('[role="alert"]').filter({ hasText: /proceso|pausada/ })
    await avisoReanudar.first().waitFor({ timeout: 15000 }).catch(() => {})
    const textoReanudar = ((await avisoReanudar.first().textContent().catch(() => '')) ?? '').trim()
    comprobar(textoReanudar.includes('ya estaba en proceso') && !textoReanudar.includes('permiso'), `pestaña vieja: reanudar la ya reanudada no habla de permiso («${textoReanudar}»)`)
    comprobar((await estadoDe()).estado === 'EN_PROCESO', 'pestaña vieja: la OT sigue en proceso')
    await otra.contexto.close()
  }

  // Gerencia ve la OT y no la pausa.
  {
    const { pagina, contexto } = await entrar('gerencia', 1440)
    await ir(pagina, `/ordenes/${orden.id}`)
    comprobar(new URL(pagina.url()).pathname === `/ordenes/${orden.id}`, 'Gerencia abre la OT')
    comprobar((await boton(pagina, 'Pausar').count()) === 0, 'Gerencia no ve «Pausar»')
    await contexto.close()
  }

  // El supervisor no entra a la OT.
  {
    const { pagina, contexto } = await entrar('sup.mtz', 1440)
    await ir(pagina, `/ordenes/${orden.id}`)
    comprobar(new URL(pagina.url()).pathname !== `/ordenes/${orden.id}`, `el supervisor no entra a la OT (lo lleva a ${new URL(pagina.url()).pathname})`)
    comprobar((await boton(pagina, 'Pausar').count()) === 0, 'el supervisor no ve «Pausar»')
    await contexto.close()
  }
} finally {
  // La OT queda como estaba, aunque algo falle a medio camino.
  const fin = await estadoDe()
  if (fin.estado !== 'EN_PROCESO') {
    await base.query('begin')
    await base.query('set local session_replication_role = replica')
    await base.query(`update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = $1`, [orden.id])
    await base.query('commit')
    console.log(`  · la OT ${orden.numero} se devolvió a EN_PROCESO`)
  }
}

comprobar(errores.length === 0, `consola limpia${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)

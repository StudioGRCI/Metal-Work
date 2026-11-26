// La cuenta bancaria la lee solo RR. HH. (migración 20261126620000), con clic real:
// RR. HH. la ve en Personal y en la hoja de la persona; el administrador ve el
// sueldo, pero ni la cuenta ni un «Sin cuenta» que no es cierto; Gerencia, nada.
//
// Uso (banco local arriba, con una cuenta `admin.local@metalwork.test` del banco):
//   BANCO_CLAVE=… BASE=http://localhost:3114 node herramientas/banco/probar-cuenta-solo-rrhh.mjs
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
import pg from 'pg'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
if (!CLAVE) throw new Error('Falta BANCO_CLAVE')
mkdirSync(CAPTURAS, { recursive: true })

const CUENTAS = {
  rrhh: 'rrhh.local@metalwork.test',
  admin: 'admin.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
}
const db = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
const fallas = []
const comprobar = (ok, mensaje) => {
  console.log(`  ${ok ? 'ok' : 'FALLA'} · ${mensaje}`)
  if (!ok) fallas.push(mensaje)
}
const limpio = (s) => s.replace(/\s+/g, ' ').trim()
let navegador

async function entrar(correo, viewport) {
  const contexto = await navegador.newContext({ viewport, deviceScaleFactor: 2, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
  const pagina = await contexto.newPage()
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}), pagina.click('button[type="submit"]')])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto }
}

try {
  await db.connect()
  // Una persona activa con cuenta: el número es inventado.
  const { rows } = await db.query(
    `select t.id, t.apellidos, t.nombres, c.numero_cuenta from trabajadores t join trabajador_cuentas c on c.trabajador_id = t.id
      where t.activo order by t.creado_en desc limit 1`,
  )
  if (rows.length === 0) throw new Error('El banco no tiene a nadie activo con cuenta: corre antes probar-hoja-de-la-persona.mjs')
  const p = rows[0]
  navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

  for (const [quien, correo] of Object.entries(CUENTAS)) {
    const { pagina, contexto } = await entrar(correo, { width: 1440, height: 900 })
    await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
    const lista = limpio(await pagina.locator('main').innerText())
    const html = await pagina.content()
    await pagina.goto(`${BASE}/rrhh/personal/${p.id}`, { waitUntil: 'networkidle' })
    const hoja = limpio(await pagina.locator('main').innerText().catch(() => ''))
    const htmlHoja = await pagina.content()
    if (quien === 'rrhh') {
      comprobar(lista.includes(p.numero_cuenta), 'RR. HH. ve la cuenta en Personal')
      comprobar(hoja.includes(p.numero_cuenta), 'RR. HH. ve la cuenta en la hoja de la persona')
    } else {
      comprobar(!html.includes(p.numero_cuenta) && !htmlHoja.includes(p.numero_cuenta), `${quien}: el número de cuenta no llega ni en el HTML`)
      comprobar(!lista.includes('Sin cuenta') && !hoja.includes('Sin cuenta'), `${quien}: no se le dice «Sin cuenta» a quien no puede leerla`)
    }
    if (quien === 'admin') {
      comprobar(/Gana /.test(lista), 'el administrador sigue viendo el sueldo en Personal')
      await pagina.screenshot({ path: `${CAPTURAS}/cuentas-admin-hoja-1440.png`, fullPage: true })
    }
    await contexto.close()
  }
} catch (e) {
  fallas.push(String(e?.message ?? e))
  console.error(e)
} finally {
  await navegador?.close().catch(() => {})
  await db.end().catch(() => {})
}
console.log(fallas.length ? `\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

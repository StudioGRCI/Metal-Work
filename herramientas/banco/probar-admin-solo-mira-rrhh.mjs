/**
 * Clic real sobre la decisión de DKS del 2026-10-20 (migración 20261020167000):
 * «quien realiza el costeo y ve el personal y hace ediciones o cambios debe ser
 * rrhh no administracion en todo caso admin solo visualizaria».
 *
 * Recorre cada pantalla de Recursos Humanos con la cuenta de RR. HH. y con la
 * del administrador del sistema. RR. HH. ve sus botones para registrar, guardar
 * y anular; el administrador abre las mismas pantallas, las lee, y no tiene
 * ninguno. Después, por la base y con su sesión, el administrador intenta
 * guardar el costo de una persona y la base lo rechaza.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_ADMIN (correo del administrador en el banco), CAPTURAS.
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
  admin: process.env.BANCO_ADMIN ?? 'studiogrci@gmail.com',
  rrhh: 'rrhh.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
await base.connect()

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

// Los botones que cambian algo. Ver, buscar, filtrar o descargar no cuentan.
const ESCRIBE = /^(Registrar|Guardar|Nuevo|Nueva|Agregar|Anular|Cargar|Dar de (alta|baja)|Cambiar|Justificar|Decidir|Aprobar|Rechazar|Enviar|Cerrar|Importar|Repartir|Entregar|Usar)/i

const PANTALLAS = [
  ['/rrhh/personal', 'Personal'],
  ['/rrhh/cuentas', 'DNI y costo de las cuentas'],
  ['/rrhh/costeo', 'Costeo'],
  ['/rrhh/permisos', 'Permisos'],
  ['/rrhh/observaciones', 'Observaciones'],
  ['/rrhh/pagos-oficina', 'Pagos de la oficina'],
  ['/rrhh/horas-extras', 'Horas extras'],
  ['/rrhh/tardanzas', 'Tardanzas'],
]

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

async function botonesQueEscriben(pagina) {
  const nombres = await pagina.locator('main').getByRole('button').evaluateAll((bs) =>
    bs.filter((b) => b.offsetParent !== null).map((b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()),
  )
  return nombres.filter((n) => ESCRIBE.test(n))
}

const deRrhh = new Map()
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  for (const [ruta, titulo] of PANTALLAS) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    deRrhh.set(ruta, await botonesQueEscriben(pagina))
    comprobar(pagina.url().endsWith(ruta), `RR. HH. abre ${titulo}`)
  }
  const conBotones = [...deRrhh.values()].filter((b) => b.length > 0).length
  comprobar(conBotones >= 5, `RR. HH. tiene botones para cambiar en ${conBotones} de ${PANTALLAS.length} pantallas`)
  comprobar(errores.length === 0, `sin errores de consola como RR. HH. ${errores.join(' | ')}`)
  await contexto.close()
}

{
  const { pagina, contexto, errores } = await entrar(CUENTAS.admin)
  for (const [ruta, titulo] of PANTALLAS) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const texto = (await pagina.locator('main').innerText()).replace(/\s+/g, ' ')
    comprobar(pagina.url().endsWith(ruta) && texto.length > 40, `el administrador abre y lee ${titulo}`)
    const botones = await botonesQueEscriben(pagina)
    comprobar(botones.length === 0, `y no tiene botones para cambiar nada${botones.length ? `: ${botones.join(', ')}` : ''} (RR. HH. ve ${deRrhh.get(ruta).length})`)
  }
  await pagina.goto(`${BASE}/rrhh/costeo`, { waitUntil: 'networkidle' })
  await pagina.screenshot({ path: join(CAPTURAS, 'admin-solo-mira-costeo.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como administrador ${errores.join(' | ')}`)
  await contexto.close()
}

// Aunque llamara a la base por su cuenta, el administrador no guarda el costo.
{
  const [admin] = (await base.query('select id from public.usuarios where lower(correo) = lower($1)', [CUENTAS.admin])).rows
  const [persona] = (await base.query('select id from public.trabajadores where activo order by creado_en limit 1')).rows
  let mensaje = ''
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [admin.id])
    await base.query('set local role authenticated')
    await base.query('select public.rrhh_guardar_costo_trabajador($1, 9999)', [persona.id])
  } catch (e) {
    mensaje = e.message
  } finally {
    await base.query('rollback')
  }
  comprobar(mensaje.includes('Recursos Humanos'), `la base no le deja guardar el costo: «${mensaje}»`)
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobación(es) fallaron.` : '\nTodo bien: RR. HH. cambia lo suyo y el administrador solo lo mira.')
process.exit(fallas.length ? 1 : 0)

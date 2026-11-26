/**
 * Clic real sobre la migración 20261126600000 (plan 6, entrega 6.1): lo que
 * Diseño le debe a cada código. Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Diseño, en sus listas (Planos, Gestión de materiales, Control de etapas
 *      y Archivos DXF), ve en cada código los cinco puntos con hecho o
 *      pendiente, lo mismo que da la base con su sesión; y en el código, la
 *      tarjeta con el detalle y el plano de cada área contra su fecha.
 *   2. Administración, en Códigos internos y en el detalle, ve los cinco puntos
 *      en lectura donde antes decía «Diseño todavía no cargó planos ni etapas».
 *   3. El supervisor de Maestranza, en Planos y etapas, los ve en lectura.
 *   4. Logística no entra a ninguna de esas pantallas.
 *   5. En el teléfono (390) nada se sale. Capturas en 390 y 1440.
 *
 * Necesita lo que siembra `sembrar-diseno-por-codigo.sql` (SR-101, SR-102 y
 * SR-103). Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE
 * (mw_demo), BANCO_CHROMIUM, CAPTURAS.
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
  await pagina.setViewportSize({ width: ventana.width, height: Math.min(Math.max(alto, ventana.height), 6000) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

/** De cada lista de cinco puntos de la página: el código y qué punto está hecho. */
const listas = (pagina) =>
  pagina.locator('[data-lo-que-debe-diseno]').evaluateAll((es) =>
    es.map((e) => ({
      codigo: e.dataset.loQueDebeDiseno,
      puntos: Object.fromEntries([...e.querySelectorAll('[data-punto]')].map((p) => [p.dataset.punto, p.dataset.hecho === 'true'])),
      compromisos: Object.fromEntries([...e.querySelectorAll('[data-compromiso]')].map((c) => [c.dataset.compromiso, c.dataset.situacion])),
      texto: e.textContent.replace(/\s+/g, ' ').trim(),
    })),
  )

const CODIGOS = ['SR-101', 'SR-102', 'SR-103']
const [{ hay }] = await consulta(`select count(*)::int as hay from public.codigo_planos where codigo_interno = 'SR-101'`)
if (hay === 0) throw new Error('Falta lo sembrado: corre sembrar-diseno-por-codigo.sql.')

/** Lo que dice la base con la sesión de ese puesto, como lo pinta la pantalla. */
async function esperado(puesto) {
  const filas = await comoCuenta(puesto, 'select * from public.lo_que_debe_diseno($1)', [CODIGOS])
  const por = new Map()
  for (const f of filas) {
    const c = por.get(f.codigo) ?? {
      puntos: { ficha: f.ficha_en !== null, planos: f.planos > 0, materiales: f.materiales > 0, etapas: f.etapas > 0, dxf: f.dxf > 0 },
      compromisos: {},
    }
    if (f.area) c.compromisos[f.area] = f.situacion
    por.set(f.codigo, c)
  }
  return por
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ------------------------------------------------ 1. Diseño
const deDiseno = await esperado('diseno')
comprobar(igual(deDiseno.get('SR-101')?.puntos, { ficha: true, planos: true, materiales: true, etapas: true, dxf: true }),
  'la base da a SR-101 los cinco puntos hechos')
comprobar(deDiseno.get('SR-101')?.compromisos.MTZ === 'TARDE' && deDiseno.get('SR-102')?.compromisos.MTZ === 'VENCIDO',
  'y el plano de Maestranza de SR-101 tarde, el de SR-102 vencido')
{
  const { pagina, contexto } = await entrar('diseno')
  for (const vista of ['planos', 'materiales', 'etapas', 'dxf']) {
    await ir(pagina, `/diseno/${vista}`)
    const enPantalla = await listas(pagina)
    for (const codigo of CODIGOS) {
      const fila = enPantalla.find((l) => l.codigo === codigo)
      comprobar(fila && igual(fila.puntos, deDiseno.get(codigo).puntos) && igual(fila.compromisos, deDiseno.get(codigo).compromisos),
        `/diseno/${vista}: ${codigo} con los cinco puntos y el plano de cada área como dice la base (${JSON.stringify(fila?.puntos)})`)
    }
  }
  await ir(pagina, '/diseno/codigo?codigo=SR-101')
  const tarjeta = (await listas(pagina)).find((l) => l.codigo === 'SR-101')
  comprobar(tarjeta && /5 de 5/.test(tarjeta.texto) && /Plano de Maestranza: comprometido para el .*3 días tarde/.test(tarjeta.texto),
    `el código SR-101 en Diseño dice «5 de 5» y el plano de Maestranza 3 días tarde («${tarjeta?.texto.slice(0, 160)}»)`)
  await ir(pagina, '/diseno/codigo?codigo=SR-103')
  const nada = (await listas(pagina)).find((l) => l.codigo === 'SR-103')
  comprobar(nada && /0 de 5/.test(nada.texto) && /Falta adjuntarla a la OT/.test(nada.texto),
    'SR-103 dice «0 de 5» y que falta adjuntar la ficha a la OT')
  // Lo que ya tenía la pantalla sigue: la OT, las cifras y las secciones.
  comprobar((await pagina.getByText('OT 0003-2026').count()) > 0 && (await pagina.getByRole('link', { name: 'Materiales' }).count()) > 0,
    'el código sigue con su OT y sus secciones')
  await contexto.close()
}

// ------------------------------------------------ 2. Administración, en lectura
{
  const deAdm = await esperado('administracion')
  const { pagina, contexto } = await entrar('administracion')
  await ir(pagina, '/codigos-internos')
  const enPantalla = await listas(pagina)
  for (const codigo of CODIGOS) {
    const fila = enPantalla.find((l) => l.codigo === codigo)
    comprobar(fila && igual(fila.puntos, deAdm.get(codigo).puntos), `Códigos internos: ${codigo} con sus cinco puntos (Administración)`)
  }
  comprobar((await pagina.getByText('Diseño todavía no cargó planos ni etapas').count()) === 0,
    'ya no dice «Diseño todavía no cargó planos ni etapas»: lo dice la lista')
  comprobar((await pagina.locator('[data-lo-que-debe-diseno] button, [data-lo-que-debe-diseno] form').count()) === 0,
    'y la lista no tiene ningún botón: es lectura')
  await ir(pagina, '/codigos-internos/detalle?codigo=SR-102')
  const detalle = (await listas(pagina)).find((l) => l.codigo === 'SR-102')
  comprobar(detalle && detalle.compromisos.MTZ === 'VENCIDO' && /Vencido hace 2 días/.test(detalle.texto),
    `el detalle de SR-102 dice que el plano de Maestranza venció hace 2 días («${detalle?.texto.slice(0, 120)}»)`)
  await contexto.close()
}

// ------------------------------------------------ 3. Supervisión de Maestranza, en lectura
{
  const deSup = await esperado('sup.mtz')
  const { pagina, contexto } = await entrar('sup.mtz')
  await ir(pagina, '/planos')
  const enPantalla = await listas(pagina)
  const fila = enPantalla.find((l) => l.codigo === 'SR-101')
  comprobar(fila && igual(fila.puntos, deSup.get('SR-101').puntos) && fila.compromisos.MTZ === 'TARDE',
    'Planos y etapas: el supervisor de Maestranza ve los cinco puntos de SR-101 y su plano tarde')
  comprobar(enPantalla.length > 0 && enPantalla.every((l) => l.codigo), 'cada tarjeta de código lleva su lista')
  await contexto.close()
}

// ------------------------------------------------ 4. Logística no entra
{
  const { pagina, contexto } = await entrar('logistica')
  for (const ruta of ['/diseno/planos', '/codigos-internos', '/planos']) {
    await ir(pagina, ruta)
    comprobar((await pagina.locator('[data-lo-que-debe-diseno]').count()) === 0, `Logística no ve la lista en ${ruta} (${new URL(pagina.url()).pathname})`)
  }
  await contexto.close()
}

// ------------------------------------------------ 5. Capturas, 390 y 1440
for (const ancho of [390, 1440]) {
  for (const [puesto, ruta, archivo] of [
    ['diseno', '/diseno/planos', '6-1-diseno-lista'],
    ['diseno', '/diseno/codigo?codigo=SR-101', '6-1-diseno-codigo'],
    ['administracion', '/codigos-internos', '6-1-administracion-codigos'],
    ['sup.mtz', '/planos', '6-1-sup-mtz-planos'],
  ]) {
    const { pagina, contexto } = await entrar(puesto, ancho)
    await ir(pagina, ruta)
    await sinDesborde(pagina, `${ruta}, ${puesto} a ${ancho}`)
    await capturar(pagina, `${archivo}-${ancho}.png`)
    await contexto.close()
  }
}

comprobar(errores.length === 0, `sin errores de consola ni de hidratación ${errores.slice(0, 5).join(' | ')}`)

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} cosa(s) no cuadran:\n${fallas.map((f) => ` - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTodo en orden.')

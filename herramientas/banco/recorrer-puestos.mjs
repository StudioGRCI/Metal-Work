/**
 * Recorre el sistema con la cuenta de CADA puesto, nunca como ADMIN.
 *
 * Por cada cuenta `*.local@metalwork.test` del banco (las crea `preparar.sh`):
 *
 *   1. Entra y lee su menú. Abre cada pantalla del menú, en monitor y en
 *      teléfono (390 px), y anota si abrió, si dijo «Sin permiso» (el menú le
 *      ofrece algo que no le deja abrir: un callejón sin salida), si cayó en la
 *      pantalla de error o en 404, los errores de consola, las respuestas 5xx
 *      del servicio, cuánto tardó y si en el teléfono se sale del borde.
 *   2. Abre todas las demás pantallas fijas del sistema, las que NO están en su
 *      menú, y anota cuáles le dejan entrar con contenido: o es una fuga de
 *      permiso, o es una pantalla que debería estar en su menú.
 *
 * Termina con código distinto de cero si alguna pantalla del menú falló.
 *
 *   BANCO_CLAVE=… node herramientas/banco/recorrer-puestos.mjs [puesto…]
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, SALIDA (json).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas/puestos'
const SALIDA = process.env.SALIDA ?? join(CAPTURAS, 'recorrido.json')
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const PUESTOS = [
  'gerencia', 'administracion', 'almacen', 'logistica', 'conductor', 'contabilidad',
  'diseno', 'colaborador', 'porteria', 'rrhh', 'requerimientos',
  'sup.prd', 'sup.mtz', 'sup.acb', 'tesoreria', 'ventas',
]
const elegidos = process.argv.slice(2)
const puestos = elegidos.length ? PUESTOS.filter((p) => elegidos.includes(p)) : PUESTOS

// Las pantallas sin identificador en la ruta. Las de detalle se alcanzan desde
// los listados; aquí solo se mira quién entra.
const FIJAS = [
  '/', '/adquisiciones', '/almacen/kardex', '/almacen/stock', '/avance', '/avance/abrir-orden',
  '/avance/diario', '/avance/trabajos', '/avance/trabajos/nueva', '/avisos', '/carrocerias',
  '/clientes', '/clientes/nuevo', '/codigos-internos', '/compras', '/compras/aprobacion',
  '/compras/gestion', '/compras/ordenes', '/compras/servicios', '/compras/valorizacion',
  '/configuracion', '/contabilidad/facturacion', '/costos/gastos-generales', '/cotizaciones/pdf',
  '/diseno/codigo', '/diseno/etapas', '/diseno/evaluaciones', '/diseno/evaluaciones/nueva',
  '/diseno/informe-semanal', '/diseno/materiales', '/diseno/planos', '/materiales',
  '/materiales/atencion', '/ordenes', '/ordenes/nueva', '/personal', '/planilla-diaria', '/planos',
  '/proveedores', '/recojos', '/reportes-diarios', '/reportes-diarios/nuevo', '/requerimientos',
  '/requerimientos/atencion', '/requerimientos/gasto-por-codigo', '/rrhh', '/rrhh/asistencia',
  '/rrhh/costeo', '/rrhh/horas-extras', '/rrhh/observaciones', '/rrhh/permisos', '/rrhh/personal',
  '/rrhh/tardanzas', '/seguimiento', '/subcontratos', '/subcontratos/area', '/tesoreria',
  '/tesoreria/caja-diaria', '/tesoreria/cuentas', '/tesoreria/pagos-de-servicio',
  '/tesoreria/por-cobrar', '/tesoreria/por-pagar', '/tesoreria/recibos-por-honorarios',
  '/tesoreria/tipo-de-cambio', '/unidades', '/vehiculos',
]

async function entrar(ctx, correo) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await p.fill('input[type="email"], input[name="correo"]', correo)
  await p.fill('input[type="password"]', CLAVE)
  await p.click('button[type="submit"]')
  const ok = await p
    .waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  return { p, ok }
}

async function mirar(p, ruta, errores, fallas) {
  errores.length = 0
  fallas.length = 0
  const t0 = Date.now()
  let estado = 0
  try {
    const r = await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 60000 })
    estado = r?.status() ?? 0
  } catch (e) {
    return { ruta, resultado: 'NO CARGA', detalle: e.message.split('\n')[0], ms: Date.now() - t0 }
  }
  const ms = Date.now() - t0
  const final = new URL(p.url()).pathname
  const h1 = (await p.locator('h1').first().textContent({ timeout: 2000 }).catch(() => ''))?.trim() ?? ''
  const cuerpo = (await p.locator('main').first().innerText({ timeout: 2000 }).catch(() => '')) ?? ''
  let resultado = 'ABRE'
  if (final === '/sin-permiso' || h1.includes('No tienes acceso')) resultado = 'SIN PERMISO'
  else if (final.startsWith('/ingresar')) resultado = 'SACA DE LA SESIÓN'
  else if (h1.includes('no se pudo abrir')) resultado = 'ERROR'
  else if (estado === 404 || /no existe|no encontrad/i.test(h1)) resultado = '404'
  else if (estado >= 500) resultado = 'ERROR'
  else if (final !== ruta.split('?')[0]) resultado = `REDIRIGE a ${final}`
  const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  return {
    ruta, resultado, estado, ms, h1,
    vacio: cuerpo.trim().length < 40,
    desborde,
    consola: [...new Set(errores)].slice(0, 5),
    servicio: [...new Set(fallas)].slice(0, 5),
  }
}

const nav = await chromium.launch({ executablePath: NAVEGADOR })
const informe = {}
let fallos = 0

for (const puesto of puestos) {
  const correo = `${puesto}.local@metalwork.test`
  const monitor = await nav.newContext({ viewport: { width: 1366, height: 900 } })
  const { p, ok } = await entrar(monitor, correo)
  if (!ok) {
    console.log(`\n## ${puesto}: NO ENTRA`)
    informe[puesto] = { entra: false }
    fallos++
    await monitor.close()
    continue
  }
  const errores = []
  const fallas = []
  p.on('console', (m) => m.type() === 'error' && errores.push(m.text().slice(0, 200)))
  p.on('pageerror', (e) => errores.push(`pageerror: ${e.message.slice(0, 200)}`))
  p.on('response', (r) => r.status() >= 500 && fallas.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 120)}`))

  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const menu = [
    ...new Set(
      await p.$$eval('nav a[href^="/"], aside a[href^="/"]', (as) =>
        as.map((a) => a.getAttribute('href')).filter((h) => h && !h.startsWith('/ingresar')),
      ),
    ),
  ]
  console.log(`\n## ${puesto} · menú: ${menu.join(' ')}`)

  const delMenu = []
  for (const ruta of menu) {
    const r = await mirar(p, ruta, errores, fallas)
    delMenu.push(r)
    const malo = r.resultado !== 'ABRE' || r.consola?.length || r.servicio?.length
    if (malo) fallos++
    console.log(`${malo ? 'MAL ' : '  ok'} ${r.resultado.padEnd(12)} ${String(r.ms).padStart(5)}ms ${ruta}` +
      (r.consola?.length ? ` · consola: ${r.consola.join(' | ')}` : '') +
      (r.servicio?.length ? ` · servicio: ${r.servicio.join(' | ')}` : ''))
    if (malo) await p.screenshot({ path: join(CAPTURAS, `${puesto}${ruta.replaceAll('/', '_')}.png`), fullPage: true })
  }

  // En el teléfono, solo las del menú.
  const telefono = await nav.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    storageState: await monitor.storageState(),
  })
  const pt = await telefono.newPage()
  const desbordes = []
  for (const ruta of menu) {
    const r = await mirar(pt, ruta, [], [])
    if (r.desborde > 2) {
      desbordes.push({ ruta, px: r.desborde })
      await pt.screenshot({ path: join(CAPTURAS, `${puesto}${ruta.replaceAll('/', '_')}-telefono.png`), fullPage: true })
    }
  }
  if (desbordes.length) console.log(`  teléfono, se sale del borde: ${desbordes.map((d) => `${d.ruta} (+${d.px}px)`).join(', ')}`)
  await telefono.close()

  const fuera = []
  for (const ruta of FIJAS.filter((r) => !menu.includes(r))) {
    const r = await mirar(p, ruta, errores, fallas)
    if (r.resultado === 'ABRE' || r.resultado === 'ERROR' || r.resultado.startsWith('NO')) fuera.push(r)
  }
  if (fuera.length) {
    console.log(`  fuera del menú y entra: ${fuera.map((r) => `${r.ruta}${r.resultado !== 'ABRE' ? ` [${r.resultado}]` : ''}`).join(' ')}`)
  }
  informe[puesto] = { entra: true, menu: delMenu, desbordes, fueraDelMenu: fuera }
  await monitor.close()
}

await nav.close()
writeFileSync(SALIDA, JSON.stringify(informe, null, 2))
console.log(`\n${fallos ? `${fallos} pantalla(s) del menú con problemas` : 'Todas las pantallas del menú abren limpias'} · ${SALIDA}`)
process.exit(fallos ? 1 : 0)

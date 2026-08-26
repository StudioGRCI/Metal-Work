/**
 * Recorre la aplicación entera contra el banco de pruebas y deja constancia
 * de cómo respondió cada pantalla.
 *
 * Entra con la cuenta indicada, visita todas las rutas —incluidas las de
 * detalle, cuyos identificadores saca de la propia base— y anota el título que
 * mostró cada una, los errores de consola y cualquier pantalla de error. Al
 * final imprime el resumen y guarda las capturas.
 *
 *   node herramientas/banco/recorrer.mjs [--capturas]
 */

import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'
import pg from 'pg'

const BASE = process.env.BANCO_APP ?? 'http://localhost:3111'
const CORREO = process.env.BANCO_CORREO ?? 'studiogrci@gmail.com'
const CLAVE = process.env.BANCO_CLAVE
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE: la contraseña de la cuenta con la que se recorre el sistema.')
  process.exit(1)
}
const CAPTURAS = process.env.BANCO_CAPTURAS ?? '/tmp/capturas-metalwork'
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const base = new pg.Pool({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})

const primero = async (sql) => (await base.query(sql)).rows[0]?.id ?? null

const ordenId = await primero(
  "select id from public.ordenes_trabajo where estado <> 'BORRADOR' order by numero limit 1",
)
const clienteId = await primero('select id from public.clientes order by razon_social limit 1')
const cotizacionId = await primero('select id from public.cotizaciones limit 1')
const parteId = await primero('select id from public.partes_diarios limit 1')
const movimientoId = await primero('select id from public.movimientos_almacen limit 1')
const requerimientoId = await primero('select id from public.requerimientos limit 1')

const RUTAS = [
  ['tablero', '/'],
  ['ordenes', '/ordenes'],
  ['orden-nueva', '/ordenes/nueva'],
  ordenId && ['orden-detalle', `/ordenes/${ordenId}`],
  ['clientes', '/clientes'],
  ['cliente-nuevo', '/clientes/nuevo'],
  clienteId && ['cliente-detalle', `/clientes/${clienteId}`],
  clienteId && ['cliente-editar', `/clientes/${clienteId}/editar`],
  ['unidades', '/unidades'],
  ['cotizaciones', '/cotizaciones'],
  ['cotizacion-nueva', '/cotizaciones/nueva'],
  cotizacionId && ['cotizacion-detalle', `/cotizaciones/${cotizacionId}`],
  ['avance-taller', '/avance'],
  ordenId && ['avance-unidad', `/avance/${ordenId}`],
  ordenId && ['orden-ficha', `/ordenes/${ordenId}?vista=ficha`],
  ordenId && ['orden-avance', `/ordenes/${ordenId}?vista=avance`],
  ordenId && ['orden-documentos', `/ordenes/${ordenId}?vista=documentos`],
  ['produccion', '/produccion'],
  ['parte-nuevo', '/produccion/nuevo'],
  parteId && ['parte-detalle', `/produccion/${parteId}`],
  ['almacen', '/almacen'],
  ['almacen-movimientos', '/almacen/movimientos'],
  ['movimiento-nuevo', '/almacen/movimientos/nuevo'],
  movimientoId && ['movimiento-detalle', `/almacen/movimientos/${movimientoId}`],
  ['almacen-requerimientos', '/almacen/requerimientos'],
  ['requerimiento-nuevo', '/almacen/requerimientos/nuevo'],
  requerimientoId && ['requerimiento-detalle', `/almacen/requerimientos/${requerimientoId}`],
  ['almacen-compras', '/almacen/compras'],
  ['almacen-materiales', '/almacen/materiales'],
  ['almacen-proveedores', '/almacen/proveedores'],
  ['servicios', '/servicios'],
  ['servicios-por-conformar', '/servicios?estado=EJECUTADO'],
  ['costos', '/costos'],
  ['documentos', '/documentos'],
  ['firmas', '/firmas'],
  ['informes', '/informes'],
  ['informe-produccion', '/informes/produccion?desde=2026-01-01&hasta=2026-12-31'],
  ['informe-rentabilidad', '/informes/rentabilidad?desde=2026-01-01&hasta=2026-12-31'],
  ['informe-cumplimiento', '/informes/cumplimiento?desde=2026-01-01&hasta=2026-12-31'],
  ['informe-comercial', '/informes/comercial?desde=2026-01-01&hasta=2026-12-31'],
  ['informe-materiales', '/informes/materiales?desde=2026-01-01&hasta=2026-12-31'],
  ['informe-subcontratos', '/informes/subcontratos?desde=2026-01-01&hasta=2026-12-31'],
  ['garantias', '/garantias'],
  ['configuracion', '/configuracion'],
  ['personal', '/personal'],
  ['sin-permiso', '/sin-permiso'],
].filter(Boolean)

mkdirSync(CAPTURAS, { recursive: true })

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const contexto = await navegador.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  locale: 'es-PE',
})
const pagina = await contexto.newPage()

let erroresDeConsola = []
pagina.on('console', (mensaje) => {
  if (mensaje.type() === 'error') {
    const texto = mensaje.text()
    // El servidor de desarrollo no habla por websocket con este navegador.
    if (texto.includes('_next/hmr') || texto.includes('WebSocket')) return
    erroresDeConsola.push(texto.slice(0, 300))
  }
})

// ------------------------------------------------------------------ ingreso

await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
await pagina.fill('input[type="email"]', CORREO)
await pagina.fill('input[type="password"]', CLAVE)
await Promise.all([
  pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
  pagina.click('button[type="submit"]'),
])
await pagina.waitForLoadState('networkidle')

if (pagina.url().includes('/ingresar')) {
  console.error('No se pudo entrar con la cuenta indicada.')
  console.error(await pagina.locator('body').innerText())
  await navegador.close()
  await base.end()
  process.exit(1)
}

// ---------------------------------------------------------------- recorrido

const resultados = []

for (const [nombre, ruta] of RUTAS) {
  erroresDeConsola = []
  const respuesta = await pagina.goto(BASE + ruta, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(350)

  const titulo = await pagina.locator('h1').first().innerText().catch(() => '(sin título)')
  const cuerpo = await pagina.locator('body').innerText()
  const falla =
    /Ocurrió un error inesperado|Application error|Unhandled Runtime Error|no se pudo|No se pudieron/i.test(
      cuerpo,
    )

  resultados.push({
    nombre,
    ruta,
    estado: respuesta?.status() ?? 0,
    titulo: titulo.split('\n')[0].slice(0, 42),
    falla,
    errores: [...erroresDeConsola],
  })

  await pagina.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: true })
}

await navegador.close()
await base.end()

// ------------------------------------------------------------------ informe

const ancho = Math.max(...resultados.map((r) => r.ruta.length))
let malas = 0

console.log('')
for (const r of resultados) {
  const marca = r.estado === 200 && !r.falla ? '✔' : '✗'
  if (marca === '✗') malas += 1
  console.log(`${marca} ${r.ruta.padEnd(ancho)}  ${String(r.estado).padEnd(3)}  ${r.titulo}`)
  for (const error of r.errores.slice(0, 2)) console.log(`    ${error}`)
}

console.log('')
console.log(`${resultados.length - malas} de ${resultados.length} pantallas bien · capturas en ${CAPTURAS}`)
process.exit(malas === 0 ? 0 : 1)

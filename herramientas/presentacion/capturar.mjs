/**
 * Captura, contra el banco de pruebas, las pantallas del procedimiento de la
 * orden de trabajo tal como se recorre en el sistema. Cada captura sale en
 * formato de diapositiva (16:9) y enfocada en lo que la pantalla explica.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
import pg from 'pg'

const SALIDA = process.env.SALIDA ?? '/tmp/presentacion'
const BASE = 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
if (!CLAVE) { console.error('Falta BANCO_CLAVE'); process.exit(1) }

mkdirSync(SALIDA, { recursive: true })

const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: 'mw_demo' })
await base.connect()
const uno = async (sql) => (await base.query(sql)).rows[0]?.id ?? null

const cot = await uno(`select c.id from public.cotizaciones c
  join public.tipos_carroceria t on t.id = c.tipo_carroceria_id
 where t.codigo = 'TOLVA_VOLQUETE' limit 1`)
const ot = await uno(`select id from public.ordenes_trabajo where estado = 'EN_PROCESO' limit 1`)
const req = await uno('select id from public.requerimientos limit 1')
const mov = await uno('select id from public.movimientos_almacen limit 1')
const parte = await uno('select id from public.partes_diarios limit 1')

// nombre, ruta, texto que hay que dejar a la vista antes de disparar
const PASOS = [
  ['01-tablero',        '/'],
  ['02-cotizacion',     `/cotizaciones/${cot}`],
  ['03-ficha-tecnica',  `/cotizaciones/${cot}`, 'Especificaciones técnicas'],
  ['04-accesorios-cot', `/cotizaciones/${cot}`, 'Accesorios y equipamiento'],
  ['05-ordenes',        '/ordenes'],
  ['06-orden-nueva',    '/ordenes/nueva'],
  ['07-orden-resumen',  `/ordenes/${ot}`],
  ['08-etapas',         `/ordenes/${ot}?vista=etapas`],
  ['09-ficha-medidas',  `/ordenes/${ot}?vista=ficha`],
  ['10-verificacion',   `/ordenes/${ot}?vista=ficha`, 'Verificación y funcionamiento'],
  ['11-accesorios-ot',  `/ordenes/${ot}?vista=ficha`, 'Accesorios'],
  ['12-requerimiento',  `/almacen/requerimientos/${req}`],
  ['13-movimiento',     `/almacen/movimientos/${mov}`],
  ['14-parte-diario',   `/produccion/${parte}`],
  ['15-avance-taller',  '/avance'],
  ['16-avance-unidad',  `/avance/${ot}`],
  ['17-servicios',      '/servicios'],
  ['18-calidad',        `/ordenes/${ot}?vista=calidad`],
  ['19-documentos',     `/ordenes/${ot}?vista=documentos`],
  ['20-firmas',         '/firmas'],
  ['21-costos',         `/ordenes/${ot}?vista=costos`],
  ['22-trazabilidad',   `/ordenes/${ot}?vista=bitacora`],
  ['23-informes',       '/informes'],
  ['24-cumplimiento',   '/informes/cumplimiento?desde=2026-01-01&hasta=2026-12-31'],
]

const nav = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
const ctx = await nav.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
  locale: 'es-PE',
})
const p = await ctx.newPage()

await p.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
await p.fill('input[type="email"]', 'studiogrci@gmail.com')
await p.fill('input[type="password"]', CLAVE)
await Promise.all([
  p.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
  p.click('button[type="submit"]'),
])
await p.waitForLoadState('networkidle')
if (p.url().includes('/ingresar')) { console.error('no entró'); process.exit(1) }

for (const [nombre, ruta, ancla] of PASOS) {
  await p.goto(BASE + ruta, { waitUntil: 'networkidle' })
  await p.waitForTimeout(500)

  // El indicador del servidor de desarrollo no tiene por qué salir en la
  // presentación.
  await p.addStyleTag({
    content: `
      nextjs-portal, #__next-build-watcher { display: none !important }
      /* Solo para la presentación: al bajar a una sección de más abajo, la
         navegación tiene que seguir a la vista para que se entienda dónde
         está uno. */
      aside { position: sticky !important; top: 0 !important; height: 100vh !important }
      header { position: sticky !important; top: 0 !important; z-index: 30 }
    `,
  })

  if (ancla) {
    // scrollIntoViewIfNeeded deja el texto pegado al borde de abajo; acá se
    // quiere la sección completa, así que se lleva al tope y se baja un poco.
    const destino = p.getByText(ancla, { exact: false }).first()
    await destino.evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {})
    await p.evaluate(() => window.scrollBy(0, -110))
    await p.waitForTimeout(400)
  }

  await p.screenshot({ path: `${SALIDA}/${nombre}.png` })
  console.log('✔', nombre, ruta)
}

await nav.close()
await base.end()

/**
 * Clic real sobre los dos puestos nuevos (migración 20261125200000, StudioGRCI,
 * 2026-11-25): «Gerencia comercial con vinculacion de ventas y gerencia de
 * produccion quien valida el avance».
 *
 * Con la cuenta de cada puesto:
 *   · Gerencia Comercial ve su menú de Ventas (cotizaciones, clientes, unidades
 *     y OT), cada pantalla abre y ninguna le ofrece registrar; el reporte
 *     diario y el seguimiento no le abren.
 *   · Gerencia de Producción ve el reporte diario y el seguimiento por código,
 *     da el visto de Gerencia con un toque (y queda en la base a su nombre), y
 *     las cotizaciones, los clientes y los códigos internos con su costo no le
 *     abren.
 * Guarda capturas en 390 y 1440.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const REGISTRA = /^(Registrar|Nuevo|Nueva|Agregar|Emitir|Corregir|Subir|Crear|Cargar|Dar código|Aprobar|Devolver|Anular)/i

const COMERCIAL = 'gerencia.comercial.local@metalwork.test'
const PRODUCCION = 'gerencia.produccion.local@metalwork.test'

// Un reporte diario por validar, sembrado por debajo de los disparadores, a
// nombre del supervisor de Producción.
const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
await base.connect()
const [sup] = (await base.query("select id from public.usuarios where correo = 'sup.prd.local@metalwork.test'")).rows
await base.query('begin')
await base.query("set local session_replication_role = replica")
const [rep] = (await base.query(
  `insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, registrado_por)
   values ((now() at time zone 'America/Lima')::date, 'CM-QA-460', 'Armado del cajón', 'Se armó la estructura del cajón y se soldaron los parantes.', $1)
   returning id`,
  [sup.id],
)).rows
// Una cotización de Ventas, aprobada por Gerencia General, con su OT: la que
// Gerencia Comercial sigue hasta el taller. Se reusa la OT 0001-2026 de la demostración.
const [ventas] = (await base.query("select id from public.usuarios where correo = 'ventas.local@metalwork.test'")).rows
const [gerente] = (await base.query("select id from public.usuarios where correo = 'gerencia.local@metalwork.test'")).rows
const [ot] = (await base.query("select id, numero, cliente_id, tipo_carroceria_id from public.ordenes_trabajo where numero = '0001-2026'")).rows
// Un número por corrida: la serie no deja repetirlo.
const NUMERO = `4${String(Date.now()).slice(-3)}-2026`
const [cot] = (await base.query(
  `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, registrado_por,
     revisado_por, revisado_en, moneda, monto_venta)
   select g.id, $5, $1, $2, 'APROBADA', 'cotizacion-4600.pdf', 'cot/' || g.id || '/cotizacion-4600.pdf', $3, $4, now(), 'PEN', 48500
     from (select gen_random_uuid() as id) g
   returning id`,
  [ot.cliente_id, ot.tipo_carroceria_id, ventas.id, gerente.id, NUMERO],
)).rows
await base.query('update public.ordenes_trabajo set cotizacion_pdf_id = $1 where id = $2', [cot.id, ot.id])
await base.query('commit')

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: ancho < 500 ? 844 : 900 },
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
  })
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

async function menu(pagina) {
  return pagina.locator('aside nav a').evaluateAll((as) => as.map((a) => new URL(a.href).pathname))
}

async function registra(pagina) {
  const nombres = await pagina.locator('main').locator('button, a').evaluateAll((bs) =>
    bs.filter((b) => b.offsetParent !== null).map((b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()),
  )
  return nombres.filter((n) => REGISTRA.test(n))
}

async function abre(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  return !new URL(pagina.url()).pathname.startsWith('/sin-permiso')
}

// El dashboard pinta su esqueleto mientras lee: la captura espera a que se vaya.
async function foto(pagina, nombre) {
  await pagina.locator('.animate-pulse').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: true })
}

// Gerencia Comercial ---------------------------------------------------------
{
  const { pagina, contexto, errores } = await entrar(COMERCIAL, 1440)
  const rutas = await menu(pagina)
  comprobar(
    ['/cotizaciones/pdf', '/clientes', '/unidades', '/ordenes'].every((r) => rutas.includes(r)),
    `Gerencia Comercial tiene su menú de Ventas: ${rutas.join(', ')}`,
  )
  await foto(pagina, 'gco-1440-dashboard')
  for (const ruta of ['/cotizaciones/pdf', '/clientes', '/unidades', '/ordenes']) {
    comprobar(await abre(pagina, ruta), `Gerencia Comercial abre ${ruta}`)
    const botones = await registra(pagina)
    comprobar(botones.length === 0, `y no registra nada ahí${botones.length ? `: ${botones.join(', ')}` : ''}`)
    if (ruta === '/cotizaciones/pdf') {
      comprobar((await pagina.getByText(NUMERO).count()) > 0, 'la cotización aprobada sale en su lista')
      await foto(pagina, 'gco-1440-cotizaciones')
    }
  }
  // De la cotización a su OT: el enlace lleva a la orden, y en ella ve el documento comercial.
  await abre(pagina, '/cotizaciones/pdf')
  const enlaceOt = pagina.locator(`main a[href="/ordenes/${ot.id}"]`).first()
  comprobar((await enlaceOt.count()) === 1, `la cotización lleva a su OT ${ot.numero}`)
  if (await enlaceOt.count()) {
    await enlaceOt.click()
    await pagina.waitForURL(`**/ordenes/${ot.id}`, { timeout: 30000 }).catch(() => {})
    await pagina.waitForLoadState('networkidle')
    comprobar(new URL(pagina.url()).pathname === `/ordenes/${ot.id}`, 'y la OT abre')
    const cotizacion = pagina.locator('main').getByText(new RegExp(`Cotización\\s+${NUMERO}`))
    await cotizacion.first().waitFor({ timeout: 15000 }).catch(() => {})
    comprobar((await cotizacion.count()) > 0, 'con su cotización a la vista')
    await foto(pagina, 'gco-1440-ot-con-cotizacion')
  }
  for (const ruta of ['/reportes-diarios', '/seguimiento', '/codigos-internos']) {
    comprobar(!(await abre(pagina, ruta)), `Gerencia Comercial no abre ${ruta}`)
  }
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(COMERCIAL, 390)
  await foto(pagina, 'gco-390-dashboard')
  await abre(pagina, '/cotizaciones/pdf')
  await foto(pagina, 'gco-390-cotizaciones')
  await contexto.close()
}

// Gerencia de Producción ------------------------------------------------------
{
  const { pagina, contexto, errores } = await entrar(PRODUCCION, 1440)
  const rutas = await menu(pagina)
  comprobar(['/reportes-diarios', '/seguimiento'].every((r) => rutas.includes(r)), `Gerencia de Producción tiene su menú: ${rutas.join(', ')}`)
  await foto(pagina, 'gpr-1440-dashboard')
  comprobar(await abre(pagina, '/seguimiento'), 'Gerencia de Producción abre el seguimiento por código')
  await foto(pagina, 'gpr-1440-seguimiento')
  comprobar(await abre(pagina, '/reportes-diarios'), 'abre los reportes diarios')
  await foto(pagina, 'gpr-1440-reportes')
  comprobar(await abre(pagina, `/reportes-diarios/${rep.id}`), 'abre el reporte por validar')
  const boton = pagina.locator('[data-validar="GERENCIA"]')
  comprobar((await boton.count()) === 1, 'tiene «Dar visto bueno» de Gerencia')
  comprobar((await pagina.locator('[data-validar="RRHH"]').count()) === 0, 'y no el de RR. HH.')
  await foto(pagina, 'gpr-1440-reporte-antes')
  await boton.click()
  await pagina.waitForLoadState('networkidle')
  await pagina.waitForTimeout(1500)
  const [fila] = (await base.query('select visto_gerencia_por from public.reportes_diarios where id = $1', [rep.id])).rows
  const [yo] = (await base.query("select id from public.usuarios where correo = $1", [PRODUCCION])).rows
  comprobar(fila.visto_gerencia_por === yo.id, 'el visto de Gerencia queda en la base a su nombre')
  await foto(pagina, 'gpr-1440-reporte-con-visto')
  for (const ruta of ['/cotizaciones/pdf', '/clientes', '/codigos-internos', '/ordenes']) {
    comprobar(!(await abre(pagina, ruta)), `Gerencia de Producción no abre ${ruta}`)
  }
  comprobar(!(await abre(pagina, `/ordenes/${ot.id}`)), 'ni la OT con su cotización')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}
// Gerencia General con el reporte abierto desde antes del visto de Producción:
// al pulsar, la pantalla dice de quién es el visto que quedó, no «registrado».
{
  await base.query('update public.reportes_diarios set visto_gerencia_por = null, visto_gerencia_en = null where id = $1', [rep.id])
  const { pagina, contexto } = await entrar('gerencia.local@metalwork.test', 1440)
  await abre(pagina, `/reportes-diarios/${rep.id}`)
  const [yo] = (await base.query('select id from public.usuarios where correo = $1', [PRODUCCION])).rows
  await base.query('update public.reportes_diarios set visto_gerencia_por = $1, visto_gerencia_en = now() where id = $2', [yo.id, rep.id])
  await pagina.locator('[data-validar="GERENCIA"]').click()
  const aviso = pagina.getByText('ya tenía el visto de Gerencia, de Gerencia de Producción')
  // Y aunque el aviso se lea, la línea de Gerencia dice de quién es el visto.
  await aviso.first().waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await aviso.count()) > 0, 'Gerencia General, tarde, lee que el visto ya era de Gerencia de Producción')
  const [fila] = (await base.query('select visto_gerencia_por from public.reportes_diarios where id = $1', [rep.id])).rows
  comprobar(fila.visto_gerencia_por === yo.id, 'y el visto sigue a nombre de Gerencia de Producción')
  await pagina.reload({ waitUntil: 'networkidle' })
  comprobar((await pagina.getByText('Visto bueno de Gerencia de Producción').count()) > 0, 'y la pantalla dice de quién es el visto')
  await foto(pagina, 'ggr-1440-visto-ya-dado')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(PRODUCCION, 390)
  await foto(pagina, 'gpr-390-dashboard')
  await abre(pagina, `/reportes-diarios/${rep.id}`)
  await foto(pagina, 'gpr-390-reporte-con-visto')
  await abre(pagina, '/seguimiento')
  await foto(pagina, 'gpr-390-seguimiento')
  await contexto.close()
}

// El banco queda como estaba: la OT de la demostración vuelve a no tener
// cotización y la de prueba, que no tiene archivo, queda anulada con su motivo
// (un documento numerado no se borra).
await base.query('begin')
await base.query('set local session_replication_role = replica')
await base.query('update public.ordenes_trabajo set cotizacion_pdf_id = null where id = $1', [ot.id])
await base.query(
  "update public.cotizaciones_pdf set estado = 'ANULADA', motivo_anulacion = 'Cotización de prueba del recorrido de Gerencia Comercial', anulado_por = $2, anulado_en = now() where id = $1",
  [cot.id, gerente.id],
)
await base.query('commit')

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

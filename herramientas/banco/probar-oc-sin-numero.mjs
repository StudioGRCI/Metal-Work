/**
 * Las OC de antes de la serie OC-…-MW no tienen número de la casa, y su
 * referencia es la cotización del proveedor. En producción, Adquisiciones ›
 * Facturas la mostraba sola, como si fuera el número de la OC («OC-0001»), y
 * Gerencia no tenía Adquisiciones en su menú (2026-10-22). Con clic real y la
 * cuenta de cada puesto (nunca ADMIN), consultando la base después del clic:
 *
 *   1. Gerencia tiene Adquisiciones en «Consultas» y la abre; la OC sin número
 *      sale «OC sin número» con su referencia aparte.
 *   2. Contabilidad la ve en el formulario como «OC sin número (ref. del
 *      proveedor …)», registra su factura, y la tabla y la lista del teléfono
 *      la nombran igual. La ventana de «Corregir» también.
 *   3. Tesorería ve la factura en Cuentas por pagar con la OC nombrada así, y
 *      el PDF de la OC con el mismo nombre.
 *
 * Siembra una OC del RQ, aprobada, y le quita el número como a una de antes de
 * la serie (sin disparadores: ninguna pantalla deja hacerlo). Corre las veces
 * que haga falta. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * CAPTURAS, BANCO_BASE, ARCHIVOS y el correo de cada cuenta si no es
 * `<puesto>.local@metalwork.test`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.ARCHIVOS ?? CAPTURAS
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'contabilidad', 'tesoreria', 'gerencia', 'requerimientos', 'almacen'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(ARCHIVOS, { recursive: true })
const PDF_COMPROBANTE = join(ARCHIVOS, 'minimo.pdf')
writeFileSync(
  PDF_COMPROBANTE,
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
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

/** El texto de todas las filas de una factura: la primera la nombra y las demás siguen hasta su rowspan. */
async function grupo(pagina, numero) {
  const primera = pagina.locator('tbody tr', { hasText: numero }).first()
  if ((await primera.count()) === 0) return ''
  const alto = Number((await primera.locator('td[rowspan]').first().getAttribute('rowspan').catch(() => '1')) ?? 1)
  const textos = [await primera.textContent()]
  for (let i = 1; i < alto; i++) textos.push(await primera.locator(`xpath=following-sibling::tr[${i}]`).textContent())
  return textos.join(' ')
}

/** Los textos del menú, sin el contador del final. */
const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+$/, ''))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `ACEROS SIN NÚMERO ${SUFIJO} S.A.C.`
// La referencia tiene la forma de un número de OC: es justo lo que confundía.
const REFERENCIA = `OC-${SUFIJO.slice(-4)}`
const FACTURA = `F903-${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
async function rucLibre() {
  for (;;) {
    const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const [fila] = await consulta(
      `select n from (select $1 || d as n from generate_series(0, 9) d) x
        where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
      [prefijo],
    )
    if (fila) return fila.n
  }
}
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 903, Lima', '999 903 903') returning id`,
  [await rucLibre(), PROVEEDOR],
)
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`SN-${SUFIJO}`, `Plancha LAC 1/8" (${SUFIJO})`, cat, und],
)
const [{ id: rq }] = await consulta(`select gen_random_uuid() as id`)
await como('requerimientos')
await consulta(
  `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/21', $3, null,
     jsonb_build_array(jsonb_build_object('descripcion', 'Plancha', 'cantidad', 1, 'unidad_medida_id', $4::text, 'categoria_id', $5::text)))`,
  [rq, area, `Prueba de la OC sin número ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
await como('logistica')
const [{ id: oc }] = await consulta(
  `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[1]::smallint[], $2, null,
     jsonb_build_array(jsonb_build_object('material_id', $3::text, 'cantidad', 1, 'precio', 250::numeric)), null, 'CONTADO', 0, 'PEN', true) as id`,
  [rq, proveedor, material],
)
await como('gerencia')
await consulta(`select public.aprobar_compra($1)`, [oc])
// Como una de antes de la serie: sin número de la casa, con la referencia del proveedor.
await base.query('begin')
await base.query(`set local session_replication_role = replica`)
await base.query(`update ordenes_compra_materiales set numero = null, referencia = $2 where id = $1`, [oc, REFERENCIA])
await base.query('commit')
const [sembrada] = await consulta(`select numero, referencia, aprobacion, public.total_orden_compra(id)::float as total from ordenes_compra_materiales where id = $1`, [oc])
if (sembrada.numero !== null || sembrada.referencia !== REFERENCIA || sembrada.aprobacion !== 'APROBADA' || sembrada.total !== 295) {
  throw new Error(`La siembra no dejó la OC aprobada, sin número y con 295.00: ${JSON.stringify(sembrada)}`)
}
const NOMBRE = `OC sin número (ref. del proveedor ${REFERENCIA})`
console.log(`     sembrada la OC sin número, con la referencia ${REFERENCIA}`)

// ---------------------------------------------------------------- 1. Gerencia
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  const items = await menu(pagina)
  console.log('     menú de Gerencia:', items.join(' · '))
  comprobar(items.includes('Adquisiciones') && items.indexOf('Adquisiciones') < items.indexOf('Cuentas por cobrar'),
    'Gerencia tiene Adquisiciones en «Consultas», antes de Cuentas por cobrar')
  // Sin el enlace, por su dirección: lo demás se comprueba igual.
  const enlace = pagina.locator('nav[aria-label="Menú principal"] a', { hasText: 'Adquisiciones' }).first()
  if (await enlace.count()) await enlace.click()
  else await pagina.goto(`${BASE}/adquisiciones`)
  await pagina.waitForURL((u) => u.pathname === '/adquisiciones', { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const h1 = limpio(await pagina.locator('h1').first().textContent().catch(() => ''))
  const filas = await pagina.locator('tbody tr').count()
  comprobar(pagina.url().endsWith('/adquisiciones') && h1 === 'Adquisiciones' && filas > 0, `la pantalla abre con su tabla: «${h1}», ${filas} filas`)
  const fila = limpio(await pagina.locator('tbody tr', { hasText: PROVEEDOR }).first().textContent().catch(() => ''))
  comprobar(fila.includes('OC sin número') && fila.includes(`Ref. del proveedor: ${REFERENCIA}`), 'la OC sin número sale «OC sin número», con su referencia aparte')
  await pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-gerencia.png'), fullPage: true, caret: 'initial' })
  await contexto.close()
}

// ------------------------------------------------------------- 2. Contabilidad
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const casilla = pagina.locator(`input[name="ordenes_compra"][value="${oc}"]`)
  const etiqueta = limpio(await casilla.locator('xpath=ancestor::label').textContent().catch(() => ''))
  comprobar(etiqueta.startsWith(NOMBRE), `en el formulario se marca como «${NOMBRE}» (dice «${etiqueta.slice(0, 80)}»)`)
  await casilla.check()
  await pagina.locator('#adq-total').fill('295')
  await pagina.locator('#adq-numero').fill(FACTURA)
  await pagina.locator('#adq-emision').fill(hoy)
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await pagina.locator('#adq-pdf').setInputFiles(PDF_COMPROBANTE)
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText(`Comprobante ${FACTURA} registrado`).waitFor({ timeout: 30000 }).catch(() => {})
  const error = limpio(await pagina.locator('form [role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  const [enlace] = await consulta(
    `select count(*)::int as n from adquisiciones_ordenes_compra l join adquisiciones a on a.id = l.adquisicion_id
      where a.numero_documento = $1 and a.estado = 'REGISTRADA' and l.orden_compra_id = $2`,
    [FACTURA, oc],
  )
  comprobar(!error && enlace.n === 1, `registra la factura con esa OC, y la base la guarda ligada${error ? ` (dijo «${error}»)` : ''}`)
  await pagina.locator('tbody tr', { hasText: FACTURA }).first().waitFor({ timeout: 15000 }).catch(() => {})
  const textoFila = limpio(await grupo(pagina, FACTURA))
  const celda = limpio(await pagina.locator('tbody tr', { hasText: FACTURA }).first().locator(`a[href="/compras/${oc}/pdf"]`).first().textContent().catch(() => ''))
  comprobar(celda === 'OC sin número' && textoFila.includes(`Ref. del proveedor: ${REFERENCIA}`),
    `en la tabla, la OC es «OC sin número» y su referencia va aparte (el enlace dice «${celda}»)`)

  // «Corregir»: la lista de OC de la ventana.
  await pagina.getByRole('button', { name: `Corregir el comprobante ${FACTURA}` }).first().click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 15000 }).catch(() => {})
  const enLaVentana = limpio(await ventana.textContent().catch(() => ''))
  comprobar(enLaVentana.includes(NOMBRE), 'la ventana de «Corregir» la nombra igual')
  await pagina.keyboard.press('Escape')
  await ventana.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await contexto.close()

  // En el teléfono, la lista de facturas.
  const tel = await entrar(CUENTAS.contabilidad, { width: 390, height: 844 })
  await tel.pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const tarjeta = limpio(await tel.pagina.locator(`[data-factura-telefono="${FACTURA}"]`).textContent().catch(() => ''))
  comprobar(tarjeta.includes(NOMBRE), 'en el teléfono la factura nombra la OC igual')
  const ancho = await tel.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `y la página no se ensancha (${ancho} px)`)
  await tel.pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-contabilidad-telefono.png'), fullPage: true, caret: 'initial' })
  await tel.contexto.close()
}

// ---------------------------------------------------------------- 3. Tesorería
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const factura = pagina.locator('article', { hasText: FACTURA })
  const texto = limpio(await factura.textContent().catch(() => ''))
  comprobar(texto.includes(NOMBRE) && !texto.includes(`OC ${REFERENCIA}`), 'en Cuentas por pagar la factura nombra la OC sin hacer pasar la referencia por su número')
  comprobar(texto.includes(`PDF de la ${NOMBRE}`), 'y el PDF de la OC lleva el mismo nombre')
  await pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-tesoreria.png'), fullPage: true, caret: 'initial' })
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length) console.log('\nErrores de consola:\n  ' + errores.join('\n  '))
console.log(`\n${fallas.length === 0 ? 'Todo bien' : `${fallas.length} fallas`} · capturas en ${CAPTURAS}`)
process.exit(fallas.length === 0 && errores.length === 0 ? 0 : 1)

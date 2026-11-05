/**
 * Recorre con clic real la factura de compra con varias OC, el aviso de monto
 * y el pago con voucher (migración 20261015122000), y la tabla de
 * Adquisiciones con el enlace a cada documento, con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Logística tiene Adquisiciones en «Consultas», ve las OC que esperan su
 *      factura y no tiene el formulario.
 *   2. Contabilidad marca dos OC del mismo proveedor (la del otro proveedor se
 *      apaga), ve el aviso cuando el total no calza y cuando calza, y registra
 *      la factura. Registra otra a crédito que no calza: entra igual.
 *   3. Tesorería ve las dos en Cuentas por pagar (también la de contado), paga
 *      una parte con su voucher, anula ese pago con su motivo y la paga entera.
 *   4. Logística ve la factura pagada y no entra a Cuentas por pagar.
 *   4b. La tabla: cada fila va RQ → OC → factura (número y fecha) → pago, y cada
 *      código abre su documento (el RQ solo, el PDF de la OC, el de la factura,
 *      el voucher, el proveedor y, si falta pagarla, la factura en Cuentas por
 *      pagar). Logística no tiene el enlace a Cuentas por pagar; Ventas no
 *      entra. En el teléfono la tabla se desliza sin ensanchar la página.
 *   5. Si están las OS QA-OS-1 (afecta al 12 %, 2 000.00 sin IGV) y QA-OS-2 (no
 *      sujeta), Tesorería ve en Pagos de servicio cuánto va al Banco de la
 *      Nación (migración 20261015141000).
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo, así corre las
 * veces que haga falta: dos proveedores; el RQ A con un insumo, del que sale la
 * OC 1 (1 180.00 con IGV, contado); el RQ B con dos, de los que salen la OC 2
 * (118.00, el mismo proveedor, contado) y la OC 3 (590.00, el otro proveedor,
 * crédito a 30 días). Las tres van con factura y las aprueba Gerencia.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * ARCHIVOS (donde escribe el PDF que sube) y el correo de cada cuenta si no es
 * `<puesto>.local@metalwork.test` (LOGISTICA=…, CONTABILIDAD=…).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba, elegirCuenta } from './caja-de-prueba.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.ARCHIVOS ?? CAPTURAS
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(
  ['logistica', 'contabilidad', 'tesoreria', 'gerencia', 'requerimientos', 'almacen', 'ventas'].map((p) => [p, cuenta(p)]),
)
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(ARCHIVOS, { recursive: true })
const PDF_COMPROBANTE = join(ARCHIVOS, 'minimo.pdf')
const PDF_VOUCHER = join(ARCHIVOS, 'voucher.pdf')
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
writeFileSync(PDF_COMPROBANTE, PDF)
writeFileSync(PDF_VOUCHER, PDF)

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

// En el banco, la lista de Adquisiciones con la sesión de Tesorería puede no
// quedar nunca quieta: un pedido por adelantado a la ficha de un proveedor se
// queda sin respuesta, y `networkidle` vence a los 30 s. Pasa igual en main
// (tres de tres vueltas, en el mismo paso). Se espera la carga y, como mucho,
// 15 s de quietud.
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await pagina.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
}

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await ir(pagina, `${BASE}/ingresar`)
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

async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
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

/** Lo que devuelve un enlace con la sesión de la página: estado y tipo. */
async function abrir(pagina, href) {
  const r = await pagina.request.get(new URL(href, BASE).toString())
  return { estado: r.status(), tipo: r.headers()['content-type'] ?? '' }
}

const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+\+?$/, ''))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())

// ---------------------------------------------------------------- siembra
// Sin cero adelante: la base normaliza «F001-012345» a «F001-12345» y el número no se encontraría.
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `FERRETERÍA DE PRUEBA ${SUFIJO} S.A.C.`
const OTRO_PROVEEDOR = `TORNILLOS DE PRUEBA ${SUFIJO} E.I.R.L.`
const FA = `F901-${SUFIJO}`
const FB = `F902-${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c] && p !== 'ventas') throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

/** Lo que hace la sesión de esa cuenta: los disparadores y las funciones leen el usuario de aquí. */
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
/** Un RUC válido que ningún proveedor tiene todavía. */
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
const RUC = await rucLibre()
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 901, Lima', '999 901 901') returning id`,
  [RUC, PROVEEDOR],
)
const [{ id: otroProveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Colonial 902, Lima', '999 902 902') returning id`,
  [await rucLibre(), OTRO_PROVEEDOR],
)
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`ADQ-${SUFIJO}`, `Perno hexagonal 1/2" x 2" (${SUFIJO})`, cat, und],
)
/** Un RQ con tantos insumos, que Almacén no tiene: Logística compra todo. */
async function requerimiento(insumos, motivo) {
  const [{ id }] = await consulta(`select gen_random_uuid() as id`)
  await como('requerimientos')
  await consulta(
    `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/21', $3, null,
       (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 1, 'unidad_medida_id', $4::text, 'categoria_id', $5::text))
          from generate_series(1, $6::int) n))`,
    [id, area, motivo, und, cat, insumos],
  )
  await como('almacen')
  await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [id])
  return id
}
const rqA = await requerimiento(1, `Prueba de Adquisiciones ${SUFIJO}, RQ A`)
const rqB = await requerimiento(2, `Prueba de Adquisiciones ${SUFIJO}, RQ B`)
/** Una OC del RQ por ese insumo, con factura: con IGV, 1 × 1 000.00 da 1 180.00. */
async function compra(rq, item, prov, precio, condicion, dias) {
  await como('logistica')
  const [{ id }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
       jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 1, 'precio', $5::numeric)), null, $6, $7, 'PEN', true) as id`,
    [rq, item, prov, material, precio, condicion, dias],
  )
  await como('gerencia')
  await consulta(`select public.aprobar_compra($1)`, [id])
  return id
}
const ocs = [
  await compra(rqA, 1, proveedor, 1000, 'CONTADO', 0),
  await compra(rqB, 1, proveedor, 100, 'CONTADO', 0),
  await compra(rqB, 2, otroProveedor, 500, 'CREDITO', 30),
]
const [oc1, oc2, oc3] = await consulta(
  `select o.id, o.numero, o.aprobacion from unnest($1::uuid[]) with ordinality u(id, n) join ordenes_compra_materiales o on o.id = u.id order by u.n`,
  [ocs],
)
const [rq1] = await consulta(`select id, numero from requerimientos where id = $1`, [rqA])
const [rq2] = await consulta(`select id, numero from requerimientos where id = $1`, [rqB])
const totales = await consulta(`select public.total_orden_compra(id)::float as total from unnest($1::uuid[]) with ordinality u(id, n) order by n`, [ocs])
if (![oc1, oc2, oc3].every((o) => o.numero && o.aprobacion === 'APROBADA') || totales.map((t) => t.total).join('|') !== '1180|118|590') {
  throw new Error(`La siembra no dejó las tres OC aprobadas con 1 180.00, 118.00 y 590.00 (${totales.map((t) => t.total).join(', ')}).`)
}
console.log(`     sembrado con el sufijo ${SUFIJO}: ${rq1.numero} (${oc1.numero}), ${rq2.numero} (${oc2.numero}, ${oc3.numero})`)
// Cada pago pide la cuenta de la caja de la que salió (migración 20261019100000).
const CAJA = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)

// ---------------------------------------------------------------- 1. Logística
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  const items = await menu(pagina)
  console.log('     menú de Logística:', items.join(' · '))
  // Desde #96 sus Consultas van Adquisiciones, Proveedores y Valorización, después de su trabajo.
  comprobar(items.includes('Adquisiciones') && items.indexOf('Adquisiciones') > items.indexOf('Órdenes de servicio') && items.indexOf('Órdenes de servicio') > 0,
    'Logística tiene Adquisiciones en Consultas, después de su trabajo')
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  const cuerpo = limpio(await pagina.locator('main').textContent())
  comprobar(cuerpo.includes('OC que esperan su factura') && cuerpo.includes(oc1.numero) && cuerpo.includes(oc3.numero),
    'Logística ve las OC que esperan su factura')
  comprobar((await pagina.getByRole('button', { name: 'Registrar comprobante' }).count()) === 0, 'y no tiene el formulario de Contabilidad')
  await contexto.close()
}

// ------------------------------------------------------------- 2. Contabilidad
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  const casilla = (oc) => pagina.locator(`input[name="ordenes_compra"][value="${oc.id}"]`)
  await casilla(oc1).check()
  comprobar(await casilla(oc3).isDisabled(), 'marcada una OC, la de otro proveedor se apaga')
  comprobar((await pagina.locator('#adq-proveedor').inputValue()) === PROVEEDOR, 'el proveedor sale solo de la OC')
  await casilla(oc2).check()
  await pagina.locator('#adq-total').fill('1300')
  const aviso = limpio(await pagina.locator('form').getByText('Las OC marcadas suman').textContent())
  console.log('     aviso:', aviso)
  comprobar(aviso.includes('1,298.00') && aviso.includes('sobran') && aviso.includes('2.00'), 'con 1 300.00 avisa que sobran 2.00 frente a las dos OC')
  await pagina.locator('#adq-total').fill('1298')
  comprobar((await pagina.locator('form').getByText('Calza con lo que falta facturar').count()) === 1, 'con 1 298.00 dice que calza')
  await pagina.locator('#adq-numero').fill(FA)
  await pagina.locator('#adq-emision').fill(hoy)
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await pagina.locator('#adq-pdf').setInputFiles(join(ARCHIVOS, 'minimo.pdf'))
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText(`Comprobante ${FA} registrado`).waitFor({ timeout: 30000 }).catch(() => {})
  const error = limpio(await pagina.locator('form [role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  comprobar(!error && (await pagina.getByText(`Comprobante ${FA} registrado con 2 OC`).count()) === 1, `la factura entra con sus dos OC${error ? ` (dijo «${error}»)` : ''}`)
  // El aviso sale antes de que la lista se vuelva a pedir: se espera la fila.
  await pagina.locator('tbody tr', { hasText: FA }).first().waitFor({ timeout: 15000 }).catch(() => {})
  const textoFila = limpio(await grupo(pagina, FA))
  comprobar(textoFila.includes('Calza con sus OC') && textoFila.includes(oc1.numero) && textoFila.includes(oc2.numero),
    'la tabla la muestra con sus dos OC y «Calza con sus OC»')
  comprobar((await pagina.locator(`input[name="ordenes_compra"][value="${oc1.id}"]`).count()) === 0, 'sus OC ya no esperan factura')
  const enlaces = await consulta(
    `select count(*)::int as n from adquisiciones_ordenes_compra l join adquisiciones a on a.id = l.adquisicion_id
      where a.numero_documento = $1 and a.estado = 'REGISTRADA'`,
    [FA],
  )
  comprobar(enlaces[0].n === 2, 'la base guarda la factura registrada con dos OC')

  // Otra, a crédito, que no calza: entra igual.
  await pagina.locator(`input[name="ordenes_compra"][value="${oc3.id}"]`).check()
  comprobar((await pagina.locator('#adq-condicion').inputValue()) === 'CREDITO', 'la condición de pago sale de la OC')
  await pagina.locator('#adq-numero').fill(FB)
  await pagina.locator('#adq-total').fill('600')
  await pagina.locator('#adq-emision').fill(hoy)
  const vence = new Date(Date.parse(`${hoy}T12:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10)
  await pagina.locator('#adq-vencimiento').fill(vence)
  await pagina.locator('#adq-pdf').setInputFiles(join(ARCHIVOS, 'minimo.pdf'))
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText(`Comprobante ${FB} registrado`).waitFor({ timeout: 30000 }).catch(() => {})
  await pagina.locator('tbody tr', { hasText: FB }).first().waitFor({ timeout: 15000 }).catch(() => {})
  const fila2 = limpio(await grupo(pagina, FB))
  comprobar(fila2.includes('No calza con sus OC') && fila2.includes('sobran') && fila2.includes('10.00'),
    'la que no calza entra igual y dice cuánto sobra')
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-contabilidad.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 3. Tesorería
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await ir(pagina, `${BASE}/tesoreria/por-pagar`)
  const factura = pagina.locator('article', { hasText: FA })
  const texto = limpio(await factura.textContent())
  comprobar(texto.includes('contado') && texto.includes('Saldo S/ 1,298.00') && texto.includes(oc1.numero),
    'la factura al contado le llega con su saldo y sus OC')
  comprobar((await pagina.locator('article', { hasText: FB }).count()) === 1, 'la de crédito también')

  await factura.getByRole('button', { name: 'Registrar pago' }).click()
  let v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').fill('500')
  await v.locator('input[name="referencia"]').fill('OP-77001')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await elegirCuenta(v, CAJA)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  let error = await esperarVentana(pagina)
  comprobar(!error, `paga una parte con su voucher${error ? ` (dijo «${error}»)` : ''}`)
  await factura.getByText('Saldo S/ 798.00').waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(limpio(await factura.textContent()).includes('Saldo S/ 798.00'), 'el saldo baja a 798.00')
  const voucher = await factura.getByRole('link', { name: 'Voucher' }).first().getAttribute('href').catch(() => null)
  comprobar(Boolean(voucher) && (await fetch(voucher)).status === 200, 'el voucher se abre')

  await factura.getByRole('button', { name: 'Anular' }).first().click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('El importe era el de otra factura.')
  await v.getByRole('button', { name: 'Anular' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `anula el pago con su motivo${error ? ` (dijo «${error}»)` : ''}`)
  await factura.getByText('Anulado:').waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(limpio(await factura.textContent()).includes('Saldo S/ 1,298.00') && limpio(await factura.textContent()).includes('Anulado: El importe'),
    'anulado, vuelve a su saldo y el pago queda tachado con su motivo')

  await factura.getByRole('button', { name: 'Registrar pago' }).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="referencia"]').fill('OP-77001')
  await v.locator('input[name="archivo"]').setInputFiles(join(ARCHIVOS, 'voucher.pdf'))
  await elegirCuenta(v, CAJA)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `la paga entera con la misma operación${error ? ` (dijo «${error}»)` : ''}`)
  await factura.getByText('Pagada', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await factura.getByText('Pagada', { exact: true }).count()) === 1 && (await factura.getByRole('button', { name: 'Registrar pago' }).count()) === 0,
    'queda «Pagada» y sin botón de pagar')
  const pagadas = pagina.locator('details', { has: pagina.locator('summary', { hasText: /facturas pagadas/i }) })
  comprobar((await pagadas.locator('article', { hasText: FA }).count()) === 1, 'y pasa a «Facturas pagadas»')
  const pagos = await consulta(
    `select count(*) filter (where p.anulado_en is null)::int as vigentes, count(*)::int as todos,
            bool_and(p.archivo_ruta is not null) as con_voucher
       from pagos_adquisicion p join adquisiciones a on a.id = p.adquisicion_id where a.numero_documento = $1`,
    [FA],
  )
  comprobar(pagos[0].vigentes === 1 && pagos[0].todos === 2 && pagos[0].con_voucher, 'la base guarda los dos pagos con su voucher, uno anulado')
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-tesoreria.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------- 4. Logística, después
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  comprobar(limpio(await grupo(pagina, FA)).includes('Pagada'), 'Logística ve la factura pagada')
  await ir(pagina, `${BASE}/tesoreria/por-pagar`)
  comprobar((await pagina.getByRole('button', { name: 'Registrar pago' }).count()) === 0, 'Logística no paga facturas')
  await contexto.close()
}

// --------------------------------------------- 4b. La tabla y sus enlaces
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  const cabeza = (await pagina.locator('thead th').allTextContents()).map(limpio)
  console.log('     columnas:', cabeza.join(' · '))
  comprobar(cabeza.slice(0, 4).join('|') === 'RQ|OC|Factura|Fecha de factura', 'las columnas van RQ, OC, factura y su fecha')
  const primera = pagina.locator('tbody tr', { hasText: FA }).first()
  const celdas = (await primera.locator('td').allTextContents()).map(limpio)
  console.log(`     fila de ${FA}:`, celdas.join(' | '))
  comprobar(celdas[1].startsWith(oc1.numero) && celdas[2].startsWith(FA) && /^\d{2}\/\d{2}\/\d{4}/.test(celdas[3]),
    'la fila va OC, factura con su número y la fecha de la factura')
  comprobar((await primera.locator('td[rowspan="2"]').count()) >= 4, 'las celdas de la factura abarcan sus dos OC')

  const ocHref = await primera.getByRole('link', { name: oc1.numero }).getAttribute('href')
  const oc = await abrir(pagina, ocHref)
  comprobar(oc.estado === 200 && oc.tipo.includes('pdf'), `la OC abre su PDF (${oc.estado} ${oc.tipo})`)
  const facturaHref = await primera.getByRole('link', { name: FA }).getAttribute('href')
  const factura = await abrir(pagina, facturaHref)
  comprobar(factura.estado === 200, `la factura abre su PDF (${factura.estado})`)
  const voucherHref = await primera.getByRole('link', { name: 'Voucher' }).first().getAttribute('href').catch(() => null)
  comprobar(Boolean(voucherHref) && (await abrir(pagina, voucherHref)).estado === 200, 'el voucher del pago se abre')
  comprobar(!limpio(await primera.textContent()).includes('Anulado'), 'el pago anulado no sale en la tabla')

  // La pagada ya trae sus vouchers: solo la que falta pagar lleva a Cuentas por pagar.
  comprobar((await primera.getByRole('link', { name: 'Pagar en Cuentas por pagar' }).count()) === 0, 'la factura pagada no manda a pagarla')
  const aPagar = await pagina.locator('tbody tr', { hasText: FB }).first().getByRole('link', { name: 'Pagar en Cuentas por pagar' }).getAttribute('href')
  await ir(pagina, new URL(aPagar, BASE).toString())
  const destino = decodeURIComponent(new URL(pagina.url()).hash.slice(1))
  comprobar(destino.startsWith('factura-') && limpio(await pagina.locator(`[id="${destino}"]`).textContent().catch(() => '')).includes(FB),
    'Tesorería salta a pagar la que falta en Cuentas por pagar')

  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  await pagina.locator('tbody tr', { hasText: FA }).first().getByRole('link', { name: PROVEEDOR }).click()
  await pagina.getByText(`RUC ${RUC}`).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(limpio(await pagina.locator('main').textContent()).includes(RUC), 'el proveedor abre su ficha en Proveedores')

  {
    await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
    const texto = limpio(await grupo(pagina, FA))
    comprobar(texto.includes(rq1.numero) && texto.includes(rq2.numero), 'la factura muestra los dos RQ que cubre')
    const credito = pagina.locator('tbody tr', { hasText: FB }).first()
    comprobar(limpio(await credito.locator('td').first().textContent()) === rq2.numero, 'la OC a crédito muestra su RQ')
    await pagina.locator('tbody tr', { hasText: FA }).first().getByRole('link', { name: rq1.numero }).click()
    await pagina.getByText(`Solo el ${rq1.numero}`).waitFor({ timeout: 15000 }).catch(() => {})
    // Cada RQ es una tarjeta: el del otro RQ de la factura no tiene que salir.
    const rq = limpio(await pagina.locator('main').textContent())
    comprobar(rq.includes(`Solo el ${rq1.numero}`) && !rq.includes(rq2.numero), 'el RQ abre solo ese RQ')
  }
  {
    // Las OC sembradas ya tienen su factura: las que esperan son las que dejó el resto del banco, si quedó alguna.
    await como('tesoreria')
    // Las OC de antes de la serie no tienen número: la tabla las nombra «OC sin número», con su referencia aparte.
    const esperan = (await consulta(`select numero, referencia from public.compras_sin_factura()`)).map(
      (o) => o.numero ?? `Ref. del proveedor: ${o.referencia}`,
    )
    await ir(pagina, `${BASE}/adquisiciones?vista=sin-factura`)
    // Con varias OC esperando, la vista tiene una tabla por grupo: se leen las que se ven.
    const sinFactura = limpio((await pagina.locator('table:visible').allTextContents()).join(' '))
    comprobar(
      !sinFactura.includes(FA) && !sinFactura.includes(FB) &&
        (esperan.length > 0
          ? sinFactura.includes('OC que esperan su factura') && esperan.every((n) => sinFactura.includes(n))
          : sinFactura.includes('Ninguna OC espera su factura')),
      `«Esperan su factura» deja solo las OC que esperan su factura (${esperan.length} en el banco)`,
    )
  }
  await ir(pagina, `${BASE}/adquisiciones?vista=no-calzan`)
  // La vista tiene más de una tabla (las de cada grupo, y las escondidas que
  // esperan su turno): se leen las que se ven.
  const noCalzan = limpio((await pagina.locator('table:visible').allTextContents()).join(' '))
  comprobar(noCalzan.includes(FB) && !noCalzan.includes(FA), '«No calzan» deja solo la que no calza')
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-tabla-tesoreria.png'), fullPage: true })
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  const primera = pagina.locator('tbody tr', { hasText: FA }).first()
  comprobar((await pagina.getByRole('link', { name: 'Pagar en Cuentas por pagar' }).count()) === 0, 'Logística no tiene el enlace a Cuentas por pagar')
  const oc = await abrir(pagina, await primera.getByRole('link', { name: oc1.numero }).getAttribute('href'))
  comprobar(oc.estado === 200 && oc.tipo.includes('pdf'), 'Logística abre el PDF de la OC')
  comprobar((await primera.getByRole('link', { name: rq1.numero }).count()) === 1, 'y el RQ')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  const ancho = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  comprobar(ancho[0] <= ancho[1], `en el teléfono la página no se ensancha (${ancho[0]} de ${ancho[1]} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-tabla-telefono.png'), fullPage: true })
  await contexto.close()
}
if (ids[CUENTAS.ventas]) {
  const { pagina, contexto } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  comprobar(pagina.url().includes('/sin-permiso'), 'Ventas no entra a Adquisiciones')
  await contexto.close()
}

// ------------------------------------------- 5. La detracción en Pagos de servicio
if ((await consulta(`select 1 from ordenes_servicio where referencia in ('QA-OS-1', 'QA-OS-2')`)).length === 2) {
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await ir(pagina, `${BASE}/tesoreria/pagos-de-servicio`)
  const afecta = limpio(await pagina.locator('article', { hasText: 'Arenado y pintado' }).textContent().catch(() => ''))
  comprobar(afecta.includes('Detracción 12 %: S/ 283.00') && afecta.includes('Banco de la Nación') && afecta.includes('código PLANTA'),
    'Tesorería ve la detracción de la OS: 12 % de 2 360.00 con IGV, al Banco de la Nación')
  const noSujeta = limpio(await pagina.locator('article', { hasText: 'Torneado de pines' }).textContent().catch(() => ''))
  comprobar(noSujeta.includes('No sujeta a detracción') && !noSujeta.includes('Banco de la Nación'), 'y la que no está sujeta lo dice')
  await pagina.screenshot({ path: join(CAPTURAS, 'pagos-de-servicio-tesoreria.png'), fullPage: true })
  await contexto.close()
} else {
  console.log('· sin las OS QA-OS-1 y QA-OS-2: no se mira la detracción en Pagos de servicio')
}

await navegador.close()
await base.end()
if (errores.length) console.log('\nErrores de consola:\n  ' + errores.join('\n  '))
console.log(`\n${fallas.length === 0 ? 'Todo bien' : `${fallas.length} fallas`} · capturas en ${CAPTURAS}`)
process.exit(fallas.length === 0 && errores.length === 0 ? 0 : 1)

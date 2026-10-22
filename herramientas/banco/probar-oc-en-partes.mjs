/**
 * Clic real sobre la OC que llega en partes, unas con boleta y otras con
 * factura (migración 20261022200000). Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Logística abre «Adjuntar» en la OC A (con factura), elige «Boleta, nota
 *      de venta o recibo», marca que es de solo una parte y la anexa con su
 *      número, su fecha y su monto: tres toques dejan una boleta, con su PDF en
 *      storage.objects. Una segunda que no deja nada para la factura se
 *      rechaza en la ventana, sin fila nueva.
 *   2. Tesorería la ve en «Boletas de una parte», con la OC, el monto y el
 *      saldo, y el encabezado suma ese saldo al «Por pagar». La paga en dos
 *      veces desde su cuenta: tres toques dejan un pago, la caja se mueve con
 *      `PAGO_PARTE_BOLETA` y la tarjeta dice «Pagada en parte»; pagada entera,
 *      pasa a las pagadas. Anula un pago con su motivo y la caja anula su
 *      egreso. Gerencia ve la tarjeta sin los botones de Tesorería.
 *   3. Adquisiciones muestra la boleta en los documentos de la OC, con su monto
 *      y lo pagado.
 *   4. La OC B, con boleta, que llegó en partes: anexada la boleta de una parte,
 *      sale de «OC con boleta por pagar» y su boleta, en «Boletas de una parte».
 *   5. En un teléfono de 390 px, «Cuentas por pagar» no se sale de la pantalla.
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_ARCHIVOS y el correo de cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'tesoreria', 'gerencia', 'requerimientos', 'almacen'].map((p) => [p, cuenta(p)]))
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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}
/** Abre el desplegable cuando React ya hidrató la página (ver `probar-anexos-de-la-oc-con-boleta.mjs`). */
async function abrirPlegada(plegada) {
  if (!(await plegada.count())) return
  const d = plegada.first()
  await d.evaluate((el) => new Promise((listo) => {
    const mira = () => (Object.keys(el).some((k) => k.startsWith('__react')) ? listo() : setTimeout(mira, 50))
    mira()
  }))
  if (!(await d.evaluate((el) => el.open))) await d.locator('summary').click()
}
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)
const cifra = (n) => new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `PROVEEDOR EN PARTES ${SUFIJO}`
const BA = `B081-${SUFIJO}`
const BB = `B082-${SUFIJO}`
const CAJA = `Banco en partes ${SUFIJO}`
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

async function como(puesto) {
  const sub = puesto ? ids[CUENTAS[puesto]] : ''
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, puesto ? JSON.stringify({ sub, role: 'authenticated' }) : ''])
}
let ruc
while (!ruc) {
  const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  ;[ruc] = await consulta(
    `select n from (select $1 || d as n from generate_series(0, 9) d) x
      where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
    [prefijo],
  )
}
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 429, Lima', '999 429 429') returning id`,
  [ruc.n, PROVEEDOR],
)
const CUENTA_PROVEEDOR = `1910${SUFIJO}0429`
await consulta(`insert into proveedor_cuentas (proveedor_id, banco, numero_cuenta, titular, moneda) values ($1, 'BCP', $2, $3, 'PEN')`, [
  proveedor,
  CUENTA_PROVEEDOR,
  PROVEEDOR,
])
const [{ id: caja }] = await consulta(
  `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
   values ($1, 'BANCO', 'BANCO DE PRUEBA', 'PEN', 10000, $2::date - 30, $3) returning id`,
  [CAJA, hoy, ids[CUENTAS.tesoreria]],
)
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`PARTES-${SUFIJO}`, `Plancha LAF 3 mm 4x8 (${SUFIJO})`, cat, und],
)
const [{ id: rq }] = await consulta(`select gen_random_uuid() as id`)
await como('requerimientos')
await consulta(
  `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/29', $3, null,
     (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3, 'unidad_medida_id', $4::text, 'categoria_id', $5::text))
        from generate_series(1, 2) n))`,
  [rq, area, `Prueba de la OC que llega en partes ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
// A va con factura (S/ 354 con IGV); B, con boleta (S/ 300).
await como('logistica')
const oc = {}
for (const [clave, item, conFactura] of [['A', 1, true], ['B', 2, false]]) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
       jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 3, 'precio', 100)), null, 'CONTADO', 0, 'PEN', $5) as id`,
    [rq, item, proveedor, material, conFactura],
  )
  oc[clave] = id
}
await como('gerencia')
for (const id of Object.values(oc)) {
  const [{ aprobacion }] = await consulta(`select aprobacion from ordenes_compra_materiales where id = $1`, [id])
  if (aprobacion === 'POR_APROBAR') await consulta(`select public.aprobar_compra($1)`, [id])
}
await como(null)
const numeros = Object.fromEntries((await consulta(`select id, numero from ordenes_compra_materiales where id = any($1)`, [Object.values(oc)])).map((f) => [f.id, f.numero]))
const nombre = (id) => numeros[id] ?? 'OC sin número'
console.log(`Sembrado ${SUFIJO}: ${nombre(oc.A)} con factura y ${nombre(oc.B)} con boleta, de ${PROVEEDOR}`)

const objeto = async (bucket, ruta) => (await consulta(`select count(*)::int as n from storage.objects where bucket_id = $1 and name = $2`, [bucket, ruta]))[0].n
const partes = async (orden) =>
  consulta(`select id, numero_documento, monto_de_la_parte::float as monto, fecha_emision::text as fecha, ruta_storage, subido_por
              from documentos_compra_material where orden_compra_id = $1 and monto_de_la_parte is not null`, [orden])
const pagosDe = async (documento) =>
  consulta(`select id, monto::float as monto, anulado_en from pagos_parte_con_boleta where documento_compra_id = $1 order by creado_en`, [documento])

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(puesto, viewport = { width: 1280, height: 900 }) {
  const correo = CUENTAS[puesto]
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${puesto}: ${m.text().slice(0, 300)}`)
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
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([
    v.waitFor({ state: 'hidden', timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  await pagina.waitForLoadState('networkidle')
  return error
}
async function tresToques(boton) {
  await boton.click()
  await boton.click({ timeout: 1000 }).catch(() => {})
  await boton.click({ timeout: 1000 }).catch(() => {})
}

/** Logística abre «Adjuntar» en la fila de la OC y anexa la boleta de una parte; devuelve el mensaje o el error de la ventana. */
async function anexarParte(pagina, orden, numero, monto, toques = 1) {
  await pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  await pagina.locator(`tr[data-compra="${nombre(orden)}"]`).getByRole('button', { name: 'Adjuntar', exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('select[name="tipo"]').selectOption('COMPROBANTE')
  await v.locator('input[name="parte"]').check()
  await v.locator('input[name="parte_numero"]').fill(numero)
  await v.locator('input[name="parte_fecha"]').fill(hoy)
  await v.locator('input[name="parte_monto"]').fill(monto)
  await v.locator('input[name="archivo"]').setInputFiles({ name: `boleta-${numero}.pdf`, mimeType: 'application/pdf', buffer: PDF })
  const boton = v.getByRole('button', { name: 'Adjuntar', exact: true })
  if (toques === 3) await tresToques(boton)
  else await boton.click()
  await Promise.race([
    v.locator('[role="status"]').waitFor({ timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  return {
    mensaje: limpio(await v.locator('[role="status"]').textContent({ timeout: 500 }).catch(() => '')),
    error: limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => '')),
  }
}

// ---------------------------------------------------------------- 1. Logística anexa la boleta de una parte
let parteA
{
  const { pagina, contexto } = await entrar('logistica')
  const r = await anexarParte(pagina, oc.A, BA.toLowerCase(), '118', 3)
  comprobar(!r.error && r.mensaje.includes(`Boleta ${BA} adjuntada por S/ ${cifra(118)}`) && r.mensaje.includes('Boletas de una parte'),
    `Logística anexa la boleta de una parte: «${r.mensaje || r.error}»`)
  const filas = await hasta(() => partes(oc.A), (f) => f.length > 0)
  parteA = filas[0]
  comprobar(filas.length === 1 && parteA.numero_documento === BA && parteA.monto === 118 && parteA.fecha === hoy && parteA.subido_por === ids[CUENTAS.logistica],
    `tres toques dejan una boleta, con su número en mayúsculas, su monto y su fecha (${filas.length})`)
  comprobar((await objeto('documentos-compras', parteA?.ruta_storage)) === 1, 'su PDF está en storage.objects')
  await pagina.screenshot({ path: `${CAPTURAS}/partes-1-logistica.png`, fullPage: true })
  const otra = await anexarParte(pagina, oc.A, `B081-${SUFIJO}7`, '300')
  comprobar(otra.error.includes('tiene que quedar algo para la factura') && (await partes(oc.A)).length === 1,
    `la que no deja nada para la factura se rechaza, sin fila nueva: «${otra.error}»`)
  await contexto.close()
}
const [aviso] = await consulta(`select titulo from notificaciones where usuario_id = $1 and origen_id = $2`, [ids[CUENTAS.tesoreria], parteA?.id])
comprobar(Boolean(aviso?.titulo?.startsWith('Boleta de una parte por pagar')), `a Tesorería le llega el aviso: «${aviso?.titulo ?? ''}»`)

// ---------------------------------------------------------------- 2. Tesorería la paga
async function pagar(pagina, monto, toques = 1) {
  const tarjeta = pagina.locator(`article#parte-${parteA.id}`)
  await tarjeta.locator('[data-pagar-parte]').click()
  const v = pagina.locator('[role="dialog"]')
  if (monto !== null) await v.locator('input[name="monto"]').fill(monto)
  await v.locator('input[name="operacion"]').fill(`OP-${SUFIJO}`)
  await v.locator('select[name="caja_id"]').selectOption(await v.locator('select[name="caja_id"] option', { hasText: CAJA }).getAttribute('value'))
  await v.locator('input[name="archivo"]').setInputFiles({ name: 'voucher.pdf', mimeType: 'application/pdf', buffer: PDF })
  const ventana = limpio(await v.innerText())
  const boton = v.getByRole('button', { name: 'Registrar el pago', exact: true })
  if (toques === 3) await tresToques(boton)
  else await boton.click()
  return { ventana, error: await esperarVentana(pagina) }
}
{
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`article#parte-${parteA.id}`)
  const texto = limpio(await tarjeta.innerText().catch(() => ''))
  console.log(`       la boleta: ${texto.slice(0, 400)}`)
  comprobar(texto.includes(`Boleta ${BA}`) && texto.includes(nombre(oc.A)) && texto.includes(`Saldo S/ ${cifra(118)}`) && texto.includes(`OC S/ ${cifra(354)}`),
    'Tesorería la ve en «Boletas de una parte», con la OC, la boleta y su saldo')
  comprobar(texto.includes(CUENTA_PROVEEDOR), 'con la cuenta del proveedor')
  const encabezado = limpio(await pagina.locator('main').first().innerText()).slice(0, 400)
  comprobar(/Por pagar: S\/ [\d,.]+/.test(encabezado), `el encabezado suma lo que se debe: ${encabezado.match(/Por pagar:[^·.]*/)?.[0] ?? encabezado.slice(0, 120)}`)

  const primero = await pagar(pagina, '50', 3)
  comprobar(primero.ventana.includes(`Le quedan S/ ${cifra(118)}`) && primero.ventana.includes('lo demás de la OC se paga por su factura'),
    'la ventana dice cuánto le queda y que lo demás va por la factura')
  comprobar(!primero.error, `registra el primer pago${primero.error ? ` (dijo «${primero.error}»)` : ''}`)
  const p1 = await hasta(() => pagosDe(parteA.id), (f) => f.length > 0)
  comprobar(p1.length === 1 && p1[0].monto === 50, `tres toques dejan un pago de S/ 50 (${p1.length})`)
  const mov = await consulta(`select tipo, monto::float as monto, caja_id from movimientos_caja where origen = 'PAGO_PARTE_BOLETA' and origen_id = $1`, [p1[0]?.id])
  comprobar(mov.length === 1 && mov[0].tipo === 'EGRESO' && mov[0].monto === 50 && mov[0].caja_id === caja, 'el pago sale de la cuenta elegida')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const texto2 = limpio(await tarjeta.innerText().catch(() => ''))
  comprobar(texto2.includes('Pagada en parte') && texto2.includes(`Saldo S/ ${cifra(68)}`) && texto2.includes(`Pago del`) && texto2.includes('Voucher'),
    `la tarjeta dice «Pagada en parte», el saldo y el pago con su voucher: «${texto2.slice(0, 300)}»`)

  const segundo = await pagar(pagina, null)
  comprobar(!segundo.error, `paga el resto con el monto que propone${segundo.error ? ` (dijo «${segundo.error}»)` : ''}`)
  const p2 = await hasta(() => pagosDe(parteA.id), (f) => f.length > 1)
  comprobar(p2.length === 2 && p2[1].monto === 68, 'el segundo pago es de S/ 68')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const plegada = pagina.locator('details', { hasText: 'Boletas de una parte pagadas' })
  await abrirPlegada(plegada)
  const texto3 = limpio(await tarjeta.innerText().catch(() => ''))
  comprobar(texto3.includes('Pagada') && (await tarjeta.locator('[data-pagar-parte]').count()) === 0, `pagada, va a las pagadas y sin «Registrar pago»: «${texto3.slice(0, 200)}»`)
  await pagina.screenshot({ path: `${CAPTURAS}/partes-2-tesoreria.png`, fullPage: true })

  await tarjeta.locator(`[data-anular-pago-parte="${p2[1].id}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('El banco rechazó la transferencia')
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  const errorAnular = await esperarVentana(pagina)
  comprobar(!errorAnular, `anula el segundo pago con su motivo${errorAnular ? ` (dijo «${errorAnular}»)` : ''}`)
  const anulado = await hasta(() => pagosDe(parteA.id), (f) => Boolean(f[1]?.anulado_en))
  const [movAnulado] = await consulta(`select anulado_en from movimientos_caja where origen = 'PAGO_PARTE_BOLETA' and origen_id = $1`, [p2[1].id])
  comprobar(Boolean(anulado[1]?.anulado_en) && Boolean(movAnulado?.anulado_en), 'el pago queda anulado y la caja anula su egreso')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar(limpio(await tarjeta.innerText().catch(() => '')).includes(`Saldo S/ ${cifra(68)}`), 'la boleta vuelve a deber S/ 68')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`article#parte-${parteA.id}`)
  comprobar((await tarjeta.count()) === 1 && (await tarjeta.locator('[data-pagar-parte], [data-anular-pago-parte]').count()) === 0,
    'Gerencia ve la boleta sin los botones de Tesorería')
  await contexto.close()
}

// ---------------------------------------------------------------- 3. Adquisiciones
{
  const { pagina, contexto } = await entrar('logistica')
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(nombre(oc.A))}`, { waitUntil: 'networkidle' })
  const fila = limpio(await pagina.locator(`tr[data-orden="${nombre(oc.A)}"]`).innerText().catch(() => ''))
  console.log(`       la fila de la A: ${fila.slice(0, 400)}`)
  comprobar(fila.includes(BA) && fila.includes(`una parte, S/ ${cifra(118)}`) && fila.includes(`pagado S/ ${cifra(50)}`),
    'Adquisiciones muestra la boleta con su monto y lo pagado')
  comprobar(fila.includes(`Falta facturar S/ ${cifra(236)}`) || !fila.includes('Falta facturar S/ 354'), 'y no pide facturar lo que ya cubrió la boleta')
  await contexto.close()
}

// ---------------------------------------------------------------- 4. La OC con boleta que llega en partes
{
  const { pagina, contexto } = await entrar('logistica')
  const r = await anexarParte(pagina, oc.B, BB, '100')
  comprobar(!r.error, `Logística anexa la boleta de una parte a la OC con boleta${r.error ? ` (dijo «${r.error}»)` : ''}`)
  await contexto.close()
  const [parteB] = await hasta(() => partes(oc.B), (f) => f.length > 0)
  const t = await entrar('tesoreria')
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await t.pagina.locator(`article#compra-${oc.B}`).count()) === 0 && (await t.pagina.locator(`article#parte-${parteB?.id}`).count()) === 1,
    'sale de «OC con boleta por pagar» y su boleta está en «Boletas de una parte»')
  await t.contexto.close()
}

// ---------------------------------------------------------------- 5. En el teléfono
{
  const { pagina, contexto } = await entrar('tesoreria', { width: 390, height: 844 })
  await pagina.goto(`${BASE}/tesoreria/por-pagar#partes-con-boleta`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en 390 px la página no se sale de la pantalla (${ancho})`)
  await pagina.screenshot({ path: `${CAPTURAS}/partes-5-telefono.png`, fullPage: true })
  await contexto.close()
}

await navegador.close()
await base.end()
for (const e of errores) console.log(`consola · ${e}`)
comprobar(errores.length === 0, `sin errores en la consola (${errores.length})`)
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)

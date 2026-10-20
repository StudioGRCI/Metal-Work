/**
 * Clic real sobre lo que pidió DKS el 20/10 (migración 20261020210000): que
 * Tesorería, al pagar, vea la OC, su factura o su boleta y la cuenta del
 * proveedor, y que la OS guarde su factura. Con la cuenta de cada puesto, nunca
 * ADMIN:
 *
 *   1. Tesorería ve la OC con boleta en Cuentas por pagar, con el PDF de la OC,
 *      la boleta que adjuntó Logística y la cuenta del proveedor, y no ve ahí
 *      la OC con factura. La paga desde la ventana, que muestra lo mismo: tres
 *      toques dejan un pago, un egreso en la caja y el voucher en
 *      storage.objects. Adquisiciones la da por pagada.
 *   2. El PDF de la OC lo descarga Tesorería (200, application/pdf).
 *   3. Tesorería anula el pago con su motivo: la OC vuelve a estar por pagar y
 *      el egreso queda anulado.
 *   4. Logística adjunta a la OS su factura (tres toques, un documento, con el
 *      número en mayúsculas) y su contrato, y el archivo queda en
 *      storage.objects.
 *   5. Tesorería los ve en Pagos de servicio junto a la cuenta del proveedor,
 *      en la tarjeta y en la ventana de pago, y ya no le pide la factura.
 *   6. Gerencia ve la OC con boleta sin el botón de pagar.
 *   7. En el teléfono, Cuentas por pagar no se ensancha.
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_ARCHIVOS y el correo de cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
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
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)
const archivos = join(CAPTURAS, 'archivos-boleta-y-os')
mkdirSync(archivos, { recursive: true })
writeFileSync(join(archivos, 'voucher.pdf'), PDF)
writeFileSync(join(archivos, 'factura-os.pdf'), PDF)
writeFileSync(join(archivos, 'contrato-os.pdf'), PDF)

// ---------------------------------------------------------------- siembra
const SUFIJO = Date.now().toString().slice(-6)
const PROVEEDOR = `PROVEEDOR BOLETA ${SUFIJO}`
const CUENTA_PROVEEDOR = `1910${SUFIJO}0077`
const CAJA = `Banco boleta ${SUFIJO}`
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

/** Lo que hace la sesión de esa cuenta: los disparadores y las funciones leen el usuario de aquí. */
async function como(puesto) {
  const sub = puesto ? ids[CUENTAS[puesto]] : ''
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, puesto ? JSON.stringify({ sub, role: 'authenticated' }) : ''])
}
/** Un PDF subido por esa cuenta, en el disco del banco y en storage.objects, como lo deja Storage. */
async function subir(bucket, ruta, puesto) {
  const destino = join(ARCHIVOS, bucket, ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, PDF)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ($1, $2, $3::uuid, $3::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $4::bigint)) on conflict do nothing`,
    [bucket, ruta, ids[CUENTAS[puesto]], PDF.length],
  )
  return ruta
}
const objeto = async (bucket, ruta) => (await consulta(`select count(*)::int as n from storage.objects where bucket_id = $1 and name = $2`, [bucket, ruta ?? '']))[0].n

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
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 421, Lima', '999 421 421') returning id`,
  [ruc.n, PROVEEDOR],
)
await consulta(
  `insert into proveedor_cuentas (proveedor_id, banco, numero_cuenta, titular, moneda) values ($1, 'BCP', $2, $3, 'PEN')`,
  [proveedor, CUENTA_PROVEEDOR, PROVEEDOR],
)
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
  [`BOLETA-${SUFIJO}`, `Plancha LAF 2 mm 4x8 (${SUFIJO})`, cat, und],
)
const [{ id: rq }] = await consulta(`select gen_random_uuid() as id`)
await como('requerimientos')
await consulta(
  `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/21', $3, null,
     (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3, 'unidad_medida_id', $4::text, 'categoria_id', $5::text))
        from generate_series(1, 2) n))`,
  [rq, area, `Prueba de la OC con boleta ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
// La 1 va con boleta y la 2 con factura: la de factura no entra en la lista de boletas.
await como('logistica')
const oc = []
for (const n of [1, 2]) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
       jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 3, 'precio', 120.50)), null, 'CONTADO', 0, 'PEN', $5) as id`,
    [rq, n, proveedor, material, n === 2],
  )
  oc.push(id)
}
// Logística adjunta la boleta que entregó el proveedor.
const [{ id: boleta }] = await consulta(`select gen_random_uuid() as id`)
await subir('documentos-compras', `compra/${oc[0]}/${boleta}.pdf`, 'logistica')
await consulta(
  `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento)
   values ($1, $2, 'COMPROBANTE', 'boleta.pdf', $3, 'application/pdf', $4, $5, $6)`,
  [boleta, oc[0], `compra/${oc[0]}/${boleta}.pdf`, PDF.length, ids[CUENTAS.logistica], `B001-${SUFIJO}`],
)
await como('gerencia')
for (const id of oc) await consulta(`select public.aprobar_compra($1)`, [id])
const [{ id: os }] = await consulta(
  `insert into ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno, aprobacion, aprobado_por, aprobado_en, creado_por)
   values ($1, $2, $3, $4, 500, 'PEN', 'PLA_SR_O4_1_26/21', 'APROBADA', $5, now(), $6) returning id`,
  [`QA-OS-${SUFIJO}`, proveedor, PROVEEDOR, `Servicio de prueba (${SUFIJO})`, ids[CUENTAS.gerencia], ids[CUENTAS.logistica]],
)
await como(null)

const numeros = Object.fromEntries((await consulta(`select id, numero from ordenes_compra_materiales where id = any($1)`, [oc])).map((f) => [f.id, f.numero]))
const nombre = (id) => numeros[id] ?? 'OC sin número'
const NUMERO_OS = `QA-OS-${SUFIJO}`
const [{ total }] = await consulta(`select public.total_orden_compra($1)::float as total`, [oc[0]])
console.log(`Sembrado ${SUFIJO}: ${nombre(oc[0])} con boleta (S/ ${total}), ${nombre(oc[1])} con factura y ${NUMERO_OS}`)

/** Lo que Adquisiciones dice del pago de esa orden, leído con la sesión de Tesorería. */
async function pagoSegunAdquisiciones(id) {
  await base.query('begin')
  try {
    const sub = ids[CUENTAS.tesoreria]
    await consulta(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
    await consulta('set local role authenticated')
    return (await consulta(`select pago from public.trazabilidad_de_compras() where id = $1`, [id]))[0]?.pago
  } finally {
    await base.query('rollback')
  }
}

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, viewport = { width: 1280, height: 900 }) {
  const correo = CUENTAS[puesto]
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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

/** Espera a que la ventana abierta se cierre (la acción salió bien) o muestre su error. */
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

let pagoId
// ---------------------------------------------------------------- 1–3. Tesorería paga la OC con boleta
{
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('#compras-con-boleta')
  const fila = pagina.locator(`article#compra-${oc[0]}`)
  comprobar((await fila.count()) === 1, `la ${nombre(oc[0])} con boleta está en «OC con boleta por pagar»`)
  comprobar(!limpio(await tarjeta.innerText()).includes(nombre(oc[1])), `la ${nombre(oc[1])}, que va con factura, no está ahí`)
  const enFila = fila.locator('[data-para-pagar]')
  const textoFila = limpio(await enFila.innerText().catch(() => ''))
  console.log(`       la fila: ${textoFila}`)
  const enlaceOc = enFila.getByRole('link', { name: `PDF de la ${nombre(oc[0])}` })
  comprobar((await enlaceOc.count()) === 1 && (await enlaceOc.getAttribute('download')) !== null, 'muestra el PDF de la OC, como descarga')
  comprobar((await enFila.getByRole('link', { name: `Boleta B001-${SUFIJO}` }).count()) === 1, 'y la boleta que adjuntó Logística')
  comprobar(textoFila.includes(CUENTA_PROVEEDOR) && textoFila.includes('BCP'), 'y la cuenta del proveedor para transferir')
  await pagina.screenshot({ path: join(CAPTURAS, 'boleta-por-pagar.png'), fullPage: true })

  // 2. El PDF de la OC sale para Tesorería.
  const pdf = await pagina.request.get(`${BASE}/compras/${oc[0]}/pdf`)
  comprobar(pdf.status() === 200 && (pdf.headers()['content-type'] ?? '').includes('application/pdf'), `Tesorería descarga el PDF de la OC (${pdf.status()})`)

  await fila.locator(`[data-pagar-compra="${nombre(oc[0])}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  const enVentana = limpio(await v.locator('[data-para-pagar]').innerText().catch(() => ''))
  comprobar(enVentana.includes(`PDF de la ${nombre(oc[0])}`) && enVentana.includes(`Boleta B001-${SUFIJO}`) && enVentana.includes(CUENTA_PROVEEDOR),
    'la ventana de pago muestra la OC, la boleta y la cuenta')
  comprobar(Number(await v.locator('input[name="monto"]').inputValue()) === total, `propone el saldo: S/ ${total}`)
  await v.locator('input[name="operacion"]').fill(`OP-${SUFIJO}`)
  await v.locator('input[name="comprobante"]').fill(`b001-${SUFIJO}`)
  const valor = await v.locator('select[name="caja_id"] option', { hasText: CAJA }).getAttribute('value')
  await v.locator('select[name="caja_id"]').selectOption(valor)
  await v.locator('input[name="archivo"]').setInputFiles(join(archivos, 'voucher.pdf'))
  await tresToques(v.getByRole('button', { name: 'Registrar el pago' }))
  const error = await esperarVentana(pagina)
  comprobar(!error, `registra el pago${error ? ` (dijo «${error}»)` : ''}`)
  const pagos = await hasta(
    () => consulta(`select id, monto::float as monto, cancela, comprobante_proveedor, archivo_ruta from pagos_orden_compra where orden_compra_id = $1`, [oc[0]]),
    (r) => r.length > 0,
  )
  pagoId = pagos[0]?.id
  comprobar(pagos.length === 1, `tres toques dejan un pago (${pagos.length})`)
  comprobar(pagos[0]?.monto === total && pagos[0]?.cancela && pagos[0]?.comprobante_proveedor === `B001-${SUFIJO}`,
    'por el total, cancela la OC y con la boleta en mayúsculas')
  comprobar((await objeto('pagos-compras', pagos[0]?.archivo_ruta)) === 1, 'el voucher está en storage.objects')
  const egresos = await consulta(`select tipo, monto::float as monto, caja_id from movimientos_caja where origen = 'PAGO_ORDEN_COMPRA' and origen_id = $1`, [pagoId])
  comprobar(egresos.length === 1 && egresos[0].tipo === 'EGRESO' && egresos[0].monto === total && egresos[0].caja_id === caja,
    'y un egreso por el total en la cuenta elegida')
  comprobar((await pagoSegunAdquisiciones(oc[0])) === 'PAGADA', 'Adquisiciones la da por pagada')

  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const pagada = pagina.locator(`article#compra-${oc[0]}`)
  // Va al desplegable «OC con boleta pagadas», que está cerrado: innerText no lee lo que no se ve.
  comprobar(limpio(await pagada.textContent().catch(() => '')).includes('Pagada'), 'la OC sale como pagada')
  comprobar((await pagada.locator('[data-pagar-compra]').count()) === 0, 'sin el botón de pagar')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const enAdq = limpio(await pagina.locator(`tbody tr[data-orden="${nombre(oc[0])}"]`).innerText().catch(() => ''))
  comprobar(enAdq.includes('Pagada'), `en Adquisiciones también: «${enAdq.slice(0, 160)}»`)

  // 3. Anular el pago.
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const detalles = pagina.locator('details', { has: pagina.locator(`article#compra-${oc[0]}`) })
  if ((await detalles.count()) > 0 && !(await detalles.first().evaluate((d) => d.open))) await detalles.first().locator('summary').click()
  await pagina.locator(`[data-anular-pago-compra="${pagoId}"]`).click()
  await v.locator('textarea[name="motivo"]').fill('Se registró con el voucher de otra compra')
  await v.getByRole('button', { name: 'Anular' }).click()
  const errorAnular = await esperarVentana(pagina)
  comprobar(!errorAnular, `anula el pago${errorAnular ? ` (dijo «${errorAnular}»)` : ''}`)
  const [anulado] = await hasta(() => consulta(`select anulado_en from pagos_orden_compra where id = $1`, [pagoId]), (r) => r[0]?.anulado_en)
  const [egreso] = await consulta(`select anulado_en from movimientos_caja where origen = 'PAGO_ORDEN_COMPRA' and origen_id = $1`, [pagoId])
  comprobar(Boolean(anulado?.anulado_en) && Boolean(egreso?.anulado_en), 'el pago queda anulado y su egreso también')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`article#compra-${oc[0]} [data-pagar-compra]`).count()) === 1, 'la OC vuelve a pedir su pago')
  comprobar((await pagoSegunAdquisiciones(oc[0])) === 'POR_PAGAR', 'y Adquisiciones la vuelve a dar por pagar')
  await contexto.close()
}

// ---------------------------------------------------------------- 4. Logística adjunta la factura y el contrato de la OS
{
  const { pagina, contexto } = await entrar('logistica')
  await pagina.goto(`${BASE}/compras/servicios`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`tr[data-servicio="${NUMERO_OS}"]`)
  comprobar((await fila.count()) === 1, `Logística ve la ${NUMERO_OS} en Órdenes de servicio`)
  const v = pagina.locator('[role="dialog"]')
  await fila.locator(`[data-adjuntar-documento-servicio="${NUMERO_OS}"]`).click()
  await v.waitFor()
  comprobar((await v.locator('select[name="tipo"]').inputValue()) === 'FACTURA', 'la ventana abre con «Factura»')
  await v.locator('input[name="numero"]').fill(` e001-${SUFIJO} `)
  await v.locator('input[name="archivo"]').setInputFiles(join(archivos, 'factura-os.pdf'))
  await tresToques(v.getByRole('button', { name: 'Adjuntar', exact: true }))
  let error = await esperarVentana(pagina)
  comprobar(!error, `adjunta la factura${error ? ` (dijo «${error}»)` : ''}`)
  const facturas = await hasta(
    () => consulta(`select tipo, numero, ruta_storage, subido_por from documentos_orden_servicio where orden_servicio_id = $1 and tipo = 'FACTURA'`, [os]),
    (r) => r.length > 0,
  )
  comprobar(facturas.length === 1, `tres toques dejan una factura (${facturas.length})`)
  comprobar(facturas[0]?.numero === `E001-${SUFIJO}` && facturas[0]?.subido_por === ids[CUENTAS.logistica], 'con su número en mayúsculas y quién la subió')
  comprobar((await objeto('documentos-servicio', facturas[0]?.ruta_storage)) === 1, 'el archivo está en storage.objects')

  await fila.locator(`[data-adjuntar-documento-servicio="${NUMERO_OS}"]`).click()
  await v.waitFor()
  await v.locator('select[name="tipo"]').selectOption('CONTRATO')
  comprobar((await v.locator('input[name="numero"]').count()) === 0, 'el contrato no pide número')
  await v.locator('input[name="archivo"]').setInputFiles(join(archivos, 'contrato-os.pdf'))
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `adjunta el contrato${error ? ` (dijo «${error}»)` : ''}`)
  const tiene = (t) => t.includes(`Factura E001-${SUFIJO}`) && t.includes('Contrato')
  const textoFila = await hasta(async () => limpio(await fila.innerText()), tiene)
  comprobar(tiene(textoFila), `la fila muestra los dos documentos${tiene(textoFila) ? '' : `: «${textoFila.slice(0, 200)}»`}`)
  comprobar((await consulta(`select count(*)::int as n from documentos_orden_servicio where orden_servicio_id = $1 and tipo = 'CONTRATO'`, [os]))[0].n === 1,
    'el contrato queda en la base')
  await pagina.screenshot({ path: join(CAPTURAS, 'os-documentos.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 5. Tesorería los ve al pagar la OS
{
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('article', { hasText: NUMERO_OS })
  const texto = limpio(await tarjeta.locator('[data-para-pagar]').innerText().catch(() => ''))
  console.log(`       la OS: ${texto}`)
  comprobar(texto.includes(`Factura E001-${SUFIJO}`) && texto.includes('Contrato') && texto.includes(CUENTA_PROVEEDOR),
    'Pagos de servicio muestra la factura, el contrato y la cuenta del proveedor')
  comprobar(!limpio(await tarjeta.innerText()).includes('Falta la factura'), 'y ya no pide la factura')
  await tarjeta.getByRole('button', { name: 'Registrar pago' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  const enVentana = limpio(await v.locator('[data-para-pagar]').innerText().catch(() => ''))
  comprobar(enVentana.includes(`Factura E001-${SUFIJO}`) && enVentana.includes(CUENTA_PROVEEDOR), 'la ventana de pago también')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await contexto.close()
}

// ---------------------------------------------------------------- 6. Gerencia consulta sin pagar
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`article#compra-${oc[0]}`).count()) === 1, 'Gerencia ve la OC con boleta')
  comprobar((await pagina.locator('[data-pagar-compra]').count()) === 0, 'sin ningún botón de pagar')
  await contexto.close()
}

// ---------------------------------------------------------------- 7. En el teléfono
{
  const { pagina, contexto } = await entrar('tesoreria', { width: 390, height: 844 })
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `Cuentas por pagar no se ensancha en el teléfono (${ancho} px)`)
  await pagina.locator(`article#compra-${oc[0]} [data-pagar-compra]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  const caja = await v.boundingBox()
  comprobar(caja && caja.width <= 390, `la ventana de pago entra en la pantalla (${Math.round(caja?.width ?? 0)} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'boleta-telefono.png') })
  await contexto.close()
}

await navegador.close()
await base.end()
comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo en orden')
process.exit(fallas.length ? 1 : 0)

/**
 * Clic real sobre lo que pidió DKS el 20/10 (migración 20261020210000): que
 * Tesorería, al pagar, vea la OC, su factura o su boleta y la cuenta del
 * proveedor, y que la OS guarde su factura. Con la cuenta de cada puesto, nunca
 * ADMIN:
 *
 *   1. Tesorería ve la OC con boleta en Cuentas por pagar, con el PDF de la OC,
 *      la boleta que adjuntó Logística y la cuenta del proveedor, y no ve ahí
 *      la OC con factura; la tarjeta de la factura de esa otra OC muestra igual
 *      la factura, el PDF de su OC y la cuenta. La paga desde la ventana, que muestra lo mismo: tres
 *      toques dejan un pago, un egreso en la caja y el voucher en
 *      storage.objects. Adquisiciones la da por pagada.
 *   2. El PDF de la OC lo descarga Tesorería (200, application/pdf).
 *   3. Tesorería anula el pago con su motivo: la OC vuelve a estar por pagar y
 *      el egreso queda anulado.
 *   3b. La OC con boleta de antes sale «Pago fuera del sistema» y no está en
 *      Cuentas por pagar; Tesorería la pasa con «No se pagó» (tres toques, un
 *      cambio en la auditoría) y ya pide su pago. Tras «No se pagó» la fila dice lo
 *      que pasó y el foco queda en ese aviso. Con un pago directo vigente,
 *      Contabilidad le liga una factura y, registrada, la factura toma ese
 *      pago (décima vuelta).
 *   3c. La OC con boleta cuyo proveedor entregó factura (Logística la anexó):
 *      Cuentas por pagar dice «Llegó factura», muestra esa factura y no ofrece
 *      el pago directo; Adquisiciones la da por esperar su factura.
 *   3d. (décima vuelta) La OC con boleta que Tesorería pagó entera y a la que
 *      después llega factura: no se anula nada. Mientras Contabilidad no la
 *      registra, la tarjeta dice que la factura quedará pagada con ese pago, y
 *      Gerencia lo lee sin botones. Registrada por menos, la factura toma lo
 *      que le cabe: Tesorería recibe «Compra pagada de más», la tarjeta sale
 *      primero y pide la devolución. (undécima vuelta) «Anular» pregunta qué
 *      pasó: si el proveedor lo devolvió, no se anula, se registra la
 *      devolución con su constancia (tres toques, una devolución y su ingreso
 *      en la caja); la OC queda pagada por su factura, el aviso de lo pagado
 *      de más se da por leído y el pago ya no se anula mientras la devolución
 *      siga. Gerencia la ve sin botones. Anulada la devolución, vuelve lo
 *      pagado de más y su ingreso se anula.
 *   3e. Contabilidad registra a mano, con ceros y en minúsculas, la factura que
 *      Logística anexó: entra una vez, ligada sola a su OC y al anexo, y el
 *      desplegable ya no la ofrece.
 *   3f. (undécima vuelta, segunda pasada) La OC 6, pagada entera y sin
 *      factura: el proveedor devuelve S/ 61.50 que cobró de más. La ventana, el
 *      aviso y la tarjeta dicen que la OC vuelve a deber y que, si fue por eso,
 *      Logística la corrige; Logística no puede bajarla de lo pagado, sí hasta
 *      lo pagado, y la OC queda pagada sin pagarse otra vez. La OC 7, pagada
 *      entera, con una factura que cubre una parte: la tarjeta dice lo que
 *      tomó y lo que tomará la que falta, y la devolución dice lo que queda
 *      para esa factura, no «nada pagado de más».
 *   4. Logística adjunta a la OS su factura (tres toques, un documento, con el
 *      número en mayúsculas) y su contrato, y el archivo queda en
 *      storage.objects. Emite otra OS con su contrato desde «Nueva orden de
 *      servicio»: un archivo que no es PDF ni foto no deja emitir; con el PDF,
 *      tres toques dejan una OS y su contrato.
 *   5. Tesorería los ve en Pagos de servicio junto a la cuenta del proveedor,
 *      en la tarjeta y en la ventana de pago, y ya no le pide la factura.
 *   6. Gerencia ve la OC con boleta y la factura, con sus documentos y la cuenta
 *      del proveedor, sin el botón de pagar.
 *   7. En el teléfono, Cuentas por pagar no se ensancha.
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_ARCHIVOS y el correo de cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'tesoreria', 'gerencia', 'contabilidad', 'requerimientos', 'almacen'].map((p) => [p, cuenta(p)]))
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
// Sin cero adelante: la base normaliza «F001-012345» a «F001-12345» y el número no se encontraría.
const SUFIJO = String(100000 + (Date.now() % 900000))
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
        from generate_series(1, 7) n))`,
  [rq, area, `Prueba de la OC con boleta ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
// La 1 va con boleta y la 2 con factura: la de factura no entra en la lista de boletas.
// La 3, con boleta, se marca después como de antes de la migración: se dio por pagada fuera.
// La 4, con boleta, recibe después la factura del proveedor: se paga por ella.
// La 5, con boleta, se paga entera y después llega su factura (3d).
// La 6 y la 7, con boleta, se pagan enteras: el proveedor devuelve parte de la 6, y la 7 tiene una factura por una parte (3f).
await como('logistica')
const oc = []
for (const n of [1, 2, 3, 4, 5, 6, 7]) {
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
// El proveedor de la 4 entregó factura y Logística la anexó a la OC.
const [{ id: facturaAnexada }] = await consulta(`select gen_random_uuid() as id`)
await subir('documentos-compras', `compra/${oc[3]}/${facturaAnexada}.pdf`, 'logistica')
await consulta(
  `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision)
   values ($1, $2, 'FACTURA', 'factura.pdf', $3, 'application/pdf', $4, $5, $6, $7::date)`,
  [facturaAnexada, oc[3], `compra/${oc[3]}/${facturaAnexada}.pdf`, PDF.length, ids[CUENTAS.logistica], `F009-${SUFIJO}`, hoy],
)
await como('gerencia')
for (const id of oc) await consulta(`select public.aprobar_compra($1)`, [id])
// La factura de la OC 2, registrada por Contabilidad con su PDF.
const [{ id: factura }] = await consulta(`select gen_random_uuid() as id`)
const [{ total: totalFactura }] = await consulta(`select public.total_orden_compra($1)::float as total`, [oc[1]])
await como('contabilidad')
await consulta(
  `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
   values ($1, 'FACTURA_COMPRA', $2, $3, $5::date, $5::date, 'PEN', $4, 'CONTADO')`,
  [factura, PROVEEDOR, `F001-${SUFIJO}`, totalFactura, hoy],
)
await consulta(`insert into adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values ($1, $2)`, [factura, oc[1]])
await subir('comprobantes-financieros', `adquisiciones/${factura}/comprobante.pdf`, 'contabilidad')
await consulta(`update adquisiciones set ruta_storage = $2, estado = 'REGISTRADA' where id = $1`, [factura, `adquisiciones/${factura}/comprobante.pdf`])
// Como la migración marcó las de antes al crear la columna: con los disparadores apagados.
await consulta('begin')
await consulta('set local session_replication_role = replica')
await consulta('update ordenes_compra_materiales set pago_en_tesoreria = false where id = $1', [oc[2]])
await consulta('commit')
await como('gerencia')
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
console.log(`Sembrado ${SUFIJO}: ${nombre(oc[0])} con boleta (S/ ${total}), ${nombre(oc[1])} con factura, ${nombre(oc[2])} con boleta de antes, ${nombre(oc[3])} con boleta y factura anexada, ${nombre(oc[4])} con boleta que se paga y después trae factura y ${NUMERO_OS}`)

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
// Mientras la prueba corta la subida a propósito, el navegador anota el corte en la consola.
let cortando = false

async function entrar(puesto, viewport = { width: 1280, height: 900 }) {
  const correo = CUENTAS[puesto]
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (cortando && m.text().includes('net::ERR_FAILED')) return
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
  // La factura muestra lo mismo en su tarjeta, no solo dentro de la ventana de pago.
  const enFactura = limpio(await pagina.locator(`article#factura-${factura} [data-para-pagar]`).innerText().catch(() => ''))
  comprobar(enFactura.includes(`Factura F001-${SUFIJO}`) && enFactura.includes(`PDF de la ${nombre(oc[1])}`) && enFactura.includes(CUENTA_PROVEEDOR),
    `la tarjeta de la factura muestra la factura, el PDF de su OC y la cuenta («${enFactura}»)`)
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
  await v.waitFor()
  // Primero pregunta qué pasó (undécima vuelta): el motivo sale solo con «No salió».
  comprobar((await v.locator('textarea[name="motivo"]').count()) === 0, 'la ventana «Anular el pago» pregunta primero qué pasó, sin pedir el motivo')
  await v.locator('input[name="que_paso"][value="no_salio"]').check()
  comprobar((await v.locator('textarea[name="motivo"]').count()) === 1, 'con «No salió» pide el motivo')
  await v.locator('textarea[name="motivo"]').fill('Se registró con el voucher de otra compra')
  await v.getByRole('button', { name: 'Anular' }).click()
  const errorAnular = await esperarVentana(pagina)
  comprobar(!errorAnular, `anula el pago${errorAnular ? ` (dijo «${errorAnular}»)` : ''}`)
  const avisoAnular = limpio(await hasta(() => pagina.locator('p.sr-only[role="status"]').first().textContent().catch(() => ''), (t) => Boolean(t), 5000))
  comprobar(avisoAnular.includes('a la OC le quedan') && avisoAnular.includes(String(total)),
    `el aviso dice lo que le queda por pagar: «${avisoAnular}»`)
  const [anulado] = await hasta(() => consulta(`select anulado_en from pagos_orden_compra where id = $1`, [pagoId]), (r) => r[0]?.anulado_en)
  const [egreso] = await consulta(`select anulado_en from movimientos_caja where origen = 'PAGO_ORDEN_COMPRA' and origen_id = $1`, [pagoId])
  comprobar(Boolean(anulado?.anulado_en) && Boolean(egreso?.anulado_en), 'el pago queda anulado y su egreso también')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`article#compra-${oc[0]} [data-pagar-compra]`).count()) === 1, 'la OC vuelve a pedir su pago')
  comprobar((await pagoSegunAdquisiciones(oc[0])) === 'POR_PAGAR', 'y Adquisiciones la vuelve a dar por pagar')
  await contexto.close()
}

// ---------------------------------------------------------------- 3b. La OC con boleta de antes que no se pagó
{
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`article#compra-${oc[2]}`).count()) === 0, `la ${nombre(oc[2])}, de antes, no está en Cuentas por pagar`)
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`tbody tr[data-orden="${nombre(oc[2])}"]`)
  comprobar(limpio(await fila.textContent().catch(() => '')).includes('Pago fuera del sistema'), 'Adquisiciones la da por pagada fuera del sistema')
  const boton = fila.locator(`[data-pasar-compra="${oc[2]}"]`)
  comprobar((await boton.count()) === 1, 'y a Tesorería le ofrece «No se pagó»')
  await boton.click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  comprobar(limpio(await v.textContent()).includes('No vuelve atrás'), 'la ventana avisa que no vuelve atrás')
  await tresToques(v.getByRole('button', { name: 'Pasar a Cuentas por pagar' }))
  const error = await esperarVentana(pagina)
  comprobar(!error, `la pasa a Cuentas por pagar${error ? ` (dijo «${error}»)` : ''}`)
  const [marca] = await hasta(() => consulta('select pago_en_tesoreria from ordenes_compra_materiales where id = $1', [oc[2]]), (r) => r[0]?.pago_en_tesoreria)
  comprobar(marca?.pago_en_tesoreria === true, 'la OC queda para que Tesorería la pague')
  const [{ n: auditadas }] = await consulta(
    `select count(*)::int as n from audit_log where tabla = 'ordenes_compra_materiales' and registro_id = $1 and accion = 'UPDATE' and usuario_id = $2`,
    [oc[2], ids[CUENTAS.tesoreria]],
  )
  comprobar(auditadas === 1, `tres toques, un cambio en la auditoría, con quién lo hizo (${auditadas})`)
  const enAdq = await hasta(
    async () => limpio(await pagina.locator(`tbody tr[data-orden="${nombre(oc[2])}"]`).textContent().catch(() => '')),
    (t) => t.includes('Por pagar'),
  )
  comprobar(enAdq.includes('Por pagar') && enAdq.includes('Pagar en Cuentas por pagar') && !enAdq.includes('No se pagó'),
    `la fila la da por pagar y lleva a pagarla: «${enAdq.slice(0, 200)}»`)
  comprobar(enAdq.includes('pasó a Cuentas por pagar'), 'y dice lo que pasó')
  const foco = await hasta(() => pagina.evaluate(() => [document.activeElement?.getAttribute('role'), document.activeElement?.textContent ?? '']), ([r]) => r === 'status', 5000)
  comprobar(foco[0] === 'status' && foco[1].includes('pasó a Cuentas por pagar'), `el foco queda en ese aviso, no en la página (${foco[0] ?? 'body'})`)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`article#compra-${oc[2]} [data-pagar-compra]`).count()) === 1, 'y en Cuentas por pagar ya pide su pago')
  await contexto.close()

  // El otro camino: con un pago directo vigente, Contabilidad le liga una factura y, registrada, toma ese pago.
  await como('tesoreria')
  const [{ id: pagoDirecto }] = await consulta('select gen_random_uuid() as id')
  const voucher = await subir('pagos-compras', `${oc[2]}/${pagoDirecto}.pdf`, 'tesoreria')
  await consulta(`select public.registrar_pago_compra($1, $2, $3::date, 50, false, null, null, $4, $5, null)`, [pagoDirecto, oc[2], hoy, voucher, caja])
  await como('contabilidad')
  const [{ id: otra }] = await consulta('select gen_random_uuid() as id')
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $4::date, 'PEN', 80, 'CONTADO')`,
    [otra, PROVEEDOR, `F002-${SUFIJO}`, hoy],
  )
  const rechazo = await consulta(`insert into adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values ($1, $2)`, [otra, oc[2]])
    .then(() => '')
    .catch((e) => e.message)
  comprobar(rechazo === '', `Contabilidad le liga la factura aunque Tesorería ya le pagó directo${rechazo ? ` («${rechazo.slice(0, 120)}»)` : ''}`)
  await subir('comprobantes-financieros', `adquisiciones/${otra}/comprobante.pdf`, 'contabilidad')
  await consulta(`update adquisiciones set ruta_storage = $2, estado = 'REGISTRADA' where id = $1`, [otra, `adquisiciones/${otra}/comprobante.pdf`])
  await como(null)
  const tomado = await consulta(`select monto::float as monto from pagos_adquisicion where adquisicion_id = $1 and pago_orden_compra_id = $2 and anulado_en is null`, [otra, pagoDirecto])
  comprobar(tomado.length === 1 && tomado[0].monto === 50, 'registrada, la factura de S/ 80 toma los S/ 50 que ya se pagaron por la boleta')

  // Ese pago se anula porque se registró mal: la factura deja de tomarlo y su tarjeta pide registrarlo con ese voucher si el dinero sí
  // salió. Registrado, la nota ya no corre: los S/ 30 que le faltan a la factura sí se transfieren (la undécima auditoría la vio seguir).
  await como('tesoreria')
  await consulta(`select public.anular_pago_compra($1, 'Se registró en la OC que no era')`, [pagoDirecto])
  await como(null)
  const t2 = await entrar('tesoreria')
  await t2.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const notaAntes = limpio(await t2.pagina.locator(`article#factura-${otra}`).textContent().catch(() => ''))
  comprobar(notaAntes.includes('Tomaba S/ 50.00 del pago por la boleta') && notaAntes.includes('con ese mismo voucher'),
    `anulado ese pago, la factura dice lo que tomaba y que se registre con ese voucher: «${notaAntes.slice(0, 260)}»`)
  // Registrado en dos partes: tras la primera, la nota dice lo que ya entró y lo que queda por registrar con ese voucher.
  const registrar = async (monto, op) => {
    await como('tesoreria')
    const [{ id: propio }] = await consulta('select gen_random_uuid() as id')
    const voucherPropio = await subir('pagos-facturas', `${otra}/${propio}.pdf`, 'tesoreria')
    await consulta(`select public.registrar_pago_factura($1, $2, $3::date, $4, $5, $6, $7, null)`, [propio, otra, hoy, monto, op, voucherPropio, caja])
    await como(null)
  }
  await registrar(20, `OP-NOTA-${SUFIJO}`)
  await t2.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const notaEnParte = limpio(await t2.pagina.locator(`article#factura-${otra}`).textContent().catch(() => ''))
  comprobar(notaEnParte.includes('Después se registraron S/ 20.00 en esta factura') && notaEnParte.includes('Si el resto, S/ 30.00, también salió')
      && notaEnParte.includes('regístralo aquí con su mismo voucher'),
    `registrados S/ 20, la nota dice lo que entró y los S/ 30 que quedan por registrar: «${notaEnParte.slice(0, 320)}»`)
  await registrar(30, `OP-NOTA2-${SUFIJO}`)
  await t2.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const notaDespues = limpio(await t2.pagina.locator(`article#factura-${otra}`).textContent().catch(() => ''))
  comprobar(notaDespues.includes('Saldo S/ 30.00') && !notaDespues.includes('mismo voucher'),
    `registrados los S/ 50 con ese voucher, la nota se va y la factura debe S/ 30: «${notaDespues.slice(0, 200)}»`)
  await t2.contexto.close()
}

// ---------------------------------------------------------------- 3c. La OC con boleta cuyo proveedor entregó factura
{
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`article#compra-${oc[3]}`)
  comprobar((await fila.count()) === 1, `la ${nombre(oc[3])} está en «OC con boleta por pagar»`)
  const texto = limpio(await fila.textContent().catch(() => ''))
  comprobar(texto.includes('Llegó factura') && texto.includes(`El proveedor entregó la factura F009-${SUFIJO}`) && texto.includes('Facturas por pagar'),
    `dice que llegó factura y dónde se paga: «${texto.slice(0, 220)}»`)
  comprobar(!texto.includes('Falta la boleta'), 'y no pide la boleta')
  comprobar(texto.includes('Iba con boleta') && texto.includes('Se paga por su comprobante') && !texto.includes('Saldo'),
    'su cifra es el total de la OC, que se paga por la factura, no un saldo por pagar aquí')
  comprobar((await fila.getByRole('link', { name: `Factura F009-${SUFIJO}` }).count()) === 1, 'muestra la factura que anexó Logística')
  comprobar((await fila.locator('[data-pagar-compra]').count()) === 0, 'y no ofrece el pago directo')
  comprobar((await pagoSegunAdquisiciones(oc[3])) === 'POR_FACTURAR', 'Adquisiciones la da por esperar su factura')
  await contexto.close()
}

// ---------------------------------------------------------------- 3d. Pagada entera, y después llega su factura
{
  await como('tesoreria')
  const [{ id: pagoEntero }] = await consulta('select gen_random_uuid() as id')
  const [{ total: total5 }] = await consulta(`select public.total_orden_compra($1)::float as total`, [oc[4]])
  const voucher = await subir('pagos-compras', `${oc[4]}/${pagoEntero}.pdf`, 'tesoreria')
  await consulta(`select public.registrar_pago_compra($1, $2, $3::date, $4, true, null, null, $5, $6, null)`, [pagoEntero, oc[4], hoy, total5, voucher, caja])
  await como('logistica')
  const [{ id: facturaTarde }] = await consulta(`select gen_random_uuid() as id`)
  await subir('documentos-compras', `compra/${oc[4]}/${facturaTarde}.pdf`, 'logistica')
  await consulta(
    `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision)
     values ($1, $2, 'FACTURA', 'factura.pdf', $3, 'application/pdf', $4, $5, $6, $7::date)`,
    [facturaTarde, oc[4], `compra/${oc[4]}/${facturaTarde}.pdf`, PDF.length, ids[CUENTAS.logistica], `F010-${SUFIJO}`, hoy],
  )
  await como(null)
  const [{ n: avisos }] = await consulta(`select count(*)::int as n from notificaciones where usuario_id = $1 and origen_id = $2`, [ids[CUENTAS.tesoreria], oc[4]])
  comprobar(avisos === 0, `a Tesorería no se le pide nada mientras la factura no se registra (${avisos} avisos)`)

  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`article#compra-${oc[4]}`)
  comprobar((await fila.count()) === 1 && (await fila.isVisible()), `la ${nombre(oc[4])} sale a la vista, no escondida entre las pagadas`)
  comprobar((await pagina.locator('details', { has: fila }).count()) === 0, 'fuera del desplegable de pagadas')
  const texto = limpio(await fila.textContent().catch(() => ''))
  comprobar(texto.includes('Llegó factura') && texto.includes(`factura F010-${SUFIJO}`) && texto.includes('toma lo que ya se pagó por la boleta'),
    `dice que, registrada, la factura toma ese pago: «${texto.slice(0, 300)}»`)
  comprobar(!texto.includes('Anula el pago'), 'y no pide anular el pago')
  comprobar((await fila.locator('[data-pagar-compra]').count()) === 0, 'ni ofrece pagarla otra vez')
  comprobar((await pagoSegunAdquisiciones(oc[4])) === 'PAGADA', 'Adquisiciones la da por pagada')
  await contexto.close()

  // Gerencia lee lo mismo, sin botones.
  const g = await entrar('gerencia')
  await g.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjetaGerencia = g.pagina.locator(`article#compra-${oc[4]}`)
  const paraGerencia = limpio(await tarjetaGerencia.textContent().catch(() => ''))
  comprobar(paraGerencia.includes('toma lo que ya se pagó por la boleta') && (await tarjetaGerencia.locator('[data-anular-pago-compra]').count()) === 0,
    `Gerencia lee lo mismo y no puede anular: «${paraGerencia.slice(0, 220)}»`)
  await g.contexto.close()

  // Contabilidad la registra por menos: la factura toma lo que le cabe y el resto se pagó de más.
  const totalFactura = Math.round((total5 - 61.5) * 100) / 100
  const [{ id: registrada }] = await consulta('select gen_random_uuid() as id')
  await como('contabilidad')
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, orden_compra_id, documento_compra_id)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $4::date, 'PEN', $5, 'CONTADO', $6, $7)`,
    [registrada, PROVEEDOR, `F010-${SUFIJO}`, hoy, totalFactura, oc[4], facturaTarde],
  )
  await consulta(`update adquisiciones set estado = 'REGISTRADA' where id = $1`, [registrada])
  await como(null)
  const [{ cuerpo } = {}] = await consulta(`select cuerpo from notificaciones where usuario_id = $1 and origen_id = $2 and titulo = $3 and leida_en is null`, [
    ids[CUENTAS.tesoreria],
    oc[4],
    `Compra pagada de más: ${nombre(oc[4])}`,
  ])
  comprobar(Boolean(cuerpo?.includes('es por menos') && cuerpo.includes('S/ 61.50 de más')), `a Tesorería le llega «Compra pagada de más» con lo pagado de más: «${limpio(cuerpo).slice(0, 200)}»`)
  comprobar((await pagoSegunAdquisiciones(oc[4])) === 'PAGADA_DE_MAS', 'Adquisiciones la da por pagada de más')

  const t = await entrar('tesoreria')
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  // Lo que pide algo a Tesorería va primero.
  const tarjetas = (await t.pagina.locator('#compras-con-boleta article').allTextContents()).map(limpio)
  // También pide algo la que espera que se le pase al cambio a su factura en otra moneda.
  const pide = (x) => x.includes('Pagada de más') || x.includes('Factura en otra moneda')
  const deMas = tarjetas.map((x, i) => (pide(x) ? i : -1)).filter((i) => i >= 0)
  const resto = tarjetas.map((x, i) => (pide(x) ? -1 : i)).filter((i) => i >= 0)
  comprobar(tarjetas.some((x) => x.includes('Pagada de más')) && (resto.length === 0 || Math.max(...deMas) < Math.min(...resto)),
    `las OC pagadas de más o en otra moneda salen antes que las demás (${deMas.join(', ')} de ${tarjetas.length})`)
  const tarjeta = t.pagina.locator(`article#compra-${oc[4]}`)
  const textoDeMas = limpio(await tarjeta.textContent())
  comprobar(textoDeMas.includes('Pagada de más') && textoDeMas.includes('Pagado de más S/ 61.50') && textoDeMas.includes('Total S/') && !textoDeMas.includes('Saldo'),
    `la tarjeta dice lo pagado de más, con su total y sin saldo: «${textoDeMas.slice(0, 260)}»`)
  // Lo pagado de más no se resuelve anulando (undécima vuelta): se registra la devolución o se descuenta de otra factura.
  comprobar(
    (await tarjeta.locator('[data-registrar-devolucion]').count()) === 1 &&
      (await tarjeta.locator('[data-descontar-de-otra]').count()) === 1 &&
      (await tarjeta.locator('[data-tomar-al-cambio]').count()) === 0,
    'ofrece «Registrar devolución» y «Lo descuenta de otra factura», y no el cambio',
  )
  await tarjeta.locator(`[data-anular-pago-compra="${pagoEntero}"]`).click()
  const vt = t.pagina.locator('[role="dialog"]')
  await vt.waitFor()
  await vt.locator('input[name="que_paso"][value="devolvio"]').check()
  const devolvio = limpio(await vt.textContent())
  comprobar((await vt.locator('textarea[name="motivo"]').count()) === 0 && devolvio.includes('No se anula: lo que salió, salió'),
    `si el proveedor lo devolvió, no pide motivo ni anula: «${devolvio.slice(0, 220)}»`)
  // Su botón cierra esta ventana y abre la de la devolución.
  await vt.getByRole('button', { name: 'Registrar devolución' }).click()
  const vd = t.pagina.locator('[role="dialog"]')
  const enDevolucion = limpio(await hasta(() => vd.textContent().catch(() => ''), (x) => limpio(x).includes(`Devolución de la ${nombre(oc[4])}`), 5000))
  comprobar(enDevolucion.includes(`Devolución de la ${nombre(oc[4])}`), `abre la ventana de la devolución: «${enDevolucion.slice(0, 160)}»`)
  comprobar(enDevolucion.includes(`Como mucho, S/ ${total5.toFixed(2)}`), 'dice lo más que se puede registrar')
  comprobar(Number(await vd.locator('input[name="monto"]').inputValue()) === 61.5 && enDevolucion.includes('Ya no queda nada pagado de más'),
    'trae lo pagado de más y dice que ya no queda nada de más')
  await vd.locator('input[name="operacion"]').fill(`DEV-${SUFIJO}`)
  const cajaDev = await vd.locator('select[name="caja_id"] option', { hasText: CAJA }).getAttribute('value')
  await vd.locator('select[name="caja_id"]').selectOption(cajaDev)
  await vd.locator('input[name="archivo"]').setInputFiles(join(archivos, 'voucher.pdf'))
  await tresToques(vd.getByRole('button', { name: 'Registrar la devolución' }))
  const errorDev = await esperarVentana(t.pagina)
  comprobar(!errorDev, `registra la devolución${errorDev ? ` (dijo «${errorDev}»)` : ''}`)
  const avisoDev = limpio(await hasta(() => t.pagina.locator('p.sr-only[role="status"]').first().textContent().catch(() => ''), (x) => Boolean(x), 5000))
  comprobar(avisoDev.includes('Devolución registrada.') && avisoDev.includes('Ya no queda nada pagado de más.') && avisoDev.includes(`Entró a ${CAJA}`),
    `el aviso dice que ya no queda nada de más y a qué cuenta entró: «${avisoDev}»`)
  const devoluciones = await hasta(
    () => consulta(`select id, monto::float as monto, operacion, archivo_ruta from devoluciones_orden_compra where orden_compra_id = $1`, [oc[4]]),
    (r) => r.length > 0,
  )
  const devolucionId = devoluciones[0]?.id
  comprobar(devoluciones.length === 1 && devoluciones[0].monto === 61.5 && devoluciones[0].operacion === `DEV-${SUFIJO}`,
    `tres toques dejan una devolución de S/ 61.50 (${devoluciones.length})`)
  const ingresos = await consulta(`select tipo, monto::float as monto, caja_id from movimientos_caja where origen = 'DEVOLUCION_ORDEN_COMPRA' and origen_id = $1`, [devolucionId])
  comprobar(ingresos.length === 1 && ingresos[0].tipo === 'INGRESO' && ingresos[0].monto === 61.5 && ingresos[0].caja_id === caja,
    'y un ingreso de S/ 61.50 en la cuenta elegida')
  comprobar((await objeto('pagos-compras', devoluciones[0]?.archivo_ruta)) === 1 && existsSync(join(ARCHIVOS, 'pagos-compras', devoluciones[0]?.archivo_ruta ?? '-')),
    'la constancia está en storage.objects y en el disco del banco')

  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjetaDev = t.pagina.locator(`article#compra-${oc[4]}`)
  // Ya no pide nada: puede ir al desplegable de las pagadas, cerrado; textContent lee lo que no se ve.
  const textoDev = limpio(await tarjetaDev.textContent().catch(() => ''))
  comprobar(textoDev.includes('Pagada por su factura') && !textoDev.includes('Pagada de más'), `la OC queda «Pagada por su factura»: «${textoDev.slice(0, 220)}»`)
  comprobar(textoDev.includes('Devolución del') && textoDev.includes('S/ 61.50') && textoDev.includes(`op. DEV-${SUFIJO}`) && textoDev.includes(`entró a ${CAJA}`),
    'con la línea de la devolución y la cuenta a la que entró')
  const hrefConstancia = await tarjetaDev.locator('a', { hasText: 'Constancia' }).first().getAttribute('href').catch(() => null)
  const respuesta = hrefConstancia ? await t.pagina.request.get(hrefConstancia) : null
  comprobar(respuesta?.status() === 200, `el enlace «Constancia» abre (${respuesta?.status() ?? 'sin enlace'})`)
  comprobar((await tarjetaDev.locator(`[data-anular-pago-compra="${pagoEntero}"]`).count()) === 0 && textoDev.includes('Para anularlo, anula antes la devolución'),
    'el pago ya no se anula mientras la devolución siga')
  const [{ n: sinLeer }] = await consulta(`select count(*)::int as n from notificaciones where usuario_id = $1 and origen_id = $2 and leida_en is null`, [ids[CUENTAS.tesoreria], oc[4]])
  comprobar(sinLeer === 0, `el aviso de lo pagado de más se da por leído (${sinLeer})`)
  comprobar((await pagoSegunAdquisiciones(oc[4])) === 'PAGADA', 'Adquisiciones la da por pagada')
  await t.pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const filaAdq = limpio(await t.pagina.locator(`tbody tr[data-orden="${nombre(oc[4])}"]`).textContent().catch(() => ''))
  comprobar(filaAdq.includes('Devolución del') && filaAdq.includes('Constancia de la devolución'), `y su fila muestra la devolución con su constancia: «${filaAdq.slice(0, 260)}»`)
  // En la caja diaria, el ingreso dice de dónde viene y no es un extorno.
  await t.pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  const filaCaja = limpio(await t.pagina.locator('tr', { hasText: 'Devolución de proveedor (OC con boleta)' }).first().textContent().catch(() => ''))
  comprobar(filaCaja.includes('Devolución de proveedor (OC con boleta)') && !filaCaja.includes('extorno'), `la caja diaria muestra el ingreso de la devolución: «${filaCaja.slice(0, 200)}»`)

  // Gerencia la ve, sin botones.
  const gd = await entrar('gerencia')
  await gd.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjetaGd = gd.pagina.locator(`article#compra-${oc[4]}`)
  comprobar(
    limpio(await tarjetaGd.textContent().catch(() => '')).includes('Devolución del') &&
      (await tarjetaGd.locator('[data-registrar-devolucion]').count()) === 0 &&
      (await tarjetaGd.locator('[data-anular-devolucion]').count()) === 0,
    'Gerencia ve la devolución, sin registrar ni anular',
  )
  await gd.contexto.close()

  // Anular la devolución mal registrada: vuelve lo pagado de más, y su ingreso se anula.
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const detalles = t.pagina.locator('details', { has: t.pagina.locator(`article#compra-${oc[4]}`) })
  if ((await detalles.count()) > 0 && !(await detalles.first().evaluate((d) => d.open))) await detalles.first().locator('summary').click()
  await t.pagina.locator(`[data-anular-devolucion="${devolucionId}"]`).click()
  const va = t.pagina.locator('[role="dialog"]')
  await va.waitFor()
  await va.locator('textarea[name="motivo"]').fill('Se registró con la constancia de otra compra')
  await va.getByRole('button', { name: 'Anular' }).click()
  const errorAnular = await esperarVentana(t.pagina)
  comprobar(!errorAnular, `anula la devolución${errorAnular ? ` (dijo «${errorAnular}»)` : ''}`)
  const avisoAnular = limpio(await hasta(() => t.pagina.locator('p.sr-only[role="status"]').first().textContent().catch(() => ''), (x) => x.includes('Devolución anulada'), 5000))
  comprobar(avisoAnular.includes('Devolución anulada.') && avisoAnular.includes('Quedan S/ 61.50 pagados de más.') && avisoAnular.includes('Su ingreso en la caja diaria también quedó anulado.'),
    `el aviso dice que vuelve lo pagado de más y que su ingreso se anuló: «${avisoAnular}»`)
  const [ingreso] = await consulta(`select anulado_en from movimientos_caja where origen = 'DEVOLUCION_ORDEN_COMPRA' and origen_id = $1`, [devolucionId])
  comprobar(Boolean(ingreso?.anulado_en), 'el ingreso queda anulado')
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar(limpio(await t.pagina.locator(`article#compra-${oc[4]}`).textContent().catch(() => '')).includes('Pagada de más'), 'la tarjeta vuelve a «Pagada de más»')
  await t.contexto.close()

  // Se registra otra vez, para dejar la OC pagada como estaba.
  const [{ id: otraDevolucion }] = await consulta('select gen_random_uuid() as id')
  await como('tesoreria')
  const constancia = await subir('pagos-compras', `${oc[4]}/${otraDevolucion}.pdf`, 'tesoreria')
  await consulta(`select public.registrar_devolucion_compra($1, $2, $3::date, 61.5, $4, $5, $6, null)`, [otraDevolucion, oc[4], hoy, `DEV2-${SUFIJO}`, constancia, caja])
  await como(null)
  comprobar((await pagoSegunAdquisiciones(oc[4])) === 'PAGADA', 'registrada otra vez, Adquisiciones la vuelve a dar por pagada')
}

// ---------------------------------------------------------------- 3e. Contabilidad la registra a mano y queda en su OC
// La cuarta auditoría: registrada con su número y su proveedor, sin elegirla en
// «Factura que anexó Logística», quedaba sin OC y la compra se pagaba dos veces.
// Desde la quinta vuelta no se rechaza: la base la reconoce por sus claves aunque
// venga con ceros y en minúsculas, y la liga sola a la OC y al anexo.
{
  const { pagina, contexto } = await entrar('contabilidad')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('#adq-documento option', { hasText: `F009-${SUFIJO}` }).count()) === 1,
    `el desplegable ofrece la factura F009-${SUFIJO} que anexó Logística`)
  await pagina.locator('#adq-proveedor').fill(PROVEEDOR.toLowerCase())
  await pagina.locator('#adq-numero').fill(`F009-000${SUFIJO}`)
  await pagina.locator('#adq-total').fill('100')
  await pagina.locator('#adq-emision').fill(hoy)
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await pagina.locator('#adq-pdf').setInputFiles(join(archivos, 'voucher.pdf'))
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  const altas = await hasta(
    () => consulta(`select orden_compra_id, documento_compra_id from adquisiciones where public.clave_numero_comprobante(numero_documento) = $1`, [`F009-${SUFIJO}`]),
    (r) => r.length > 0,
    20000,
  )
  const error = limpio(await pagina.locator('form [role="alert"]').first().textContent({ timeout: 500 }).catch(() => ''))
  comprobar(altas.length === 1 && !error, `escrita a mano, con ceros y en minúsculas, entra una vez${error ? `: «${error}»` : ''}`)
  comprobar(altas[0]?.orden_compra_id === oc[3] && altas[0]?.documento_compra_id === facturaAnexada,
    `y queda ligada a la ${nombre(oc[3])} y a la factura que anexó Logística`)
  await pagina.reload({ waitUntil: 'networkidle' })
  comprobar((await pagina.locator('#adq-documento option', { hasText: `F009-${SUFIJO}` }).count()) === 0, 'el desplegable ya no la ofrece')
  await contexto.close()
}

// ---------------------------------------------------------------- 3f. Devuelta sin factura, y la factura que cubre una parte
{
  const [ocDev, ocParte] = [oc[5], oc[6]]
  await como('tesoreria')
  for (const o of [ocDev, ocParte]) {
    const [{ id: p }] = await consulta('select gen_random_uuid() as id')
    const v = await subir('pagos-compras', `${o}/${p}.pdf`, 'tesoreria')
    await consulta(`select public.registrar_pago_compra($1, $2, $3::date, $4, false, null, null, $5, $6, null)`, [p, o, hoy, total, v, caja])
  }
  // La factura de la 7 cubre una parte de la OC: S/ 200 de los S/ 361.50.
  const PARCIAL = `F003-${SUFIJO}`
  const [{ id: parcial }] = await consulta('select gen_random_uuid() as id')
  await como('contabilidad')
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $4::date, 'PEN', 200, 'CONTADO')`,
    [parcial, PROVEEDOR, PARCIAL, hoy],
  )
  await consulta(`insert into adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id, parcial) values ($1, $2, true)`, [parcial, ocParte])
  await subir('comprobantes-financieros', `adquisiciones/${parcial}/comprobante.pdf`, 'contabilidad')
  await consulta(`update adquisiciones set ruta_storage = $2, estado = 'REGISTRADA' where id = $1`, [parcial, `adquisiciones/${parcial}/comprobante.pdf`])
  await como(null)

  const t = await entrar('tesoreria')
  const abrir = async (id) => {
    const tarjeta = t.pagina.locator(`article#compra-${id}`)
    const plegada = t.pagina.locator('details', { has: tarjeta })
    if ((await plegada.count()) > 0 && !(await plegada.first().evaluate((d) => d.open))) await plegada.first().locator('summary').click()
    return tarjeta
  }
  /** Registra la devolución desde la tarjeta; devuelve lo que la ventana dijo en vivo y el aviso de después. */
  const devolver = async (id, monto, op) => {
    await (await abrir(id)).locator('[data-registrar-devolucion]').click()
    const v = t.pagina.locator('[role="dialog"]')
    await v.waitFor()
    await v.locator('input[name="monto"]').fill(monto)
    const enVivo = limpio(await v.textContent())
    await v.locator('input[name="operacion"]').fill(op)
    await v.locator('select[name="caja_id"]').selectOption(await v.locator('select[name="caja_id"] option', { hasText: CAJA }).getAttribute('value'))
    await v.locator('input[name="archivo"]').setInputFiles(join(archivos, 'voucher.pdf'))
    await v.getByRole('button', { name: 'Registrar la devolución' }).click()
    const error = await esperarVentana(t.pagina)
    const aviso = limpio(await hasta(() => t.pagina.locator('p.sr-only[role="status"]').first().textContent().catch(() => ''), (x) => x.includes('Devolución registrada'), 5000))
    return { enVivo, aviso, error }
  }

  // La 6: devuelve S/ 61.50 que cobró de más.
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const dev = await devolver(ocDev, '61.50', `DEV6-${SUFIJO}`)
  comprobar(dev.enVivo.includes('La OC queda debiendo S/ 61.50. Si te lo devolvió porque cobró de más o entregó menos, pídele a Logística que corrija la OC'),
    `la ventana dice que la OC vuelve a deber y que, si cobró de más, Logística la corrige: «${dev.enVivo.slice(-260)}»`)
  comprobar(!dev.error && dev.aviso.includes('A la OC le quedan S/ 61.50 por pagar') && dev.aviso.includes('pídele a Logística que corrija la OC'),
    `registra la devolución y el aviso dice lo mismo${dev.error ? ` (dijo «${dev.error}»)` : `: «${dev.aviso}»`}`)
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjetaDev = await abrir(ocDev)
  const textoDev = limpio(await tarjetaDev.textContent())
  comprobar(textoDev.includes('El proveedor devolvió S/ 61.50 de lo pagado y a la OC le faltan S/ 61.50') && textoDev.includes('pídele a Logística que corrija la OC')
      && (await tarjetaDev.locator('[data-pagar-compra]').count()) === 1,
    `la tarjeta lo dice y deja pagar lo que falta: «${textoDev.slice(0, 320)}»`)

  // Logística la corrige: no por debajo de lo pagado; hasta lo pagado, sí.
  const l = await entrar('logistica')
  await l.pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  const corregir = async (precio) => {
    const v = l.pagina.locator('[role="dialog"]')
    if (!(await v.isVisible().catch(() => false))) {
      await l.pagina.getByRole('button', { name: `Corregir la compra ${nombre(ocDev)}` }).click()
      await v.locator('[id^="corregir-precio-"]').first().waitFor({ timeout: 30000 })
    }
    await v.locator('[id^="corregir-precio-"]').first().fill(precio)
    await v.locator('[id^="correccion-motivo-"]').fill('El proveedor cobró de más la plancha y devolvió la diferencia')
    await v.locator('[id^="correccion-justificante-"]').setInputFiles(join(archivos, 'voucher.pdf'))
    await v.getByRole('button', { name: 'Corregir', exact: true }).click()
    return esperarVentana(l.pagina)
  }
  const precioDe = async () => (await consulta(`select precio_unitario::float as p from orden_compra_material_detalles where orden_compra_id = $1`, [ocDev]))[0].p
  const bajo = await corregir('90')
  comprobar(bajo.includes('Tesorería ya le pagó S/ 300.00 a la') && (await precioDe()) === 120.5,
    `por debajo de lo pagado no la corrige y dice por qué: «${bajo}»`)
  const hastaLoPagado = await corregir('100')
  comprobar(!hastaLoPagado && (await hasta(precioDe, (p) => p === 100)) === 100,
    `hasta lo pagado, sí: la plancha queda en S/ 100${hastaLoPagado ? ` (dijo «${hastaLoPagado}»)` : ''}`)
  await l.contexto.close()
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const corregida = await abrir(ocDev)
  const textoCorregida = limpio(await corregida.textContent())
  comprobar(textoCorregida.includes('Pagada') && !textoCorregida.includes('le faltan') && (await corregida.locator('[data-pagar-compra]').count()) === 0,
    `la OC queda pagada, sin pagarse otra vez: «${textoCorregida.slice(0, 220)}»`)
  comprobar((await pagoSegunAdquisiciones(ocDev)) === 'PAGADA', 'y Adquisiciones la da por pagada')

  // La 7: su factura cubre una parte.
  const tarjetaParte = await abrir(ocParte)
  const textoParte = limpio(await tarjetaParte.textContent())
  comprobar(textoParte.includes('Espera otra factura')
      && textoParte.includes(`Su factura ${PARCIAL} es por una parte de la OC y ya tomó S/ 200.00 de lo pagado por la boleta. Falta la factura por el resto, S/ 161.50: tomará los S/ 161.50 pagados por la boleta que ninguna factura tomó`),
    `la tarjeta dice lo que tomó su factura y lo que tomará la que falta: «${textoParte.slice(0, 360)}»`)
  const parte = await devolver(ocParte, '61.50', `DEV7-${SUFIJO}`)
  comprobar(parte.enVivo.includes('Quedan S/ 100.00 pagados por la boleta, que tomará la factura que falta.') && !parte.enVivo.includes('nada pagado de más'),
    `la ventana dice lo que queda para la factura que falta: «${parte.enVivo.slice(-200)}»`)
  comprobar(!parte.error && parte.aviso.includes('Quedan S/ 100.00 pagados por la boleta, que tomará la factura que falta.'),
    `y el aviso de después también${parte.error ? ` (dijo «${parte.error}»)` : `: «${parte.aviso}»`}`)
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const textoParte2 = limpio(await (await abrir(ocParte)).textContent())
  comprobar(textoParte2.includes('Falta la factura por el resto, S/ 161.50: tomará los S/ 100.00 pagados por la boleta que ninguna factura tomó, y lo demás, S/ 61.50, se paga por ella'),
    `devueltos S/ 61.50, la que falta tomará S/ 100 y lo demás se paga por ella: «${textoParte2.slice(0, 360)}»`)
  await t.pagina.screenshot({ path: `${CAPTURAS}/boleta-3f-tesoreria.png`, fullPage: true })
  await t.contexto.close()
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
  // A la altura del «Anular» de la OS, el del documento dice qué anula.
  const anulan = (await fila.locator('[data-anular-documento-servicio]').allInnerTexts()).map(limpio)
  comprobar(anulan.join(' | ') === 'Anular factura | Anular contrato', `cada documento dice qué anula: ${anulan.join(' | ')}`)
  await pagina.screenshot({ path: join(CAPTURAS, 'os-documentos.png'), fullPage: true })

  // 4b. La OS nueva lleva su contrato desde que se emite, si ya está («al crearlos o
  // que se quede opcional para que después lo adjunten», DKS por el hilo del costeo).
  const DESCRIPCION = `Torneado de prueba con su contrato (${SUFIJO})`
  const emitidas = () =>
    consulta(`select id, numero from ordenes_servicio where proveedor_id = $1 and descripcion = $2`, [proveedor, DESCRIPCION])
  await pagina.getByRole('button', { name: 'Nueva orden de servicio' }).click()
  await v.waitFor()
  await v.locator('#os-proveedor').click()
  await pagina.locator('[role="option"]', { hasText: PROVEEDOR }).first().click()
  await v.locator('#os-descripcion').fill(DESCRIPCION)
  await v.locator('#os-codigo').fill('PLA_SR_O4_1_26/21')
  await v.locator('#os-monto').fill('800')
  await v.locator('#os-detraccion').selectOption('037')
  // Un archivo que no es PDF ni foto no deja emitir: no queda una OS sin el contrato que se eligió.
  await v.locator('#os-contrato').setInputFiles({ name: 'contrato.txt', mimeType: 'text/plain', buffer: Buffer.from('no es un pdf') })
  await v.getByRole('button', { name: 'Emitir orden de servicio' }).click()
  const rechazo = await esperarVentana(pagina)
  comprobar(rechazo.includes('PDF') && (await v.isVisible()), `un contrato que no es PDF ni foto se rechaza antes de emitir («${rechazo}»)`)
  comprobar((await emitidas()).length === 0, 'y la OS no se emite')
  await v.locator('#os-contrato').setInputFiles(join(archivos, 'contrato-os.pdf'))
  await tresToques(v.getByRole('button', { name: 'Emitir orden de servicio' }))
  error = await esperarVentana(pagina)
  comprobar(!error, `emite la OS con su contrato${error ? ` (dijo «${error}»)` : ''}`)
  const nuevas = await hasta(emitidas, (r) => r.length > 0)
  comprobar(nuevas.length === 1, `tres toques emiten una OS (${nuevas.length})`)
  const contratos = await hasta(
    () => consulta(`select ruta_storage, subido_por from documentos_orden_servicio where orden_servicio_id = $1 and tipo = 'CONTRATO'`, [nuevas[0]?.id]),
    (r) => r.length > 0,
  )
  comprobar(contratos.length === 1 && contratos[0].subido_por === ids[CUENTAS.logistica], 'con su contrato adjunto, por Logística')
  comprobar((await objeto('documentos-servicio', contratos[0]?.ruta_storage)) === 1, 'y el archivo en storage.objects')
  const avisoNueva = limpio(await pagina.locator('[role="status"]').first().innerText().catch(() => ''))
  comprobar(avisoNueva.includes(nuevas[0]?.numero ?? '¿?') && avisoNueva.includes('Su contrato quedó adjunto'), `el aviso lo dice: «${avisoNueva}»`)
  const filaNueva = pagina.locator(`tr[data-servicio="${nuevas[0]?.numero}"]`)
  const conContrato = await hasta(async () => limpio(await filaNueva.innerText().catch(() => '')), (t) => t.includes('Contrato'))
  comprobar(conContrato.includes('Contrato'), 'y su fila muestra el contrato')

  // 4c. Si la OS entra y su contrato no (aquí se corta la subida), la OS queda
  // emitida y el aviso dice por qué y dónde adjuntarlo.
  const SIN_SENAL = `Doblado de prueba sin señal para el contrato (${SUFIJO})`
  cortando = true
  await pagina.route('**/storage/v1/object/documentos-servicio/**', (r) => r.abort())
  await pagina.getByRole('button', { name: 'Nueva orden de servicio' }).click()
  await v.waitFor()
  await v.locator('#os-proveedor').click()
  await pagina.locator('[role="option"]', { hasText: PROVEEDOR }).first().click()
  await v.locator('#os-descripcion').fill(SIN_SENAL)
  await v.locator('#os-codigo').fill('PLA_SR_O4_1_26/21')
  await v.locator('#os-monto').fill('800')
  await v.locator('#os-detraccion').selectOption('037')
  await v.locator('#os-contrato').setInputFiles(join(archivos, 'contrato-os.pdf'))
  await v.getByRole('button', { name: 'Emitir orden de servicio' }).click()
  error = await esperarVentana(pagina)
  await pagina.unroute('**/storage/v1/object/documentos-servicio/**')
  cortando = false
  const [cortada] = await hasta(
    () => consulta(`select id, numero from ordenes_servicio where proveedor_id = $1 and descripcion = $2`, [proveedor, SIN_SENAL]),
    (r) => r.length > 0,
  )
  comprobar(!error && Boolean(cortada), `la OS queda emitida aunque su contrato no subió${error ? ` (dijo «${error}»)` : ''}`)
  comprobar((await consulta(`select count(*)::int as n from documentos_orden_servicio where orden_servicio_id = $1`, [cortada?.id]))[0].n === 0,
    'sin documento anotado')
  const falta = limpio(await pagina.locator('[role="alert"]', { hasText: 'El contrato no subió' }).innerText().catch(() => ''))
  comprobar(falta.includes('revisa la señal') && falta.includes('Adjuntar documento') && !falta.includes('vuelve a intentar'),
    `y se avisa por qué y dónde adjuntarlo, sin pedir reintentar en una ventana que ya se cerró: «${falta}»`)
  const ofrece = await hasta(() => pagina.locator(`tr[data-servicio="${cortada?.numero}"] [data-adjuntar-documento-servicio]`).count(), (n) => n === 1)
  comprobar(ofrece === 1, 'su fila ofrece adjuntarlo')
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
  const enFactura = limpio(await pagina.locator(`article#factura-${factura} [data-para-pagar]`).innerText().catch(() => ''))
  comprobar(enFactura.includes(`PDF de la ${nombre(oc[1])}`) && enFactura.includes(CUENTA_PROVEEDOR), 'y en la factura, el PDF de su OC y a dónde se transfiere')
  comprobar((await pagina.locator('[data-pagar-compra]').count()) === 0, 'sin ningún botón de pagar')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-pasar-compra]').count()) === 0, 'ni el de pasar a Tesorería una OC de antes')
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

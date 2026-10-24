/**
 * Clic real sobre la pestaña «OC y OS» de Adquisiciones (migraciones
 * 20261020170000 y 20261020171000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Contabilidad ve una fila por OC y por OS, cada una con su RQ, su
 *      aprobación, sus documentos y si se pagó; el buscador y los filtros
 *      cuentan bien; Gestión de compras no está en su menú y por la dirección
 *      la rechaza.
 *   2. Contabilidad carga la guía de remisión de la OC programada desde su fila
 *      (con clic, en la ventana) y el PDF queda en la base; la abre, la anula
 *      con su motivo y la fila vuelve a pedirla.
 *   3. En el teléfono, una tarjeta por orden y la página no se ensancha.
 *   4. Tesorería ve la misma tabla, con el salto a pagar; Logística también,
 *      sin cargar guías, y sigue con su Gestión de compras. La cotización que
 *      ya está adjunta no entra otra vez como cotización, y sí con otro tipo,
 *      que es como se corrige uno mal elegido.
 *   5. Gerencia la lee y no entra a la gestión; el conductor entra a la gestión
 *      (sin sus controles) pero no a Adquisiciones; Ventas no entra a ninguna.
 *
 * Siembra sus propios datos en la base del banco con un sufijo nuevo: un RQ
 * con cuatro OC (una espera a Gerencia, una pagada en parte, una programada
 * para el conductor con la cotización adjunta y una con boleta) y dos OS (una
 * pagada y otra esperando a Gerencia). Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), CAPTURAS, BANCO_BASE, BANCO_ARCHIVOS y el correo de
 * cada cuenta si no es `<puesto>.local@metalwork.test`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(
  ['logistica', 'contabilidad', 'tesoreria', 'gerencia', 'conductor', 'ventas', 'requerimientos', 'almacen'].map((p) => [p, cuenta(p)]),
)
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
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n')

// ---------------------------------------------------------------- siembra
const SUFIJO = Date.now().toString().slice(-6)
const PROVEEDOR = `PROVEEDOR BANCO ${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

/** Lo que hace la sesión de esa cuenta: los disparadores y las funciones leen el usuario de aquí. */
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
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

// Un RUC válido: de un mismo número de diez dígitos, el dígito verificador que
// calza. El número sale de aquí y no de random() en la consulta, que lo cambia en
// cada fila y a veces no dejaba ninguno válido.
let ruc
while (!ruc) {
  const base = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  ;[ruc] = await consulta(
    `select n from (select $1 || d as n from generate_series(0, 9) d) x
      where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
    [base],
  )
}
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 403, Lima', '999 403 403') returning id`,
  [ruc.n, PROVEEDOR],
)
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`BANCO-${SUFIJO}`, `Plancha LAF 2 mm 4x8 (${SUFIJO})`, cat, und],
)
const [{ id: rq }] = await consulta(`select gen_random_uuid() as id`)
await como('requerimientos')
await consulta(
  `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/28', $3, null,
     (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3, 'unidad_medida_id', $4::text, 'categoria_id', $5::text))
        from generate_series(1, 4) n))`,
  [rq, area, `Prueba de Adquisiciones ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
await como('logistica')
const oc = []
for (let n = 1; n <= 4; n++) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
       jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 3, 'precio', 120.50)), null, 'CONTADO', 0, 'PEN', $5) as id`,
    [rq, n, proveedor, material, n !== 4],
  )
  oc.push(id)
}
await como('gerencia')
for (const id of oc.slice(1)) await consulta(`select public.aprobar_compra($1)`, [id])

// La factura de la OC 2, registrada por Contabilidad, pagada en parte por Tesorería.
const [{ id: factura }] = await consulta(`select gen_random_uuid() as id`)
const [{ total: totalOc2 }] = await consulta(`select public.total_orden_compra($1)::float as total`, [oc[1]])
await como('contabilidad')
await consulta(
  `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, ruc_proveedor)
   values ($1, 'FACTURA_COMPRA', $2, $3, (now() at time zone 'America/Lima')::date, (now() at time zone 'America/Lima')::date, 'PEN', $4, 'CONTADO', $5)`,
  [factura, PROVEEDOR, `F001-${SUFIJO}`, totalOc2, ruc.n],
)
await consulta(`insert into adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values ($1, $2)`, [factura, oc[1]])
await subir('comprobantes-financieros', `adquisiciones/${factura}/comprobante.pdf`, 'contabilidad')
await consulta(`update adquisiciones set ruta_storage = $2, estado = 'REGISTRADA' where id = $1`, [factura, `adquisiciones/${factura}/comprobante.pdf`])
await como('tesoreria')
await consulta(
  `insert into pagos_adquisicion (adquisicion_id, fecha, monto, referencia, archivo_ruta, archivo_mime, archivo_tamano)
   values ($1, (now() at time zone 'America/Lima')::date, 100, $2, $3, 'application/pdf', $4)`,
  [factura, `OP-${SUFIJO}`, await subir('pagos-facturas', `${factura}/voucher-${SUFIJO}.pdf`, 'tesoreria'), PDF.length],
)

// Las OS: una aprobada y pagada, otra esperando a Gerencia.
const os = []
for (let n = 1; n <= 2; n++) {
  const [{ id }] = await consulta(
    `insert into ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno, aprobacion, aprobado_por, aprobado_en, creado_por)
     values ($1, $2, $3, $4, 500, 'PEN', 'PLA_SR_O4_1_26/28', $5, $6, $7, $8) returning id`,
    [`QA-OS-${SUFIJO}-${n}`, proveedor, PROVEEDOR, `Servicio de prueba ${n} (${SUFIJO})`, n === 1 ? 'APROBADA' : 'POR_APROBAR',
     n === 1 ? ids[CUENTAS.gerencia] : null, n === 1 ? new Date() : null, ids[CUENTAS.logistica]],
  )
  os.push(id)
}
await consulta(
  `insert into pagos_orden_servicio (orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion, comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano)
   values ($1, (now() at time zone 'America/Lima')::date, 'PEN', 590, true, $2, $3, $4, 'application/pdf', $5)`,
  [os[0], `OP-OS-${SUFIJO}`, `E001-${SUFIJO}`, await subir('pagos-servicio', `${os[0]}/voucher-${SUFIJO}.pdf`, 'tesoreria'), PDF.length],
)

// Logística adjunta la cotización de la OC 3 y la pone en la lista del conductor.
await como('logistica')
const [{ id: documento }] = await consulta(`select gen_random_uuid() as id`)
await subir('documentos-compras', `compra/${oc[2]}/${documento}.pdf`, 'logistica')
await consulta(
  `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
   values ($1, $2, 'COTIZACION', 'cotizacion.pdf', $3, 'application/pdf', $4, $5)`,
  [documento, oc[2], `compra/${oc[2]}/${documento}.pdf`, PDF.length, ids[CUENTAS.logistica]],
)
await consulta(`select public.programar_recojo($1, 245.5, null)`, [oc[2]])
await consulta(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)

const numeros = Object.fromEntries((await consulta(`select id, numero from ordenes_compra_materiales where id = any($1)`, [oc])).map((f) => [f.id, f.numero]))
const nombre = (id) => numeros[id] ?? 'OC sin número'
const [{ numero: numeroRq }] = await consulta(`select numero from requerimientos where id = $1`, [rq])
console.log(`Sembrado ${SUFIJO}: ${numeroRq}, ${oc.map(nombre).join(', ')} y QA-OS-${SUFIJO}-1/2`)

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

/**
 * Mientras una prueba corta la respuesta a propósito, el «net::ERR_FAILED» de la consola es el corte, y el
 * 400 es Storage diciendo que el PDF ya está en su ruta (el reintento lo sube otra vez).
 */
let cortando = false

async function entrar(puesto, viewport = { width: 1280, height: 900 }) {
  const correo = CUENTAS[puesto]
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (cortando && /net::ERR_FAILED|status of 400/.test(m.text())) return
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
const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+\+?$/, ''))
const ir = (pagina, ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
const buscar = `q=${SUFIJO}`
const fila = (pagina, id) => pagina.locator(`tbody tr[data-orden="${id.startsWith('QA-OS') ? id : nombre(id)}"]`)
const columna = async (tr, n) => limpio(await tr.locator('td').nth(n).innerText())
/** Lo que devuelve un enlace con la sesión de la página, siguiendo la redirección al PDF firmado. */
async function abrir(contexto, href) {
  const r = await contexto.request.get(new URL(href, BASE).toString(), { maxRedirects: 5 })
  return { estado: r.status(), cabeza: (await r.body()).subarray(0, 5).toString() }
}
/**
 * Los píxeles entre la última letra de la palabra y el número de un enlace a un
 * comprobante. El texto de la página trae el espacio aunque en la pantalla se
 * lean pegados («FacturaF001-123»), así que se mide la geometría. Si el número
 * bajó a la línea siguiente no están pegados, y se da por bueno.
 */
const hueco = (enlace) =>
  enlace.evaluate((a) => {
    const numero = a.querySelector('.tabular')?.getClientRects()[0]
    const texto = document.createTreeWalker(a, NodeFilter.SHOW_TEXT).nextNode()
    if (!numero || !texto) return -1
    const fin = texto.textContent.trimEnd().length
    const rango = document.createRange()
    rango.setStart(texto, fin - 1)
    rango.setEnd(texto, fin)
    const letra = rango.getBoundingClientRect()
    if (Math.abs(letra.top - numero.top) > letra.height / 2) return Infinity
    return numero.left - letra.right
  })
const rechaza = async (pagina, ruta) => {
  await ir(pagina, ruta)
  return new URL(pagina.url()).pathname === '/sin-permiso'
}

// ------------------------------------------------ 1. Contabilidad: la tabla
{
  const { pagina, contexto } = await entrar('contabilidad')
  const m = await menu(pagina)
  comprobar(m.includes('Adquisiciones') && !m.includes('Gestión de compras'), `el menú de Contabilidad lleva Adquisiciones y no Gestión de compras (${m.join(', ')})`)
  await ir(pagina, `/adquisiciones?${buscar}`)
  const filas = pagina.locator('tbody tr')
  comprobar((await filas.count()) === 6, `buscando el proveedor salen sus cuatro OC y sus dos OS (${await filas.count()} filas)`)
  const pagos = {}
  for (const id of [...oc, `QA-OS-${SUFIJO}-1`, `QA-OS-${SUFIJO}-2`]) pagos[id.startsWith('QA') ? id : nombre(id)] = await columna(fila(pagina, id), 6)
  console.log('     Pago de cada fila:', JSON.stringify(pagos))
  comprobar(pagos[nombre(oc[0])]?.startsWith('Espera a Gerencia'), 'la OC sin aprobar espera a Gerencia')
  comprobar(/^Pagada en parte Saldo S\/ [\d,.]+ Voucher .*S\/ 100\.00/.test(pagos[nombre(oc[1])] ?? ''), `la OC con factura pagada en parte dice su saldo y su voucher («${pagos[nombre(oc[1])]}»)`)
  comprobar(pagos[nombre(oc[2])]?.startsWith('Espera su factura'), 'la OC sin factura registrada espera su factura')
  // Desde la 20261020210000 la OC con boleta la paga Tesorería, como una OS.
  comprobar(pagos[nombre(oc[3])]?.startsWith('Por pagar'), 'la que va con boleta no espera factura: la paga Tesorería')
  comprobar(/^Pagada Voucher .*S\/ 590\.00/.test(pagos[`QA-OS-${SUFIJO}-1`] ?? ''), `la OS pagada, con su voucher («${pagos[`QA-OS-${SUFIJO}-1`]}»)`)
  comprobar(pagos[`QA-OS-${SUFIJO}-2`]?.startsWith('Espera a Gerencia'), 'la OS sin aprobar espera a Gerencia')
  comprobar(!(pagos[nombre(oc[1])] ?? '').includes('Pagar en Cuentas por pagar'), 'a Contabilidad no le ofrece pagar: eso es de Tesorería')
  const arriba = limpio(await pagina.locator('main').innerText())
  comprobar(/(Una guía|\d+ guías) de remisión por cargar/.test(arriba), 'arriba le dice cuántas guías tiene por cargar')
  const situaciones = (await pagina.locator('[role="group"][aria-label="En qué van"] a').allTextContents()).map(limpio)
  comprobar(situaciones[1]?.startsWith('Guía por cargar'), `y «Guía por cargar» es su primer filtro (${situaciones.join(' | ')})`)

  const oc2 = fila(pagina, oc[1])
  const origen = await columna(oc2, 1)
  comprobar(origen.includes(numeroRq) && origen.includes('PLA_SR_O4_1_26/28') && origen.includes('Maestranza'), `de dónde sale: el RQ, el código y el área («${origen}»)`)
  const docs2 = await columna(oc2, 5)
  comprobar(docs2.includes(`Factura F001-${SUFIJO}`), `la OC 2 lleva su factura («${docs2}»)`)
  const enlaceFactura = oc2.locator('td').nth(5).getByRole('link', { name: /Factura/ })
  const huecoFactura = await hueco(enlaceFactura)
  comprobar(huecoFactura > 1, `y en la pantalla «Factura» y su número no salen pegados (${huecoFactura.toFixed(1)} px)`)
  const hrefFactura = await enlaceFactura.getAttribute('href')
  comprobar((await abrir(contexto, hrefFactura)).cabeza === '%PDF-', 'y el enlace abre el PDF de la factura')
  const hrefVoucher = await oc2.locator('td').nth(6).getByRole('link', { name: 'Voucher' }).getAttribute('href')
  comprobar((await abrir(contexto, hrefVoucher)).cabeza === '%PDF-', 'y el del voucher del pago')
  const docs3 = await columna(fila(pagina, oc[2]), 5)
  comprobar(docs3.includes('Cotización') && docs3.includes('Guía de remisión por cargar · 245.5 kg'), `la OC 3 trae la cotización y pide su guía con el peso de Logística («${docs3}»)`)
  const hrefCot = await fila(pagina, oc[2]).locator('td').nth(5).getByRole('link', { name: /Cotización/ }).getAttribute('href')
  comprobar((await abrir(contexto, hrefCot)).cabeza === '%PDF-', 'Contabilidad abre la cotización que adjuntó Logística')
  const docs4 = await columna(fila(pagina, oc[3]), 5)
  comprobar(docs4.includes('Falta la boleta, nota de venta o recibo'), `la OC con boleta dice que falta su comprobante («${docs4}»)`)
  const docsOs = await columna(fila(pagina, `QA-OS-${SUFIJO}-1`), 5)
  comprobar(docsOs.includes(`Comprobante E001-${SUFIJO}`), `la OS lleva el comprobante que se anotó al pagar («${docsOs}»)`)
  const hrefVoucherOs = await fila(pagina, `QA-OS-${SUFIJO}-1`).locator('td').nth(6).getByRole('link', { name: 'Voucher' }).getAttribute('href')
  comprobar((await abrir(contexto, hrefVoucherOs)).cabeza === '%PDF-', 'y Contabilidad abre el voucher de la OS')

  // Los filtros, con sus cuentas.
  await ir(pagina, `/adquisiciones?${buscar}&tipo=os`)
  comprobar((await pagina.locator('tbody tr').count()) === 2, 'solo las órdenes de servicio: 2')
  const pastillas = limpio(await pagina.locator('main').innerText())
  comprobar(pastillas.includes('Órdenes de compra (4)') && pastillas.includes('Órdenes de servicio (2)'), 'las pastillas cuentan 4 OC y 2 OS')
  await ir(pagina, `/adquisiciones?${buscar}&situacion=por-aprobar`)
  comprobar((await pagina.locator('tbody tr').count()) === 2, 'esperando a Gerencia: una OC y una OS')
  await ir(pagina, `/adquisiciones?${buscar}&situacion=guia`)
  comprobar((await pagina.locator('tbody tr').count()) === 1 && (await fila(pagina, oc[2]).count()) === 1, 'guía por cargar: la OC programada')
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-oc-os-contabilidad.png'), fullPage: true })

  // ------------------------------------------------ 2. La guía, desde la fila
  const tr = fila(pagina, oc[2])
  await tr.getByRole('button', { name: 'Cargar guía' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 10000 })
  comprobar(limpio(await ventana.innerText()).includes('245.5 kg'), 'la ventana dice el peso con que se emite')
  await ventana.locator('input[name="numero"]').fill(' t001- 00000403 ')
  await ventana.locator('input[name="archivo"]').setInputFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: PDF })
  // Las respuestas se pierden (la guía entra) y, en la misma ventana, se cambia la fecha antes de volver a
  // enviar: la base no da por cargada otra guía con la de la primera vez (undécima pasada, migración
  // 20261022180000). Lo dice, y la guía queda con su fecha de la primera vez.
  const fechaPrimera = await ventana.locator('input[name="fecha"]').inputValue()
  cortando = true
  await pagina.route('**/*', async (r) => {
    const q = r.request()
    if (q.method() === 'POST' && q.headers()['next-action'] && (q.postData() ?? '').includes(oc[2])) {
      await r.fetch().catch(() => {})
      return r.abort('failed')
    }
    return r.continue()
  })
  const avisoGuia = () => ventana.locator('[role="alert"]').allTextContents().then((t) => limpio(t.join(' '))).catch(() => '')
  const esperarAviso = async (cumple) => {
    for (let i = 0; i < 120 && !cumple(await avisoGuia()); i++) await pagina.waitForTimeout(250)
    return avisoGuia()
  }
  await ventana.getByRole('button', { name: 'Cargar guía' }).click()
  const primeraGuia = await esperarAviso((t) => /Vuelve a intentar ahora/.test(t))
  await pagina.unrouteAll({ behavior: 'ignoreErrors' })
  const ayer = new Date(Date.parse(`${fechaPrimera}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
  await ventana.locator('input[name="fecha"]').fill(ayer)
  await ventana.getByRole('button', { name: 'Cargar guía' }).click()
  const segundaGuia = await esperarAviso((t) => /ya quedó cargada/.test(t))
  cortando = false
  // Ya entró: sin rojo y sin «Cargar guía»; la ventana solo se cierra (duodécima pasada).
  const yaEntroGuia = {
    neutro: (await ventana.locator('[data-ya-entro]').count()) === 1,
    sinEnviar: (await ventana.getByRole('button', { name: 'Cargar guía' }).count()) === 0,
    cerrar: await ventana.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).isVisible(),
  }
  comprobar(Object.values(yaEntroGuia).every(Boolean), `ya entró: el aviso sin rojo y solo «Cerrar» (${JSON.stringify(yaEntroGuia)})`)
  await ventana.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  const [guia] = await consulta(`select id, numero, ruta, fecha_emision::text as fecha from guias_remision_compra where orden_compra_id = $1 and anulada_en is null`, [oc[2]])
  const objetos = await consulta(`select name from storage.objects where bucket_id = 'guias-remision' and name = $1`, [guia?.ruta ?? ''])
  comprobar(guia?.numero === 'T001-00000403' && objetos.length === 1, `la guía queda en la base como T001-00000403, con su PDF en storage.objects (${guia?.numero}, ${objetos.length})`)
  comprobar(/Vuelve a intentar ahora/.test(primeraGuia) && segundaGuia === 'Esta guía ya quedó cargada la primera vez que la enviaste. Si cambiaste algo después, no se guardó: al cerrar, la pantalla muestra lo que quedó.' && guia?.fecha === fechaPrimera,
    `la guía cuya respuesta se perdió no se da por cargada con otra fecha: «${primeraGuia}» → «${segundaGuia}» (queda del ${guia?.fecha})`)
  await ir(pagina, `/adquisiciones?${buscar}`)
  const conGuia = fila(pagina, oc[2])
  comprobar((await conGuia.getByRole('link', { name: 'Guía de remisión T001-00000403' }).count()) === 1, 'la fila muestra la guía')
  const huecoGuia = await hueco(conGuia.getByRole('link', { name: /Guía de remisión/ }))
  comprobar(huecoGuia > 1, `ni «Guía de remisión» y su número (${huecoGuia.toFixed(1)} px)`)
  const hrefGuia = (await conGuia.getByRole('link', { name: /Guía de remisión/ }).getAttribute('href')) ?? ''
  comprobar((await abrir(contexto, hrefGuia)).cabeza === '%PDF-', `Contabilidad abre el PDF de la guía (${hrefGuia})`)

  await conGuia.getByRole('button', { name: 'Anular guía' }).click()
  await ventana.locator('textarea[name="motivo"]').fill('Se emitió con el punto de llegada equivocado')
  await ventana.getByRole('button', { name: 'Anular guía' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  await ir(pagina, `/adquisiciones?${buscar}`)
  const docs = await columna(fila(pagina, oc[2]), 5)
  comprobar(docs.includes('Una guía anulada') && docs.includes('Guía de remisión por cargar'), `anulada, la fila la cuenta y vuelve a pedirla («${docs}»)`)
  const [anulada] = await consulta(`select motivo_anulacion from guias_remision_compra where id = $1`, [guia?.id ?? null])
  comprobar(anulada?.motivo_anulacion === 'Se emitió con el punto de llegada equivocado', 'la anulada queda en la base con su motivo')

  comprobar(await rechaza(pagina, '/compras/gestion'), 'Contabilidad no entra a Gestión de compras por la dirección')
  await contexto.close()
  globalThis.hrefGuia = hrefGuia
}

// ------------------------------------------------ 3. En el teléfono
{
  const { pagina, contexto } = await entrar('contabilidad', { width: 390, height: 844 })
  await ir(pagina, `/adquisiciones?${buscar}`)
  const tarjetas = pagina.locator('[data-orden-telefono]')
  comprobar((await tarjetas.count()) === 6, `en el teléfono, una tarjeta por orden (${await tarjetas.count()})`)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `y la página no se ensancha (${ancho} px)`)
  const t2 = limpio(await pagina.locator(`[data-orden-telefono="${nombre(oc[1])}"]`).innerText())
  comprobar(t2.includes(numeroRq) && t2.includes('Pagada en parte') && t2.includes(`Factura F001-${SUFIJO}`), `la tarjeta trae el RQ, la factura y el pago («${t2.slice(0, 160)}…»)`)
  const huecoTelefono = await hueco(pagina.locator(`[data-orden-telefono="${nombre(oc[1])}"]`).getByRole('link', { name: /Factura/ }))
  comprobar(huecoTelefono > 1, `y en la tarjeta «Factura» y su número tampoco salen pegados (${huecoTelefono.toFixed(1)} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'adquisiciones-oc-os-telefono.png'), fullPage: true })
  await contexto.close()
}

// ------------------------------------------------ 4. Tesorería y Logística
{
  const { pagina, contexto } = await entrar('tesoreria')
  await ir(pagina, `/adquisiciones?${buscar}`)
  comprobar((await pagina.locator('tbody tr').count()) === 6, 'Tesorería ve las mismas seis')
  const pago = await columna(fila(pagina, oc[1]), 6)
  comprobar(pago.includes('Pagar en Cuentas por pagar'), `y desde la fila salta a pagar el saldo («${pago}»)`)
  comprobar((await pagina.getByRole('button', { name: 'Cargar guía' }).count()) === 0, 'Tesorería no carga guías')
  comprobar((await abrir(contexto, globalThis.hrefGuia)).estado === 200, 'pero abre la guía anulada, que queda como evidencia')
  comprobar(await rechaza(pagina, '/compras/gestion'), 'y no entra a Gestión de compras')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('logistica')
  const m = await menu(pagina)
  comprobar(m.includes('Gestión de compras') && m.includes('Adquisiciones'), `el menú de Logística sigue con Gestión de compras y Adquisiciones (${m.join(', ')})`)
  await ir(pagina, `/adquisiciones?${buscar}`)
  comprobar((await pagina.locator('tbody tr').count()) === 6, 'Logística ve las seis')
  comprobar((await pagina.getByRole('button', { name: 'Cargar guía' }).count()) === 0, 'sin cargar guías')
  comprobar(!limpio(await pagina.locator('main').innerText()).includes('Guía por cargar ('), 'ni el filtro de guías por cargar, que es de Contabilidad')
  await ir(pagina, '/compras/gestion')
  comprobar(new URL(pagina.url()).pathname === '/compras/gestion' && (await pagina.getByRole('button', { name: /Guardar|Poner en la lista/ }).count()) > 0, 'en su gestión programa como siempre')

  const pdf = join(mkdtempSync(join(tmpdir(), 'adq-')), 'cotizacion.pdf')
  writeFileSync(pdf, PDF)
  const documentos = async () => (await consulta(
    `select d.tipo, (select count(*)::int from storage.objects o where o.bucket_id = 'documentos-compras' and o.name = d.ruta_storage) as objeto
       from documentos_compra_material d where d.orden_compra_id = $1 order by d.creado_en`, [oc[2]]))
  const sueltos = async () => (await consulta(
    `select count(*)::int as n from storage.objects o where o.bucket_id = 'documentos-compras' and o.name like $1
        and not exists (select 1 from documentos_compra_material d where d.ruta_storage = o.name)`, [`compra/${oc[2]}/%`]))[0].n
  await ir(pagina, '/compras/ordenes')
  await pagina.locator('tbody tr', { hasText: nombre(oc[2]) }).getByRole('button', { name: 'Adjuntar' }).click()
  const ventana = pagina.getByRole('dialog')
  const adjuntar = async (tipo) => {
    await ventana.locator('select[name="tipo"]').selectOption(tipo)
    await ventana.locator('input[type="file"]').setInputFiles(pdf)
    await ventana.getByRole('button', { name: 'Adjuntar' }).click()
    await ventana.locator('[role="alert"], [role="status"]').first().waitFor({ timeout: 20000 })
    await pagina.waitForLoadState('networkidle')
    return limpio((await ventana.locator('[role="alert"], [role="status"]').allTextContents()).join(' '))
  }
  const repetida = await adjuntar('COTIZACION')
  comprobar(repetida.includes('ya está adjunto a esta compra como «Cotización»') && (await documentos()).length === 1 && (await sueltos()) === 0,
    `la misma cotización no entra dos veces, y su PDF no queda suelto («${repetida}»)`)
  const corregida = await adjuntar('OTRO')
  const tras = await documentos()
  comprobar(corregida.includes('Documento adjuntado') && tras.length === 2 && tras[1].tipo === 'OTRO' && tras[1].objeto === 1,
    `con otro tipo sí entra, que es como se corrige uno mal elegido (${tras.map((d) => d.tipo).join(', ')})`)
  await contexto.close()
}

// ------------------------------------------------ 5. Gerencia, el conductor y Ventas
{
  const { pagina, contexto } = await entrar('gerencia')
  await ir(pagina, `/adquisiciones?${buscar}`)
  comprobar((await pagina.locator('tbody tr').count()) === 6, 'Gerencia lee Adquisiciones')
  const pago = await columna(fila(pagina, oc[1]), 6)
  comprobar(pago.includes('Ver en Cuentas por pagar') && !pago.includes('Pagar en'), `a Gerencia, que no paga, la fila la manda a mirar («${pago}»)`)
  comprobar(!limpio(await pagina.locator('main').innerText()).includes('Guía por cargar ('), 'sin el filtro de guías, que es de Contabilidad')
  comprobar(await rechaza(pagina, '/compras/gestion'), 'y no entra a Gestión de compras')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('conductor', { width: 390, height: 844 })
  const m = await menu(pagina)
  comprobar(m.includes('Recojos') && !m.includes('Adquisiciones'), `el menú del conductor lleva Recojos y no Adquisiciones (${m.join(', ')})`)
  await ir(pagina, '/compras/gestion')
  comprobar(new URL(pagina.url()).pathname === '/compras/gestion', 'el conductor abre la gestión por su dirección')
  comprobar((await pagina.getByRole('button', { name: /Guardar|Poner en la lista|Sacar de la lista|Cargar guía/ }).count()) === 0, 'sin los controles de Logística ni de Contabilidad')
  comprobar(limpio(await pagina.locator('main').innerText()).includes(nombre(oc[2])), `y ve la OC que Logística le programó (${nombre(oc[2])})`)
  comprobar(await rechaza(pagina, '/adquisiciones'), 'Adquisiciones lo rechaza')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('ventas')
  const m = await menu(pagina)
  comprobar(!m.includes('Adquisiciones') && !m.includes('Gestión de compras'), 'el menú de Ventas no lleva ninguna de las dos')
  comprobar(await rechaza(pagina, '/adquisiciones'), 'Adquisiciones lo rechaza')
  comprobar(await rechaza(pagina, '/compras/gestion'), 'y Gestión de compras también')
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
await navegador.close()
// La OC programada, fuera de la lista del conductor: no le deja pendientes a la prueba siguiente.
await como('logistica')
await consulta(`select public.quitar_recojo_de_la_lista(id) from ordenes_compra_materiales where id = $1 and recojo = 'POR_RECOGER'`, [oc[2]])
await base.end()
console.log(fallas.length === 0 ? `\nTODO EN VERDE (${SUFIJO})` : `\n${fallas.length} FALLAS`)
process.exit(fallas.length === 0 ? 0 : 1)

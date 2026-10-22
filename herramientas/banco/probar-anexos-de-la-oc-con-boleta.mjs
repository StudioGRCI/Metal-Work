/**
 * Clic real sobre lo que cerró la sexta vuelta del pedido de DKS del 20/10
 * (migración 20261020210000): la factura que Logística anexa a una OC con
 * boleta no abre un segundo pago, ni al anularla ni al registrar otra. Con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Pagada de más (décima vuelta): Tesorería pagó la OC A por su boleta y
 *      también la factura que Contabilidad registró sin OC; Logística la anexa
 *      a la OC A. La factura, ya pagada, no toma nada de la boleta: Tesorería
 *      recibe «Compra pagada de más», el encabezado la cuenta aparte y la
 *      tarjeta lo dice, con lo que se pagó de más, sin botón de pagar. En
 *      Adquisiciones sale «Pagada de más», con el voucher de la boleta y el de
 *      la factura rotulados, y el anexo en la línea de su factura: a Logística
 *      no se le ofrece anularlo (la base lo rechazaría) y la línea dice por qué
 *      y quién lo corrige.
 *   2. Anexo por revisar: Logística anexa a la OC B (boleta) una factura que
 *      Contabilidad registró para la OC C y no alcanza para las dos. Tesorería
 *      ve «Anexo por revisar» sin botón de pagar; Adquisiciones dice lo mismo.
 *      La ventana de Logística dice que lo más probable es que el anexo esté
 *      mal (sin mandar a ligar la factura, que no se puede), y lo anula (tres
 *      toques, una anulación con su motivo), Contabilidad recibe el aviso y la
 *      OC B se paga por su boleta.
 *   3. La OC que ya tiene su factura: Contabilidad registró la de la OC D
 *      eligiéndola del desplegable y Logística le anexa otra (el mismo número
 *      mal escrito). El desplegable la ofrece diciendo que la OC ya tiene la
 *      suya, avisa al elegirla, y registrarla da el error de la base sin dejar
 *      una factura más. (décima vuelta) El anexo FG de la OC G, ya pagada
 *      directo: el desplegable lo marca, al elegirlo dice que la factura queda
 *      pagada con ese pago, y Contabilidad la registra: toma el pago de la
 *      boleta sin mover la caja y la OC queda pagada.
 *   4. (décima vuelta) La factura toma lo que ya salió: la OC E tiene S/ 100
 *      a cuenta y Logística le anexa la factura FE, que Contabilidad ya
 *      registró. La factura toma esos S/ 100 y debe el resto; la tarjeta de la
 *      OC lo dice, la de la factura muestra ese pago con el voucher de la
 *      boleta y sin «Anular». Al anular el pago de la boleta, la ventana y el
 *      aviso dicen que la factura vuelve a deber todo, y lo tomado se anula.
 *   5. (séptima vuelta) El borrador que eligió un anexo que Logística anula no
 *      queda sin salida: Contabilidad registró la factura de la OC F eligiendo
 *      su anexo y el registro quedó en borrador (se cayó el último paso);
 *      Logística anula el anexo con clic, y Contabilidad completa el borrador
 *      con su PDF (antes la base lo rechazaba, y no había otra salida).
 *   6. (undécima vuelta) La factura en otra moneda toma el pago al cambio: la
 *      OC H se pagó entera en soles y su factura FH llegó en dólares. La OC
 *      dice «Factura en otra moneda» y la factura espera, sin botón de pagar.
 *      Tesorería escribe los dos montos que reconoce el proveedor y la factura
 *      los toma, sin mover la caja; lo deshace con su motivo y lo vuelve a
 *      tomar por menos, y paga el resto desde la cuenta en dólares. Gerencia
 *      no ve esos botones. En la 1, Tesorería ve «Registrar devolución» y «Lo
 *      descuenta de otra factura»; Gerencia, no.
 *   7. (DKS, 2026-10-21) Lo pagado de más de la OC A se descuenta de otra
 *      factura del proveedor con la nota de crédito o el documento del
 *      descuento: sin él no se envía y no entra nada; con él, tres toques
 *      dejan una toma, el archivo queda en storage.objects y en el disco, la
 *      OC deja de estar pagada de más y la factura muestra «Nota de crédito o
 *      documento», que abre.
 *   8. (duodécima vuelta) Lo pagado de más sale de dos pagos: la OC I se pagó
 *      en dos partes y su factura FI, por S/ 100, tomó del primero. El
 *      descuento de los S/ 261.50 que sobran se reparte en dos tomas y una
 *      sola nota de crédito: las dos dicen «Nota de crédito o documento» en
 *      Tesorería y en la pestaña Facturas, ninguna «Voucher de la boleta».
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

// ---------------------------------------------------------------- siembra
// Sin cero adelante: la base normaliza «F001-012345» a «F001-12345» y el número no se encontraría.
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `PROVEEDOR ANEXOS ${SUFIJO}`
const FX = `F071-${SUFIJO}`
const FY = `F072-${SUFIJO}`
const FZ = `F073-${SUFIJO}`
// La misma factura con un dígito de más: la que Logística anexa por error.
const FZ_MAL = `F073-${SUFIJO}9`
const FE = `F074-${SUFIJO}`
const FF = `F075-${SUFIJO}`
const FG = `F076-${SUFIJO}`
const FH = `F077-${SUFIJO}`
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
const nuevoId = async () => (await consulta(`select gen_random_uuid() as id`))[0].id

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
await consulta(`insert into proveedor_cuentas (proveedor_id, banco, numero_cuenta, titular, moneda) values ($1, 'BCP', $2, $3, 'PEN')`, [
  proveedor,
  `1910${SUFIJO}0088`,
  PROVEEDOR,
])
const [{ id: caja }] = await consulta(
  `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
   values ($1, 'BANCO', 'BANCO DE PRUEBA', 'PEN', 10000, $2::date - 30, $3) returning id`,
  [`Banco anexos ${SUFIJO}`, hoy, ids[CUENTAS.tesoreria]],
)
// La cuenta en dólares, de la que se paga lo que le falta a la factura en dólares (6).
const CAJA_USD = `Dólares anexos ${SUFIJO}`
await consulta(
  `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
   values ($1, 'BANCO', 'BANCO DE PRUEBA', 'USD', 5000, $2::date - 30, $3)`,
  [CAJA_USD, hoy, ids[CUENTAS.tesoreria]],
)
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`ANEXOS-${SUFIJO}`, `Plancha LAF 3 mm 4x8 (${SUFIJO})`, cat, und],
)
const rq = await nuevoId()
await como('requerimientos')
await consulta(
  `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/21', $3, null,
     (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3, 'unidad_medida_id', $4::text, 'categoria_id', $5::text))
        from generate_series(1, 9) n))`,
  [rq, area, `Prueba de los anexos de la OC con boleta ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
// A, B, D, E, F, G, H e I van con boleta; C, con factura.
await como('logistica')
const oc = {}
for (const [clave, item, conFactura] of [['A', 1, false], ['B', 2, false], ['C', 3, true], ['D', 4, false], ['E', 5, false], ['F', 6, false], ['G', 7, false], ['H', 8, false], ['I', 9, false]]) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
       jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 3, 'precio', 120.50)), null, 'CONTADO', 0, 'PEN', $5) as id`,
    [rq, item, proveedor, material, conFactura],
  )
  oc[clave] = id
}
await como('gerencia')
for (const id of Object.values(oc)) await consulta(`select public.aprobar_compra($1)`, [id])
const numeros = Object.fromEntries((await consulta(`select id, numero from ordenes_compra_materiales where id = any($1)`, [Object.values(oc)])).map((f) => [f.id, f.numero]))
const nombre = (id) => numeros[id] ?? 'OC sin número'
const [{ total }] = await consulta(`select public.total_orden_compra($1)::float as total`, [oc.A])

/**
 * Una factura que Contabilidad registra, con su PDF propio o el del anexo que
 * eligió; como `registrarAdquisicion`: la primera OC va en la factura y las
 * demás se ligan aparte.
 */
async function registrar(numero, [principal = null, ...resto], { documento = null, moneda = 'PEN', monto = total } = {}) {
  const id = await nuevoId()
  await como('contabilidad')
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, orden_compra_id, documento_compra_id)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $4::date, $8, $5, 'CONTADO', $6, $7)`,
    [id, PROVEEDOR, numero, hoy, monto, principal, documento, moneda],
  )
  for (const o of resto) await consulta(`insert into adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values ($1, $2)`, [id, o])
  const ruta = documento ? null : await subir('comprobantes-financieros', `adquisiciones/${id}/comprobante.pdf`, 'contabilidad')
  await consulta(`update adquisiciones set ruta_storage = coalesce($2, ruta_storage), estado = 'REGISTRADA' where id = $1`, [id, ruta])
  return id
}
/** La factura que el proveedor entregó y Logística anexa a la OC, como lo deja «Adjuntar». */
async function anexar(orden, numero) {
  const id = await nuevoId()
  await como('logistica')
  await subir('documentos-compras', `compra/${orden}/${id}.pdf`, 'logistica')
  await consulta(
    `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision)
     values ($1, $2, 'FACTURA', 'factura.pdf', $3, 'application/pdf', $4, $5, $6, $7::date)`,
    [id, orden, `compra/${orden}/${id}.pdf`, PDF.length, ids[CUENTAS.logistica], numero, hoy],
  )
  return id
}

// 1. La OC A se paga por su boleta; la factura FX, registrada sin OC, también; después Logística la anexa.
const pagoA = await nuevoId()
await como('tesoreria')
const voucherA = await subir('pagos-compras', `${oc.A}/${pagoA}.pdf`, 'tesoreria')
await consulta(`select public.registrar_pago_compra($1, $2, $3::date, $4, true, null, null, $5, $6, null)`, [pagoA, oc.A, hoy, total, voucherA, caja])
const facturaX = await registrar(FX, [])
const pagoX = await nuevoId()
await como('tesoreria')
const voucherX = await subir('pagos-facturas', `${facturaX}/${pagoX}.pdf`, 'tesoreria')
await consulta(`select public.registrar_pago_factura($1, $2, $3::date, $4, 'OP-ANEXOS', $5, $6, null)`, [pagoX, facturaX, hoy, total, voucherX, caja])
const anexoX = await anexar(oc.A, FX)
// 2. FY se registró para la OC C, por su total: no alcanza para la B, a la que Logística la anexa.
await registrar(FY, [oc.C])
const anexoY = await anexar(oc.B, FY)
// 3. La OC D tiene su factura FZ, registrada eligiendo el anexo; Logística le anexa otra con el número mal escrito.
const anexoZ = await anexar(oc.D, FZ)
await registrar(FZ, [oc.D], { documento: anexoZ })
const anexoZMal = await anexar(oc.D, FZ_MAL)
// 4. La OC E tiene S/ 100 a cuenta; FE se registró sin OC y Logística la anexa.
const pagoE = await nuevoId()
await como('tesoreria')
const voucherE = await subir('pagos-compras', `${oc.E}/${pagoE}.pdf`, 'tesoreria')
await consulta(`select public.registrar_pago_compra($1, $2, $3::date, 100, false, null, null, $4, $5, null)`, [pagoE, oc.E, hoy, voucherE, caja])
await registrar(FE, [])
await anexar(oc.E, FE)
// 3b. La OC G ya se pagó entera por su boleta y Logística le anexa FG, que nadie registró.
const pagoG = await nuevoId()
await como('tesoreria')
const voucherG = await subir('pagos-compras', `${oc.G}/${pagoG}.pdf`, 'tesoreria')
await consulta(`select public.registrar_pago_compra($1, $2, $3::date, $4, true, null, null, $5, $6, null)`, [pagoG, oc.G, hoy, total, voucherG, caja])
await anexar(oc.G, FG)
// 6. La OC H se pagó entera en soles; su factura FH llegó en dólares y Contabilidad la registró con la OC.
const pagoH = await nuevoId()
await como('tesoreria')
const voucherH = await subir('pagos-compras', `${oc.H}/${pagoH}.pdf`, 'tesoreria')
await consulta(`select public.registrar_pago_compra($1, $2, $3::date, $4, true, null, null, $5, $6, null)`, [pagoH, oc.H, hoy, total, voucherH, caja])
const facturaH = await registrar(FH, [oc.H], { moneda: 'USD', monto: 97.7 })
// 8. La OC I se pagó en dos partes y su factura FI, por S/ 100, la cubre entera: sobran S/ 261.50.
const FI = `F079-${SUFIJO}`
for (const parte of [200, total - 200]) {
  const pago = await nuevoId()
  await como('tesoreria')
  const voucher = await subir('pagos-compras', `${oc.I}/${pago}.pdf`, 'tesoreria')
  await consulta(`select public.registrar_pago_compra($1, $2, $3::date, $4, false, null, null, $5, $6, null)`, [pago, oc.I, hoy, parte, voucher, caja])
}
await registrar(FI, [oc.I], { monto: 100 })
// 5. Contabilidad eligió el anexo FF de la OC F y el registro quedó en borrador.
const anexoF = await anexar(oc.F, FF)
const borradorF = await nuevoId()
await como('contabilidad')
await consulta(
  `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, orden_compra_id, documento_compra_id)
   values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $4::date, 'PEN', $5, 'CONTADO', $6, $7)`,
  [borradorF, PROVEEDOR, FF, hoy, total, oc.F, anexoF],
)
await como(null)
console.log(
  `Sembrado ${SUFIJO}: ${nombre(oc.A)} pagada de más (${FX}), ${nombre(oc.B)} con el anexo ${FY} de la ${nombre(oc.C)}, ${nombre(oc.D)} con ${FZ} y el anexo ${FZ_MAL}`,
)

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
const anulado = async (id) => (await consulta(`select anulado_en, anulado_por, motivo_anulacion from documentos_compra_material where id = $1`, [id]))[0]

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto) {
  const correo = CUENTAS[puesto]
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
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
/** Abre «Anular» del anexo en la fila de su OC y lo intenta con su motivo; devuelve el texto de la ventana y el error, si lo hubo. */
async function anularAnexo(pagina, orden, numero, motivo, toques = 1) {
  await pagina.locator(`tr[data-orden="${nombre(orden)}"]`).getByRole('button', { name: `Anular la factura ${numero} de la ${nombre(orden)}` }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill(motivo)
  const ventana = limpio(await v.innerText())
  const boton = v.getByRole('button', { name: 'Anular', exact: true })
  if (toques === 3) await tresToques(boton)
  else await boton.click()
  return { ventana, error: await esperarVentana(pagina) }
}

// ---------------------------------------------------------------- 1. Pagada de más
const cifra = (n) => new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
{
  const [aviso] = await consulta(
    `select cuerpo from notificaciones where usuario_id = $1 and origen_id = $2 and titulo = $3`,
    [ids[CUENTAS.tesoreria], oc.A, `Compra pagada de más: ${nombre(oc.A)}`],
  )
  comprobar(Boolean(aviso?.cuerpo?.includes(`y también por su factura ${FX}`)), `a Tesorería le llegó «Compra pagada de más»: ${limpio(aviso?.cuerpo).slice(0, 160)}`)
  comprobar((await pagoSegunAdquisiciones(oc.A)) === 'PAGADA_DE_MAS', 'Adquisiciones dice que la OC A está pagada de más')
  const [{ n: tomado }] = await consulta(`select count(*)::int as n from pagos_adquisicion where adquisicion_id = $1 and pago_orden_compra_id is not null and anulado_en is null`, [facturaX])
  comprobar(tomado === 0, 'la factura, ya pagada, no tomó nada de la boleta')
  const deMas = cifra(total)

  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const encabezado = limpio(await pagina.locator('main').first().innerText().catch(() => '')).slice(0, 800)
  const cuenta = encabezado.match(/(una OC pagada|\d+ OC pagadas) de más/)?.[0]
  comprobar(Boolean(cuenta), `el encabezado cuenta las pagadas de más aparte: ${cuenta ?? encabezado.slice(0, 200)}`)
  const tarjeta = pagina.locator(`article#compra-${oc.A}`)
  const texto = limpio(await tarjeta.innerText().catch(() => ''))
  console.log(`       la tarjeta de la A: ${texto.slice(0, 500)}`)
  comprobar(texto.includes('Pagada de más') && texto.includes(FX) && texto.includes(`no tomó nada de lo pagado por la boleta, y se pagaron S/ ${deMas} de más`),
    'la tarjeta dice «Pagada de más»: su factura no tomó nada y cuánto se pagó de más')
  comprobar(texto.includes('Pide al proveedor la devolución'), 'y pide la devolución')
  comprobar(texto.includes(`Pagado de más S/ ${deMas}`) && texto.includes('Pagada por su factura'), 'muestra lo pagado de más, y que la factura ya está pagada')
  comprobar((await tarjeta.locator('[data-pagar-compra]').count()) === 0, 'sin botón de pagar')
  comprobar((await tarjeta.locator('[data-registrar-devolucion]').count()) === 1 && (await tarjeta.locator('[data-descontar-de-otra]').count()) === 1,
    'ofrece «Registrar devolución» y «Lo descuenta de otra factura» (undécima vuelta)')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-1-tesoreria.png`, fullPage: true })
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(nombre(oc.A))}`, { waitUntil: 'networkidle' })
  const fila = limpio(await pagina.locator(`tr[data-orden="${nombre(oc.A)}"]`).innerText().catch(() => ''))
  console.log(`       la fila de la A para Tesorería: ${fila.slice(0, 500)}`)
  comprobar(fila.includes('Pagada de más') && fila.includes('Pedir la devolución en Cuentas por pagar'), 'Adquisiciones dice «Pagada de más» y lleva a pedir la devolución')
  comprobar(fila.includes('Voucher de la boleta') && fila.includes('Voucher de la factura'), 'cada voucher dice si es de la boleta o de la factura')
  comprobar(!fila.includes('Pagar en Cuentas por pagar'), 'y no manda a pagar su factura, que ya está pagada')
  await contexto.close()
  // Gerencia lee lo pagado de más sin los botones de Tesorería.
  const g = await entrar('gerencia')
  await g.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjetaG = g.pagina.locator(`article#compra-${oc.A}`)
  comprobar(
    limpio(await tarjetaG.innerText().catch(() => '')).includes('Tesorería pide al proveedor la devolución') &&
      (await tarjetaG.locator('[data-registrar-devolucion], [data-descontar-de-otra]').count()) === 0,
    'Gerencia lee quién pide la devolución y no ve sus botones',
  )
  await g.contexto.close()
}
{
  const { pagina, contexto } = await entrar('logistica')
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(nombre(oc.A))}`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`tr[data-orden="${nombre(oc.A)}"]`)
  const texto = limpio(await fila.innerText().catch(() => ''))
  console.log(`       la fila de la A para Logística: ${texto.slice(0, 500)}`)
  comprobar((await fila.getByRole('button', { name: `Anular la factura ${FX} de la ${nombre(oc.A)}` }).count()) === 0, 'a Logística no se le ofrece anular el anexo de la factura ya pagada')
  comprobar(texto.includes(`No se anula: la factura ${FX} ya tiene pagos`) && texto.includes('Contabilidad corrige la factura'), 'la línea dice por qué y quién lo corrige')
  comprobar(texto.split(`Factura ${FX}`).length - 1 === 1 && texto.includes('por el anexo de Logística'), 'el anexo va en la línea de su factura, una sola vez')
  comprobar(texto.includes('Tesorería pide al proveedor la devolución'), 'y Logística lee a quién espera la devolución')
  comprobar(!(await anulado(anexoX))?.anulado_en, 'el anexo sigue vigente en la base')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-1-logistica.png`, fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 2. Anexo por revisar
{
  comprobar((await pagoSegunAdquisiciones(oc.B)) === 'ANEXO_POR_REVISAR', 'Adquisiciones dice «Anexo por revisar» de la OC B')
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`article#compra-${oc.B}`)
  const texto = limpio(await tarjeta.innerText().catch(() => ''))
  console.log(`       la tarjeta de la B: ${texto.slice(0, 400)}`)
  comprobar(texto.includes('Anexo por revisar') && texto.includes('no alcanza para esta') && texto.includes(FY), 'la tarjeta dice «Anexo por revisar» con la factura')
  comprobar(texto.includes('No se paga hasta revisar el anexo'), 'y que no se paga hasta revisarlo')
  comprobar((await tarjeta.locator('[data-pagar-compra]').count()) === 0, 'sin botón de pagar')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const fila = limpio(await pagina.locator(`tr[data-orden="${nombre(oc.B)}"]`).innerText().catch(() => ''))
  comprobar(fila.includes('Anexo por revisar') && fila.includes('Logística revisa la factura que anexó'), 'la fila de Adquisiciones dice lo mismo y quién lo revisa')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('logistica')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const { ventana, error } = await anularAnexo(pagina, oc.B, FY, 'Era la factura de la otra OC del mismo proveedor', 3)
  comprobar(ventana.includes('lo más probable es que el anexo esté mal') && ventana.includes(FY) && ventana.includes('la OC se paga por su boleta') && !ventana.includes('vuelve a pagarse') && !ventana.includes('ligue'),
    'la ventana dice que lo más probable es que el anexo esté mal, que la OC se paga por su boleta, y no manda a ligar la factura')
  comprobar(error === '', `la ventana se cerró sin error${error ? `: ${error}` : ''}`)
  const fila = await hasta(() => anulado(anexoY), (f) => f?.anulado_en)
  comprobar(Boolean(fila?.anulado_en) && fila.anulado_por === ids[CUENTAS.logistica] && fila.motivo_anulacion?.startsWith('Era la factura'), 'el anexo queda anulado, con quién y su motivo')
  const [{ n: anulaciones }] = await consulta(
    `select count(*)::int as n from audit_log where tabla = 'documentos_compra_material' and registro_id = $1 and accion = 'UPDATE'`,
    [anexoY],
  ).catch(() => [{ n: -1 }])
  if (anulaciones >= 0) comprobar(anulaciones === 1, `tres toques, una anulación (${anulaciones} en la auditoría)`)
  // La fila se vuelve a pintar después de cerrar la ventana: se espera a que llegue.
  const tachada = await hasta(
    async () => limpio(await pagina.locator(`tr[data-orden="${nombre(oc.B)}"]`).innerText().catch(() => '')),
    (t) => t.includes(FY) && t.includes('Era la factura'),
  )
  comprobar(tachada.includes(FY) && tachada.includes('Era la factura'), 'la fila la muestra tachada con su motivo')
  const [{ n: avisos }] = await consulta(`select count(*)::int as n from notificaciones where usuario_id = $1 and cuerpo like '%' || $2 || '%'`, [
    ids[CUENTAS.contabilidad],
    FY,
  ])
  comprobar(avisos >= 1, `Contabilidad recibió el aviso de la anulación (${avisos})`)
  // FY es de la OC C y no tiene pagos: si la B era parte de ella, que Tesorería no la pague dos veces.
  const [ojo] = await consulta(`select cuerpo from notificaciones where usuario_id = $1 and origen_id = $2 and titulo like 'La OC vuelve a pagarse por su boleta: %'`, [
    ids[CUENTAS.tesoreria],
    anexoY,
  ])
  comprobar(Boolean(ojo?.cuerpo?.includes(`Ojo: la factura ${FY} está registrada para otras OC`)), `Tesorería recibe el «Ojo» de la factura de otras OC: «${ojo?.cuerpo ?? ''}»`)
  comprobar((await pagoSegunAdquisiciones(oc.B)) === 'POR_PAGAR', 'la OC B vuelve a estar por pagar')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-2-logistica.png`, fullPage: true })
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`article#compra-${oc.B}`)
  comprobar((await tarjeta.locator('[data-pagar-compra]').count()) === 1, 'Tesorería ya puede pagar la OC B por su boleta («Registrar pago»)')
  await contexto.close()
}

// ---------------------------------------------------------------- 3. La OC que ya tiene su factura
{
  const { pagina, contexto } = await entrar('contabilidad')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const opciones = (await pagina.locator('#adq-documento option').allTextContents()).map(limpio)
  const opcion = opciones.find((o) => o.includes(FZ_MAL))
  console.log(`       la opción: ${opcion}`)
  comprobar(Boolean(opcion?.includes(`la OC ya tiene la ${FZ}`)), 'el desplegable ofrece el anexo diciendo que su OC ya tiene su factura')
  comprobar(!opciones.some((o) => o.startsWith(`${FZ} `) || o === FZ), `y no vuelve a ofrecer la ${FZ} ya registrada`)
  const valor = await pagina.locator('#adq-documento option', { hasText: FZ_MAL }).getAttribute('value')
  await pagina.locator('#adq-documento').selectOption(valor)
  await pagina.waitForTimeout(800)
  const formulario = pagina.locator('form:has(#adq-total)')
  const aviso = limpio(await formulario.innerText())
  comprobar(aviso.includes(`ya tiene registrada la factura ${FZ}`) && aviso.includes(`corrige la ${FZ}`), 'al elegirlo avisa qué hacer')
  await formulario.getByText('Leyendo la factura…').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {})
  await pagina.locator('#adq-total').fill(String(total))
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await formulario.locator('[role="alert"]').first().waitFor({ timeout: 30000 }).catch(() => {})
  const error = limpio(await formulario.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' | ')).catch(() => ''))
  console.log(`       el error: ${error}`)
  comprobar(error.includes('ya tiene su factura') && error.includes(FZ), 'registrarlo da el error de la base, con la factura que ya tiene')
  const [{ n }] = await consulta(`select count(*)::int as n from adquisiciones where numero_documento = $1`, [FZ_MAL])
  comprobar(n === 0, 'y no deja una factura más')
  // 3b. El anexo de una OC ya pagada directo: registrada, la factura toma ese pago.
  const opcionG = opciones.find((o) => o.includes(FG))
  comprobar(Boolean(opcionG?.includes('la OC ya se pagó por su boleta')), `el desplegable marca el anexo de la OC pagada directo: «${opcionG}»`)
  await pagina.reload({ waitUntil: 'networkidle' })
  const formularioG = pagina.locator('form:has(#adq-total)')
  await pagina.locator('#adq-documento').selectOption(await pagina.locator('#adq-documento option', { hasText: FG }).getAttribute('value'))
  await pagina.waitForTimeout(800)
  const avisoG = limpio(await formularioG.innerText())
  comprobar(avisoG.includes('al registrarla, la factura toma ese pago y Tesorería solo paga lo que falte'), 'al elegirlo dice que la factura toma ese pago')
  const boton = pagina.getByRole('button', { name: 'Registrar comprobante' })
  comprobar(!(await boton.isDisabled()), '«Registrar comprobante» sigue disponible')
  await formularioG.getByText('Leyendo la factura…').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {})
  await pagina.locator('#adq-total').fill(String(total))
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await tresToques(boton)
  await Promise.race([
    pagina.locator('p[role="status"]', { hasText: FG }).waitFor({ timeout: 30000 }),
    formularioG.locator('[role="alert"]').first().waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  const errorG = limpio(await formularioG.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' | ')).catch(() => ''))
  const estadoG = limpio(await pagina.locator('p[role="status"]', { hasText: FG }).first().textContent().catch(() => ''))
  console.log(`       al registrar la ${FG}: ${estadoG || errorG}`)
  comprobar(!errorG, `Contabilidad la registra${errorG ? ` (dijo «${errorG}»)` : ''}`)
  comprobar(estadoG.includes(`tomó lo que Tesorería pagó por la boleta de la ${nombre(oc.G)}, S/ ${cifra(total)}, y no le falta nada`),
    'y el aviso dice que tomó lo que Tesorería pagó por la boleta y no le falta nada')
  const facturasG = await hasta(
    () => consulta(`select id, estado from adquisiciones where numero_documento = $1`, [FG]),
    (f) => f.length > 0 && f[0].estado === 'REGISTRADA',
  )
  comprobar(facturasG.length === 1 && facturasG[0].estado === 'REGISTRADA', `tres toques, una factura registrada (${facturasG.length})`)
  const tomadoG = facturasG[0]
    ? await consulta(`select x.id, x.monto::float as monto, x.pago_orden_compra_id from pagos_adquisicion x where x.adquisicion_id = $1 and x.anulado_en is null`, [facturasG[0].id])
    : []
  comprobar(tomadoG.length === 1 && tomadoG[0].pago_orden_compra_id === pagoG && tomadoG[0].monto === total, 'la factura toma el pago de la boleta, entero')
  const [{ n: movimientosG }] = await consulta(`select count(*)::int as n from movimientos_caja where origen_id = any($1::uuid[])`, [tomadoG.map((t) => t.id)])
  const [{ n: egresosG }] = await consulta(`select count(*)::int as n from movimientos_caja where origen_id = $1 and anulado_en is null`, [pagoG])
  comprobar(movimientosG === 0 && egresosG === 1, 'sin mover la caja otra vez: el egreso sigue siendo el de la boleta')
  comprobar((await pagoSegunAdquisiciones(oc.G)) === 'PAGADA', 'y la OC G queda pagada')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-3-contabilidad.png`, fullPage: true })
  await contexto.close()
}
comprobar(!(await anulado(anexoZMal))?.anulado_en, 'el anexo mal escrito sigue esperando a Logística')

// ---------------------------------------------------------------- 4. La factura toma lo que ya salió
{
  const resto = cifra(Math.round((total - 100) * 100) / 100)
  const [facturaE] = await consulta(`select id from adquisiciones where numero_documento = $1`, [FE])
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`article#compra-${oc.E}`)
  const texto = limpio(await tarjeta.innerText().catch(() => ''))
  console.log(`       la tarjeta de la E: ${texto.slice(0, 400)}`)
  comprobar(texto.includes('Se paga por su factura') && texto.includes(`tomó S/ 100.00 de lo pagado por la boleta y le faltan S/ ${resto}`),
    'la tarjeta de la OC dice que su factura tomó los S/ 100.00 y cuánto le falta')
  comprobar((await tarjeta.locator('[data-pagar-compra]').count()) === 0, 'y no ofrece pagarla por la boleta')
  const factura = pagina.locator(`article#factura-${facturaE.id}`)
  const textoFactura = limpio(await factura.innerText().catch(() => ''))
  console.log(`       la tarjeta de la ${FE}: ${textoFactura.slice(0, 400)}`)
  comprobar(textoFactura.includes(`Saldo S/ ${resto}`) && textoFactura.includes(`Pago por la boleta de la ${nombre(oc.E)}`) && textoFactura.includes('Voucher de la boleta'),
    'la factura debe el resto y muestra el pago de la boleta con su voucher')
  comprobar(textoFactura.includes('Lo pagó su OC con boleta') && (await factura.locator('[data-anular-pago-factura]').count()) === 0,
    'ese pago no se anula en la factura: lleva a su OC')
  const voucher = await factura.getByRole('link', { name: 'Voucher de la boleta' }).getAttribute('href').catch(() => null)
  const respuesta = voucher ? await contexto.request.get(voucher).catch(() => null) : null
  comprobar(respuesta?.status() === 200, `el voucher de la boleta abre desde la factura (${respuesta?.status() ?? 'sin enlace'})`)
  await pagina.locator(`[data-anular-pago-compra="${pagoE}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  // El pago no salió: es lo único que deja anular (undécima vuelta).
  await v.locator('input[name="que_paso"][value="no_salio"]').check()
  const ventana = limpio(await v.innerText())
  comprobar(ventana.includes(`Su factura ${FE} deja de tomar este pago y le faltan S/ ${cifra(total)}`), `la ventana dice que la factura vuelve a deber todo: «${ventana.slice(0, 300)}»`)
  await v.locator('textarea[name="motivo"]').fill('El pago no salió: el banco lo rechazó')
  await v.getByRole('button', { name: 'Anular' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `anula el pago${error ? ` (dijo «${error}»)` : ''}`)
  const aviso = limpio(await hasta(() => pagina.locator('p.sr-only[role="status"]').first().textContent().catch(() => ''), (t) => Boolean(t), 5000))
  console.log(`       el aviso: ${aviso.slice(0, 300)}`)
  comprobar(aviso.includes(`su factura ${FE} ya no toma ese pago y le faltan S/ ${cifra(total)}`), 'el aviso de después dice lo mismo')
  const [{ n }] = await consulta(`select count(*)::int as n from pagos_orden_compra where id = $1 and anulado_en is not null`, [pagoE])
  comprobar(n === 1, 'el pago quedó anulado en la base')
  const [tomado] = await consulta(
    `select count(*) filter (where anulado_en is null)::int as vigentes, max(motivo_anulacion) as motivo
       from pagos_adquisicion where adquisicion_id = $1 and pago_orden_compra_id = $2`,
    [facturaE.id, pagoE],
  )
  comprobar(tomado.vigentes === 0 && Boolean(tomado.motivo?.startsWith('Se anuló el pago de la boleta')), 'y lo que la factura había tomado también, con su motivo')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-4-tesoreria.png`, fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 5. El borrador del anexo anulado se completa
{
  const { pagina, contexto } = await entrar('logistica')
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(nombre(oc.F))}`, { waitUntil: 'networkidle' })
  const { error } = await anularAnexo(pagina, oc.F, FF, 'No era de esta OC: el proveedor la mandó por error')
  comprobar(error === '', `Logística anula el anexo${error ? `: ${error}` : ''}`)
  const doc = await hasta(() => anulado(anexoF), (f) => f?.anulado_en)
  comprobar(Boolean(doc?.anulado_en), 'el anexo queda anulado en la base')
  const [suelto] = await consulta(`select documento_compra_id, estado from adquisiciones where id = $1`, [borradorF])
  comprobar(suelto?.estado === 'BORRADOR' && suelto.documento_compra_id === null, 'y el borrador que lo eligió lo suelta')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('contabilidad')
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const formulario = pagina.locator(`form:has(input[name="id"][value="${borradorF}"]):visible`).first()
  comprobar((await formulario.count()) === 1, 'Contabilidad ve «Completar comprobante» en su borrador')
  await formulario.locator('input[type="file"]').setInputFiles({ name: 'factura.pdf', mimeType: 'application/pdf', buffer: PDF })
  await formulario.getByRole('button', { name: 'Completar comprobante' }).click()
  await Promise.race([
    formulario.locator('[role="status"]').waitFor({ timeout: 30000 }),
    formulario.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  const error = limpio(await formulario.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' | ')).catch(() => ''))
  comprobar(!error, `lo completa con su PDF${error ? ` (dijo «${error}»)` : ''}`)
  const fila = await hasta(async () => (await consulta(`select estado, ruta_storage from adquisiciones where id = $1`, [borradorF]))[0], (f) => f?.estado === 'REGISTRADA')
  comprobar(fila?.estado === 'REGISTRADA' && Boolean(fila.ruta_storage), 'y queda registrado, con su PDF')
  const [{ n }] = await consulta(`select count(*)::int as n from storage.objects where bucket_id = 'comprobantes-financieros' and name = $1`, [fila?.ruta_storage ?? ''])
  comprobar(n === 1, 'el PDF está en el almacenamiento')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-5-contabilidad.png`, fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 6. La factura en otra moneda toma el pago al cambio
{
  const movimientos = async () => (await consulta(`select count(*)::int as n from movimientos_caja where caja_id in (select id from cajas where nombre = any($1))`, [[`Banco anexos ${SUFIJO}`, CAJA_USD]]))[0].n
  const antes = await movimientos()
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`article#compra-${oc.H}`)
  const texto = limpio(await tarjeta.innerText().catch(() => ''))
  console.log(`       la tarjeta de la H: ${texto.slice(0, 400)}`)
  comprobar(texto.includes('Factura en otra moneda') && texto.includes(`Quedan S/ ${cifra(total)} por pasar a su factura`), 'la OC dice «Factura en otra moneda» y lo que queda por pasarle')
  comprobar((await tarjeta.locator('[data-tomar-al-cambio]').count()) === 1 && (await tarjeta.locator('[data-pagar-compra]').count()) === 0,
    'ofrece «La factura lo toma al cambio» y no pagar la OC')
  const factura = pagina.locator(`article#factura-${facturaH}`)
  comprobar(limpio(await factura.innerText().catch(() => '')).includes('Espera lo pagado por la boleta') && (await factura.locator('[data-pagar-factura]').count()) === 0,
    'la factura espera lo pagado por la boleta, sin botón de pagar')

  // Al cambio, por lo que reconoce el proveedor.
  const tomar = async (enDolares) => {
    await pagina.locator(`article#compra-${oc.H} [data-tomar-al-cambio]`).click()
    const v = pagina.locator('[role="dialog"]')
    await v.waitFor()
    comprobar(Number(await v.locator('input[name="monto_boleta"]').inputValue()) === total, `trae lo pagado por la boleta: S/ ${cifra(total)}`)
    await v.locator('input[name="monto_factura"]').fill(enDolares)
    const enVivo = limpio(await v.locator('p[role="status"]').first().textContent().catch(() => ''))
    await tresToques(v.getByRole('button', { name: 'Pasar a la factura' }))
    const error = await esperarVentana(pagina)
    comprobar(!error, `la factura lo toma${error ? ` (dijo «${error}»)` : ''}`)
    const aviso = limpio(await hasta(() => pagina.locator('p.sr-only[role="status"]').first().textContent().catch(() => ''), (t) => t.includes('toma'), 5000))
    return { enVivo, aviso }
  }
  const primera = await tomar('97.70')
  comprobar(primera.enVivo.includes('Sale a S/ 3.700 por dólar'), `dice el cambio mientras se escribe: «${primera.enVivo}»`)
  comprobar(primera.aviso.includes('toma US$ 97.70') && primera.aviso.includes('Queda pagada'), `el aviso dice lo que tomó y que queda pagada: «${primera.aviso}»`)
  const tomas = await consulta(`select monto::float as monto, monto_de_la_boleta::float as boleta from pagos_adquisicion where adquisicion_id = $1 and anulado_en is null`, [facturaH])
  comprobar(tomas.length === 1 && tomas[0].monto === 97.7 && tomas[0].boleta === total, `tres toques, una toma de US$ 97.70 por S/ ${cifra(total)} (${tomas.length})`)
  comprobar((await movimientos()) === antes, 'sin mover la caja')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tomada = limpio(await pagina.locator(`article#compra-${oc.H}`).textContent().catch(() => ''))
  comprobar(tomada.includes('Pagada por su factura') && tomada.includes('tomó al cambio'), `la OC queda «Pagada por su factura», que la tomó al cambio: «${tomada.slice(0, 260)}»`)
  const enFactura = pagina.locator(`article#factura-${facturaH}`)
  comprobar(limpio(await enFactura.textContent().catch(() => '')).includes('Tomado al cambio del pago por la boleta') && (await enFactura.locator('[data-soltar-toma]').count()) === 1,
    'la factura muestra la toma al cambio, con «Deshacer»')

  // Todo lo pagado lo tomó a mano la factura: «me lo devolvió» manda a deshacer la toma primero, sin un botón a una ventana que no está.
  const laH = pagina.locator(`article#compra-${oc.H}`)
  const plegadaH = pagina.locator('details', { has: laH })
  if ((await plegadaH.count()) > 0 && !(await plegadaH.first().evaluate((d) => d.open))) await plegadaH.first().locator('summary').click()
  await laH.locator(`[data-anular-pago-compra="${pagoH}"]`).click()
  const va = pagina.locator('[role="dialog"]')
  await va.locator('input[name="que_paso"][value="devolvio"]').check()
  const devolvio = limpio(await va.textContent())
  comprobar(devolvio.includes('ya lo tomó a mano la factura') && devolvio.includes('«Deshacer»')
    && (await va.locator('[data-ir-a-devolucion]').count()) === 0 && (await va.locator(`a[href="#factura-${facturaH}"]`).count()) === 1,
    `con todo tomado a mano, «me lo devolvió» manda a deshacer la toma en su factura: «${devolvio.slice(0, 260)}»`)
  await va.getByRole('button', { name: 'Cancelar' }).click()

  // Deshacer, con su motivo: vuelve a esperar.
  const detalles = pagina.locator('details', { has: enFactura })
  if ((await detalles.count()) > 0 && !(await detalles.first().evaluate((d) => d.open))) await detalles.first().locator('summary').click()
  await enFactura.locator('[data-soltar-toma]').click()
  const vs = pagina.locator('[role="dialog"]')
  await vs.locator('textarea[name="motivo"]').fill('El proveedor reconoce otro cambio')
  await vs.getByRole('button', { name: 'Deshacer' }).click()
  const errorSoltar = await esperarVentana(pagina)
  comprobar(!errorSoltar, `deshace la toma${errorSoltar ? ` (dijo «${errorSoltar}»)` : ''}`)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar(limpio(await pagina.locator(`article#compra-${oc.H}`).innerText().catch(() => '')).includes('Factura en otra moneda'), 'la OC vuelve a «Factura en otra moneda»')

  // Por menos: la factura debe el resto y se paga desde la cuenta en dólares.
  await tomar('95.00')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const debe = pagina.locator(`article#factura-${facturaH}`)
  comprobar(limpio(await debe.innerText().catch(() => '')).includes('Saldo US$ 2.70') && (await debe.locator('[data-pagar-factura]').count()) === 1,
    'tomada por US$ 95.00, la factura debe US$ 2.70 y ya se paga')
  await debe.locator('[data-pagar-factura]').click()
  const vp = pagina.locator('[role="dialog"]')
  await vp.waitFor()
  comprobar(Number(await vp.locator('input[name="monto"]').inputValue()) === 2.7, 'propone pagar los US$ 2.70')
  await vp.locator('input[name="referencia"]').fill(`OP-H-${SUFIJO}`)
  await vp.locator('select[name="caja_id"]').selectOption(await vp.locator('select[name="caja_id"] option', { hasText: CAJA_USD }).getAttribute('value'))
  await vp.locator('input[name="archivo"]').setInputFiles({ name: 'voucher.pdf', mimeType: 'application/pdf', buffer: PDF })
  await vp.getByRole('button', { name: 'Registrar el pago' }).click()
  const errorPago = await esperarVentana(pagina)
  comprobar(!errorPago, `paga lo que falta${errorPago ? ` (dijo «${errorPago}»)` : ''}`)
  const [{ saldo }] = await hasta(() => consulta(`select saldo::float as saldo from v_cuentas_pagar where id = $1`, [facturaH]), (r) => r[0]?.saldo === 0)
  comprobar(saldo === 0, 'la factura queda pagada')
  comprobar((await pagoSegunAdquisiciones(oc.H)) === 'PAGADA', 'y Adquisiciones da por pagada la OC H')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-6-tesoreria.png`, fullPage: true })
  await contexto.close()

  // Gerencia no pasa nada al cambio ni lo deshace.
  const g = await entrar('gerencia')
  await g.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await g.pagina.locator('[data-tomar-al-cambio], [data-soltar-toma]').count()) === 0, 'Gerencia no ve «La factura lo toma al cambio» ni «Deshacer»')
  await g.contexto.close()
}

// ---------------------------------------------------------------- 7. Lo descuenta de otra factura, con su nota de crédito
{
  const FD = `F078-${SUFIJO}`
  const facturaD = await registrar(FD, [], { monto: 500 })
  await como(null)
  const tomasD = () => consulta(`select id, monto::float as monto, archivo_ruta, archivo_mime from pagos_adquisicion where adquisicion_id = $1 and anulado_en is null`, [facturaD])
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  await pagina.locator(`article#compra-${oc.A} [data-descontar-de-otra]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  await v.locator('select[name="factura_id"]').selectOption(facturaD)
  const ventana = limpio(await v.innerText())
  comprobar(ventana.includes('Nota de crédito o documento del descuento') && (await v.locator('input[name="archivo"][required]').count()) === 1,
    'la ventana pide la nota de crédito o el documento del descuento, y es obligatorio')
  comprobar(Number(await v.locator('input[name="monto_boleta"]').inputValue()) === total, `trae lo pagado de más: S/ ${cifra(total)}`)
  // Sin el documento, el navegador no lo envía y no entra nada.
  await v.getByRole('button', { name: 'Descontar' }).click()
  await pagina.waitForTimeout(1500)
  comprobar((await v.isVisible()) && (await tomasD()).length === 0, 'sin el documento no se envía: la ventana sigue abierta y la factura no tomó nada')
  await v.locator('input[name="archivo"]').setInputFiles({ name: 'nota-de-credito.pdf', mimeType: 'application/pdf', buffer: PDF })
  await tresToques(v.getByRole('button', { name: 'Descontar' }))
  const error = await esperarVentana(pagina)
  comprobar(!error, `con la nota de crédito, lo descuenta${error ? ` (dijo «${error}»)` : ''}`)
  const tomas = await hasta(tomasD, (r) => r.length > 0)
  comprobar(tomas.length === 1 && tomas[0].monto === total && Boolean(tomas[0].archivo_ruta?.startsWith(`${facturaD}/`)) && tomas[0].archivo_mime === 'application/pdf',
    `tres toques, una toma de S/ ${cifra(total)} con la nota de crédito en la carpeta de la factura (${tomas.length})`)
  const ruta = tomas[0]?.archivo_ruta ?? '-'
  const [{ n: objetos }] = await consulta(`select count(*)::int as n from storage.objects where bucket_id = 'pagos-facturas' and name = $1`, [ruta])
  comprobar(objetos === 1 && existsSync(join(ARCHIVOS, 'pagos-facturas', ruta)), 'la nota de crédito está en storage.objects y en el disco del banco')
  const [{ n: movimientosD }] = await consulta(`select count(*)::int as n from movimientos_caja where origen_id = any($1::uuid[])`, [tomas.map((t) => t.id)])
  comprobar(movimientosD === 0, 'sin mover la caja')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const laA = limpio(await pagina.locator(`article#compra-${oc.A}`).textContent().catch(() => ''))
  comprobar(!laA.includes('Pagada de más') && (await pagina.locator(`article#compra-${oc.A} [data-descontar-de-otra]`).count()) === 0,
    `la OC A ya no está pagada de más: «${laA.slice(0, 220)}»`)
  const enD = pagina.locator(`article#factura-${facturaD}`)
  const plegadaD = pagina.locator('details', { has: enD })
  if ((await plegadaD.count()) > 0 && !(await plegadaD.first().evaluate((d) => d.open))) await plegadaD.first().locator('summary').click()
  const textoD = limpio(await enD.textContent().catch(() => ''))
  comprobar(textoD.includes('Descontado de lo pagado de más por la boleta') && textoD.includes(`Saldo S/ ${cifra(500 - total)}`),
    `la factura ${FD} muestra el descuento y debe el resto: «${textoD.slice(0, 260)}»`)
  const nota = await enD.getByRole('link', { name: 'Nota de crédito o documento' }).first().getAttribute('href').catch(() => null)
  const respuesta = nota ? await contexto.request.get(nota).catch(() => null) : null
  comprobar(respuesta?.status() === 200, `el enlace «Nota de crédito o documento» abre (${respuesta?.status() ?? 'sin enlace'})`)
  comprobar((await pagoSegunAdquisiciones(oc.A)) === 'PAGADA', 'y Adquisiciones da por pagada la OC A')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-7-tesoreria.png`, fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------------------- 8. El descuento que sale de dos pagos
{
  const FD2 = `F080-${SUFIJO}`
  const facturaD2 = await registrar(FD2, [], { monto: 500 })
  await como(null)
  const sobra = total - 100
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  await pagina.locator(`article#compra-${oc.I} [data-descontar-de-otra]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  await v.locator('select[name="factura_id"]').selectOption(facturaD2)
  comprobar(Number(await v.locator('input[name="monto_boleta"]').inputValue()) === sobra, `trae lo pagado de más: S/ ${cifra(sobra)}`)
  await v.locator('input[name="archivo"]').setInputFiles({ name: 'nota-de-credito.pdf', mimeType: 'application/pdf', buffer: PDF })
  await v.getByRole('button', { name: 'Descontar' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `lo descuenta${error ? ` (dijo «${error}»)` : ''}`)
  const tomas = await hasta(
    () => consulta(`select monto::float as monto, archivo_ruta from pagos_adquisicion where adquisicion_id = $1 and anulado_en is null order by monto`, [facturaD2]),
    (r) => r.length > 1,
  )
  comprobar(tomas.length === 2 && tomas[0].monto === 100 && tomas[1].monto === total - 200 && tomas.filter((t) => t.archivo_ruta).length === 1,
    `sale de los dos pagos: dos tomas, S/ 100.00 y S/ ${cifra(total - 200)}, con una sola nota (${JSON.stringify(tomas.map((t) => [t.monto, Boolean(t.archivo_ruta)]))})`)
  const etiquetas = async (zona) => (await zona.locator('a').allInnerTexts()).map(limpio).filter((t) => /^(Nota de crédito|Voucher)/.test(t))
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const enD2 = pagina.locator(`article#factura-${facturaD2}`)
  const plegada = pagina.locator('details', { has: enD2 })
  if ((await plegada.count()) > 0 && !(await plegada.first().evaluate((d) => d.open))) await plegada.first().locator('summary').click()
  const enTesoreria = await etiquetas(enD2)
  comprobar(enTesoreria.length === 2 && enTesoreria.every((t) => t.startsWith('Nota de crédito o documento')),
    `en Tesorería, las dos tomas dicen «Nota de crédito o documento»: ${JSON.stringify(enTesoreria)}`)
  await contexto.close()
  const c = await entrar('contabilidad')
  await c.pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const enFacturas = await etiquetas(c.pagina.locator('tbody:visible', { hasText: FD2 }))
  comprobar(enFacturas.length === 2 && enFacturas.every((t) => t.startsWith('Nota de crédito o documento')),
    `en Facturas, también: ${JSON.stringify(enFacturas)}`)
  await c.contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
await navegador.close()
await base.end()
if (fallas.length) {
  console.log(`\n${fallas.length} fallas`)
  process.exit(1)
}
console.log('\nTodo en orden.')

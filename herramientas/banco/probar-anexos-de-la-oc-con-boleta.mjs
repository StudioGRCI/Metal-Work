/**
 * Clic real sobre lo que cerró la sexta vuelta del pedido de DKS del 20/10
 * (migración 20261020210000): la factura que Logística anexa a una OC con
 * boleta no abre un segundo pago, ni al anularla ni al registrar otra. Con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Pagada dos veces: Tesorería pagó la OC A por su boleta y también la
 *      factura que Contabilidad registró sin OC; Logística la anexa a la OC A.
 *      Tesorería recibe el aviso; el encabezado la cuenta como «pagada dos
 *      veces» (no «por anular») y la tarjeta lo dice, con lo que se pagó de
 *      más, sin botón de pagar. En Adquisiciones sale «Pagada dos veces», con
 *      el voucher de la boleta y el de la factura rotulados, y el anexo en la
 *      línea de su factura: a Logística no se le ofrece anularlo (la base lo
 *      rechazaría) y la línea dice por qué y quién lo corrige.
 *   2. Anexo por revisar: Logística anexa a la OC B (boleta) una factura que
 *      Contabilidad registró para la OC C y no alcanza para las dos. Tesorería
 *      ve «Anexo por revisar» sin botón de pagar; Adquisiciones dice lo mismo.
 *      La ventana de Logística dice que el anexo es el que está mal, y lo
 *      anula (tres toques, una anulación con su motivo),
 *      Contabilidad recibe el aviso y la OC B vuelve a pagarse por su boleta.
 *   3. La OC que ya tiene su factura: Contabilidad registró la de la OC D
 *      eligiéndola del desplegable y Logística le anexa otra (el mismo número
 *      mal escrito). El desplegable la ofrece diciendo que la OC ya tiene la
 *      suya, avisa al elegirla, y registrarla da el error de la base sin dejar
 *      una factura más.
 *   4. (séptima vuelta) Con el mismo voucher, lo que llevaba el pago: la OC E
 *      tiene S/ 100 a cuenta y Logística le anexa la factura FE, que
 *      Contabilidad ya registró. La tarjeta, la ventana «Anular» y el aviso de
 *      después dicen que con ese voucher van los S/ 100, y que lo que le falta a
 *      la factura es un pago nuevo (decía que se pagara toda la factura con él).
 *   5. (séptima vuelta) El borrador que eligió un anexo que Logística anula no
 *      queda sin salida: Contabilidad registró la factura de la OC F eligiendo
 *      su anexo y el registro quedó en borrador (se cayó el último paso);
 *      Logística anula el anexo con clic, y Contabilidad completa el borrador
 *      con su PDF (antes la base lo rechazaba, y no había otra salida).
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
        from generate_series(1, 6) n))`,
  [rq, area, `Prueba de los anexos de la OC con boleta ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
// A, B, D, E y F van con boleta; C, con factura.
await como('logistica')
const oc = {}
for (const [clave, item, conFactura] of [['A', 1, false], ['B', 2, false], ['C', 3, true], ['D', 4, false], ['E', 5, false], ['F', 6, false]]) {
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
async function registrar(numero, [principal = null, ...resto], { documento = null } = {}) {
  const id = await nuevoId()
  await como('contabilidad')
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, orden_compra_id, documento_compra_id)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $4::date, 'PEN', $5, 'CONTADO', $6, $7)`,
    [id, PROVEEDOR, numero, hoy, total, principal, documento],
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
  `Sembrado ${SUFIJO}: ${nombre(oc.A)} pagada dos veces (${FX}), ${nombre(oc.B)} con el anexo ${FY} de la ${nombre(oc.C)}, ${nombre(oc.D)} con ${FZ} y el anexo ${FZ_MAL}`,
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

// ---------------------------------------------------------------- 1. Pagada dos veces
{
  const [aviso] = await consulta(
    `select cuerpo from notificaciones where usuario_id = $1 and origen_id = $2 and titulo = $3`,
    [ids[CUENTAS.tesoreria], oc.A, `Compra pagada dos veces: ${nombre(oc.A)}`],
  )
  comprobar(Boolean(aviso?.cuerpo?.includes('de más')), `a Tesorería le llegó «Compra pagada dos veces»: ${limpio(aviso?.cuerpo).slice(0, 160)}`)
  comprobar((await pagoSegunAdquisiciones(oc.A)) === 'PAGADA_DOS_VECES', 'Adquisiciones dice que la OC A está pagada dos veces')
  const deMas = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total)

  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const encabezado = limpio(await pagina.locator('main').first().innerText().catch(() => '')).slice(0, 800)
  const cuenta = encabezado.match(/(una OC pagada|\d+ OC pagadas) dos veces/)?.[0]
  comprobar(Boolean(cuenta), `el encabezado cuenta las pagadas dos veces aparte: ${cuenta ?? encabezado.slice(0, 200)}`)
  const tarjeta = pagina.locator(`article#compra-${oc.A}`)
  const texto = limpio(await tarjeta.innerText().catch(() => ''))
  console.log(`       la tarjeta de la A: ${texto.slice(0, 500)}`)
  comprobar(texto.includes('Pagada dos veces') && texto.includes('se pagó dos veces') && texto.includes(FX), 'la tarjeta dice «Pagada dos veces», por su boleta y por la factura')
  comprobar(texto.includes(`Pide al proveedor la devolución de S/ ${deMas}`), 'y pide la devolución de lo pagado de más, con el monto')
  comprobar(texto.includes(`Pagado de más S/ ${deMas}`) && texto.includes('Pagada también por su factura'), 'muestra lo pagado de más, y que la factura ya está pagada')
  comprobar((await tarjeta.locator('[data-pagar-compra]').count()) === 0, 'sin botón de pagar')
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-1-tesoreria.png`, fullPage: true })
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(nombre(oc.A))}`, { waitUntil: 'networkidle' })
  const fila = limpio(await pagina.locator(`tr[data-orden="${nombre(oc.A)}"]`).innerText().catch(() => ''))
  console.log(`       la fila de la A para Tesorería: ${fila.slice(0, 500)}`)
  comprobar(fila.includes('Pagada dos veces') && fila.includes('Pedir la devolución en Cuentas por pagar'), 'Adquisiciones dice «Pagada dos veces» y lleva a pedir la devolución')
  comprobar(fila.includes('Voucher de la boleta') && fila.includes('Voucher de la factura'), 'cada voucher dice si es de la boleta o de la factura')
  comprobar(!fila.includes('Pagar en Cuentas por pagar'), 'y no manda a pagar su factura: la base lo rechazaría mientras siga el pago directo')
  await contexto.close()
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
  comprobar(ventana.includes('Si no es de esta OC, este anexo es el que está mal') && ventana.includes(FY) && ventana.includes('la OC se paga por su boleta') && !ventana.includes('vuelve a pagarse'),
    'la ventana dice que, si la factura no es de esta OC, el anexo es el que está mal, y que la OC se paga por su boleta')
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
  await pagina.screenshot({ path: `${CAPTURAS}/anexos-3-contabilidad.png`, fullPage: true })
  await contexto.close()
}
comprobar(!(await anulado(anexoZMal))?.anulado_en, 'el anexo mal escrito sigue esperando a Logística')

// ---------------------------------------------------------------- 4. Con el mismo voucher, lo que llevaba el pago
{
  const cifra = (n) => new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  const resto = cifra(Math.round((total - 100) * 100) / 100)
  const { pagina, contexto } = await entrar('tesoreria')
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`article#compra-${oc.E}`)
  const texto = limpio(await tarjeta.innerText().catch(() => ''))
  console.log(`       la tarjeta de la E: ${texto.slice(0, 400)}`)
  comprobar(texto.includes('paga con el mismo voucher los S/ 100.00 que ya salieron') && texto.includes('lo que le falte a la factura después es un pago nuevo'),
    'la tarjeta dice que con el mismo voucher van los S/ 100.00 del pago, y que el resto es un pago nuevo')
  await pagina.locator(`[data-anular-pago-compra="${pagoE}"]`).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor()
  const ventana = limpio(await v.innerText())
  comprobar(ventana.includes('van con el mismo voucher los S/ 100.00 de este pago'), `la ventana dice lo mismo: «${ventana.slice(0, 300)}»`)
  await v.locator('textarea[name="motivo"]').fill('El proveedor entregó factura: se paga por ella')
  await v.getByRole('button', { name: 'Anular' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `anula el pago${error ? ` (dijo «${error}»)` : ''}`)
  const aviso = limpio(await hasta(() => pagina.locator('p.sr-only[role="status"]').first().textContent().catch(() => ''), (t) => Boolean(t), 5000))
  console.log(`       el aviso: ${aviso.slice(0, 300)}`)
  comprobar(aviso.includes('paga con el mismo voucher lo que llevaba este pago, S/ 100.00') && aviso.includes(`Los S/ ${resto} que le faltan después son un pago nuevo`),
    'el aviso de después manda a pagar con ese voucher S/ 100.00, no la factura entera, y dice cuánto es pago nuevo')
  const [{ n }] = await consulta(`select count(*)::int as n from pagos_orden_compra where id = $1 and anulado_en is not null`, [pagoE])
  comprobar(n === 1, 'el pago quedó anulado en la base')
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

comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
await navegador.close()
await base.end()
if (fallas.length) {
  console.log(`\n${fallas.length} fallas`)
  process.exit(1)
}
console.log('\nTodo en orden.')

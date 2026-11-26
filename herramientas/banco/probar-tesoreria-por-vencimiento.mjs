/**
 * Tesorería trabaja por vencimiento (plan 11, entrega 11.1), con la cuenta de
 * Tesorería y la de Gerencia (nunca ADMIN):
 *
 *   1. En Cuentas por cobrar, las facturas salen en «Vencido», «Vence hoy»,
 *      «Esta semana» (hasta el domingo) y «Después», en ese orden; cada factura
 *      sembrada cae en su grupo y dice sus días («hace 3 días», «en 10 días»).
 *      El total de cada grupo va en soles y en dólares por separado y es el que
 *      la base da para esas facturas, contado aparte en SQL con la semana de
 *      lunes a domingo de Lima.
 *   2. En Cuentas por pagar, lo mismo con las facturas de compra; la que es de
 *      una OC que todavía espera a Gerencia no entra en los grupos de fecha:
 *      va al final, en «No se pagan todavía».
 *   3. Gerencia ve los mismos grupos y totales, sin el botón de pagar ni de cobrar.
 *   4. En el teléfono (390) y en el monitor (1440) las dos pantallas entran sin
 *      desbordarse; las capturas quedan en CAPTURAS.
 *
 * Siembra sus datos en la base del banco con un sufijo nuevo; los totales se
 * comparan con lo que la base tiene por cobrar y por pagar, así que no
 * dependen de corridas anteriores. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), CAPTURAS, BANCO_BASE, BANCO_ARCHIVOS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'
import { esperarReactAlNavegar } from './con-react.mjs'

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
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

// ---------------------------------------------------------------- fechas de Lima
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const mas = (n) => {
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diaDeLaSemana = new Date(`${hoy}T12:00:00Z`).getUTCDay()
const hastaElDomingo = diaDeLaSemana === 0 ? 0 : 7 - diaDeLaSemana
// «Esta semana» necesita un día entre mañana y el domingo: el domingo no lo hay.
const enLaSemana = hastaElDomingo >= 1 ? mas(1) : null

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `PROVEEDOR VENCIMIENTO ${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

async function como(puesto) {
  const sub = puesto ? ids[CUENTAS[puesto]] : ''
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, puesto ? JSON.stringify({ sub, role: 'authenticated' }) : ''])
}
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
// Como en producción: toda compra la aprueba Gerencia (regla activa desde S/ 0).
await consulta(`update regla_aprobacion_compras set activa = true, monto_desde = 0, rol_aprobador_id = (select id from roles where codigo = 'GERENTE')`)

const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`VENCE-${SUFIJO}`, `Plancha LAF 3 mm 4x8 (${SUFIJO})`, cat, und],
)
const [{ id: rq }] = await consulta(`select gen_random_uuid() as id`)
await como('requerimientos')
await consulta(
  `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/21', $3, null,
     (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 2, 'unidad_medida_id', $4::text, 'categoria_id', $5::text))
        from generate_series(1, 9) n))`,
  [rq, area, `Prueba de vencimientos ${SUFIJO}`, und, cat],
)
await como('almacen')
await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])

// Cinco OC con factura: vencida en soles, de hoy en dólares, de la semana en
// soles, de después en dólares, y una que Gerencia no aprueba (vencida, soles).
const PLAN = [
  { clave: 'vencida', moneda: 'PEN', precio: 100, vence: mas(-3), grupo: 'VENCIDO', dias: 'hace 3 días' },
  { clave: 'hoy', moneda: 'USD', precio: 50, vence: hoy, grupo: 'HOY', dias: 'Vence hoy' },
  ...(enLaSemana ? [{ clave: 'semana', moneda: 'PEN', precio: 70, vence: enLaSemana, grupo: 'SEMANA', dias: 'mañana' }] : []),
  { clave: 'despues', moneda: 'USD', precio: 30, vence: mas(10), grupo: 'DESPUES', dias: 'en 10 días' },
  { clave: 'gerencia', moneda: 'PEN', precio: 40, vence: mas(-1), grupo: 'APARTE', dias: 'hace 1 día', sinAprobar: true },
]
await como('logistica')
for (const [i, p] of PLAN.entries()) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
       jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 2, 'precio', $5::numeric)), null, 'CREDITO', 30, $6, true) as id`,
    [rq, i + 1, proveedor, material, p.precio, p.moneda],
  )
  p.oc = id
}
await como('gerencia')
for (const p of PLAN) if (!p.sinAprobar) await consulta(`select public.aprobar_compra($1)`, [p.oc])
await como('contabilidad')
for (const p of PLAN) {
  const [{ id }] = await consulta(`select gen_random_uuid() as id`)
  const [{ total }] = await consulta(`select public.total_orden_compra($1)::float as total`, [p.oc])
  p.numero = `F07${PLAN.indexOf(p)}-${SUFIJO}`
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, ruc_proveedor)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4::date, $5::date, $6, $7, 'CREDITO', $8)`,
    [id, PROVEEDOR, p.numero, mas(-20), p.vence, p.moneda, total, ruc.n],
  )
  await consulta(`insert into adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values ($1, $2)`, [id, p.oc])
  await subir('comprobantes-financieros', `adquisiciones/${id}/comprobante.pdf`, 'contabilidad')
  await consulta(`update adquisiciones set ruta_storage = $2, estado = 'REGISTRADA' where id = $1`, [id, `adquisiciones/${id}/comprobante.pdf`])
  p.id = id
}
// OC con boleta, que Tesorería paga directo: una vencida (soles), una de después (dólares) y una
// cuyo proveedor entregó factura (Logística la anexó): esa no se paga aquí. Y una OC con factura
// que llega en partes, con la boleta de una parte vencida.
const BOLETAS = [
  { clave: 'vencida', moneda: 'PEN', precio: 80, dias: 30, atras: 33, grupo: 'VENCIDO', texto: 'hace 3 días' },
  { clave: 'despues', moneda: 'USD', precio: 20, dias: 12, atras: 0, grupo: 'DESPUES', texto: 'en 12 días' },
  { clave: 'camino', moneda: 'PEN', precio: 60, dias: 0, atras: 0, grupo: 'APARTE', texto: null, conFacturaAnexada: true },
]
await como('logistica')
for (const [i, b] of BOLETAS.entries()) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
       jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 2, 'precio', $5::numeric)), null, $6, $7, $8, false) as id`,
    [rq, PLAN.length + 1 + i, proveedor, material, b.precio, b.dias > 0 ? 'CREDITO' : 'CONTADO', b.dias, b.moneda],
  )
  b.oc = id
}
const [{ id: ocPartes }] = await consulta(
  `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[$2]::smallint[], $3, null,
     jsonb_build_array(jsonb_build_object('material_id', $4::text, 'cantidad', 2, 'precio', 150)), null, 'CREDITO', 30, 'PEN', true) as id`,
  [rq, PLAN.length + BOLETAS.length + 1, proveedor, material],
)
await como('gerencia')
for (const b of BOLETAS) await consulta(`select public.aprobar_compra($1)`, [b.oc])
await consulta(`select public.aprobar_compra($1)`, [ocPartes])
await como('logistica')
const camino = BOLETAS.find((b) => b.conFacturaAnexada)
{
  const [{ id: doc }] = await consulta(`select gen_random_uuid() as id`)
  await subir('documentos-compras', `compra/${camino.oc}/${doc}.pdf`, 'logistica')
  await consulta(
    `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision)
     values ($1, $2, 'FACTURA', 'factura.pdf', $3, 'application/pdf', $4, $5, $6, $7::date)`,
    [doc, camino.oc, `compra/${camino.oc}/${doc}.pdf`, PDF.length, ids[CUENTAS.logistica], `F079-${SUFIJO}`, hoy],
  )
}
const PARTE = { numero: `B078-${SUFIJO}`, monto: 118, grupo: 'VENCIDO', texto: 'hace 10 días' }
{
  const [{ id: doc }] = await consulta(`select gen_random_uuid() as id`)
  await subir('documentos-compras', `compra/${ocPartes}/${doc}.pdf`, 'logistica')
  await consulta(
    `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision, monto_de_la_parte, parte_trae_igv)
     values ($1, $2, 'COMPROBANTE', 'boleta.pdf', $3, 'application/pdf', $4, $5, $6, $7::date, $8, true)`,
    [doc, ocPartes, `compra/${ocPartes}/${doc}.pdf`, PDF.length, ids[CUENTAS.logistica], PARTE.numero, mas(-40), PARTE.monto],
  )
  PARTE.id = doc
}
await como(null)
// La vencida se emitió hace 33 días: se corre su fecha como la dejaría el tiempo, sin disparadores.
await base.query('begin')
await base.query('set local session_replication_role = replica')
for (const b of BOLETAS.filter((x) => x.atras > 0)) {
  await consulta(`update ordenes_compra_materiales set creado_en = creado_en - make_interval(days => $2) where id = $1`, [b.oc, b.atras])
}
await base.query('commit')
for (const b of BOLETAS) {
  b.nombre = (await consulta(`select public.nombre_de_oc(numero, referencia) as n from ordenes_compra_materiales where id = $1`, [b.oc]))[0].n
}
await como('tesoreria')
const enCamino = await consulta(`select id, comprobante_en_camino from compras_con_boleta_por_pagar() where id = any($1)`, [BOLETAS.map((b) => b.oc)])
await como(null)
comprobar(
  enCamino.find((f) => f.id === camino.oc)?.comprobante_en_camino != null,
  `la OC con la factura anexada tiene su comprobante en camino (${JSON.stringify(enCamino.map((f) => f.comprobante_en_camino))})`,
)

await como(null)
const estados = await consulta(`select numero, aprobacion from ordenes_compra_materiales where id = any($1)`, [PLAN.map((p) => p.oc)])
comprobar(
  estados.filter((e) => e.aprobacion === 'POR_APROBAR').length === 1,
  `una sola OC queda esperando a Gerencia (${estados.map((e) => e.aprobacion).join(', ')})`,
)

// Facturas de venta: una cotización aprobada por moneda, y facturas de cada grupo.
const [cli] = await consulta(
  `insert into clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal, distrito)
   select 'RUC', '2099' || $1::text || d, 'CLIENTE VENCIMIENTO ' || $1::text, 'Av. de Prueba 1', 'Trujillo' from generate_series(0, 9) d
    where ruc_es_valido('2099' || $1::text || d) limit 1 returning id`,
  [SUFIJO],
)
const VENTAS = [
  { moneda: 'USD', total: 1000, vence: mas(-5), grupo: 'VENCIDO', dias: 'hace 5 días' },
  { moneda: 'PEN', total: 2360, vence: mas(-1), grupo: 'VENCIDO', dias: 'hace 1 día' },
  { moneda: 'PEN', total: 590, vence: hoy, grupo: 'HOY', dias: 'vence hoy' },
  ...(enLaSemana ? [{ moneda: 'USD', total: 300, vence: enLaSemana, grupo: 'SEMANA', dias: 'mañana' }] : []),
  { moneda: 'PEN', total: 1180, vence: mas(30), grupo: 'DESPUES', dias: 'en 30 días' },
]
const cotizacion = {}
for (const m of ['PEN', 'USD']) {
  const [cot] = await consulta(
    `with nuevo as (select gen_random_uuid() as id)
     insert into cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
     select nuevo.id, $1, $2, (select id from tipos_carroceria where activo order by orden_secuencia limit 1), 'POR_REVISAR', 'prueba.pdf',
            'cot/' || nuevo.id || '/prueba.pdf', 'application/pdf', 120, $3, 100000, $4 from nuevo returning id, numero`,
    [`QA-V${m}-${SUFIJO}`, cli.id, ids[CUENTAS.tesoreria], m],
  )
  await como('gerencia')
  await base.query('begin')
  await base.query('set local role authenticated')
  await consulta(`update cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cot.id])
  await base.query('commit')
  await como(null)
  cotizacion[m] = cot
}
for (const [i, v] of VENTAS.entries()) {
  v.numero = `E07${i}-${SUFIJO}`
  // Con su PDF en el almacenamiento, como la deja Contabilidad: sin él la tarjeta pide recargar.
  await subir('facturas-venta', `fv/vencimiento-${SUFIJO}-${i}.pdf`, 'contabilidad')
  await consulta(
    `insert into facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, cliente_id, numero, fecha_emision, fecha_vencimiento,
                                 moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
     values ('PLA_SR_O4_1_26/21', $1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10, 'prueba.pdf', 120, $11)`,
    [cotizacion[v.moneda].id, cotizacion[v.moneda].numero, `CLIENTE VENCIMIENTO ${SUFIJO}`, cli.id, v.numero, mas(-40), v.vence, v.moneda, v.total,
      `fv/vencimiento-${SUFIJO}-${i}.pdf`, ids[CUENTAS.tesoreria]],
  )
}

// ---------------------------------------------------------------- lo que la base dice por grupo
// Contado aparte, en SQL: la semana de lunes a domingo, con el día de Lima.
const GRUPO_SQL = `case when f.fecha_vencimiento is null then 'SIN_FECHA'
                        when f.fecha_vencimiento < $1::date then 'VENCIDO'
                        when f.fecha_vencimiento = $1::date then 'HOY'
                        when f.fecha_vencimiento <= date_trunc('week', $1::date)::date + 6 then 'SEMANA'
                        else 'DESPUES' end`
// Se cuentan al leer cada pantalla: otra prueba puede estar sembrando en el mismo banco.
const totalesCobro = () => consulta(
  `select ${GRUPO_SQL} as grupo, coalesce(f.moneda, 'PEN') as moneda, sum(f.saldo)::numeric(14,2)::text as total
     from v_facturas_venta f where f.anulada_en is null and not f.cancelada and f.saldo > 0 group by 1, 2`,
  [hoy],
)
// Las que se pagan: ninguna OC por aprobar, rechazada ni anulada.
const totalesPago = () => consulta(
  `select ${GRUPO_SQL} as grupo, coalesce(f.moneda, 'PEN') as moneda, sum(f.saldo)::numeric(14,2)::text as total
     from v_cuentas_pagar f
    where f.saldo > 0
      and not exists (select 1 from adquisiciones_ordenes_compra l join ordenes_compra_materiales o on o.id = l.orden_compra_id
                       where l.adquisicion_id = f.id and l.quitada_en is null and coalesce(o.aprobacion, '') not in ('APROBADA', 'NO_REQUERIDA'))
    group by 1, 2`,
  [hoy],
)
const formato = (m, n) =>
  `${m === 'USD' ? 'US$' : 'S/'} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
async function entrar(correo, viewport) {
  const contexto = await navegador.newContext({
    viewport,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
  })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}

/** Lo que dice cada grupo de una lista: su orden, su total por moneda y las filas que trae. */
async function leerGrupos(pagina, lista) {
  return pagina.locator(`section[aria-labelledby^="${lista}-"]`).evaluateAll((secciones) =>
    secciones.map((s) => ({
      grupo: s.getAttribute('data-grupo-vencimiento'),
      titulo: (s.querySelector('h3')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      totales: Object.fromEntries([...s.querySelectorAll('header [data-total-moneda]')].map((t) => [t.getAttribute('data-total-moneda'), t.textContent.replace(/[·\s]+/g, ' ').trim()])),
      texto: (s.textContent ?? '').replace(/\s+/g, ' '),
    })),
  )
}

function revisarTotales(grupos, esperados, donde) {
  for (const g of grupos.filter((x) => x.grupo !== 'APARTE' && x.grupo !== 'PRIMERO')) {
    const deEste = esperados.filter((e) => e.grupo === g.grupo)
    const esperado = Object.fromEntries(deEste.filter((e) => Number(e.total) > 0).map((e) => [e.moneda, formato(e.moneda, e.total)]))
    const ok = JSON.stringify(Object.keys(esperado).sort()) === JSON.stringify(Object.keys(g.totales).sort()) &&
      Object.entries(esperado).every(([m, t]) => g.totales[m] === t)
    comprobar(ok, `${donde} · «${g.titulo}»: total ${JSON.stringify(g.totales)} = base ${JSON.stringify(esperado)}`)
  }
}

const ORDEN = ['PRIMERO', 'VENCIDO', 'HOY', 'SEMANA', 'DESPUES', 'SIN_FECHA', 'APARTE']
const enOrden = (grupos) => grupos.every((g, i) => i === 0 || ORDEN.indexOf(grupos[i - 1].grupo) < ORDEN.indexOf(g.grupo))

async function sinDesborde(pagina, donde) {
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `${donde} entra en 390 px (mide ${ancho})`)
}

async function capturar(pagina, nombre) {
  await pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: false })
}

/** Lleva el primer grupo con las filas sembradas a la vista, para la captura. */
async function alGrupo(pagina, lista, grupo) {
  await pagina.locator(`section[aria-labelledby="${lista}-${grupo.toLowerCase()}"]`).first().scrollIntoViewIfNeeded().catch(() => {})
  await pagina.evaluate(() => window.scrollBy(0, -80))
}

for (const [puesto, viewport, sufijo] of [
  ['tesoreria', { width: 1440, height: 900 }, '1440'],
  ['tesoreria', { width: 390, height: 844 }, '390'],
  ['gerencia', { width: 1440, height: 900 }, '1440'],
  ['gerencia', { width: 390, height: 844 }, '390'],
]) {
  const { pagina, contexto, errores } = await entrar(CUENTAS[puesto], viewport)
  const donde = `${puesto} ${sufijo}`

  // 1. Por cobrar.
  await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle', timeout: 90000 })
  const cobro = await leerGrupos(pagina, 'por-cobrar')
  comprobar(cobro.length > 0 && enOrden(cobro), `${donde} · por cobrar: grupos en orden (${cobro.map((g) => g.grupo).join(' → ')})`)
  for (const v of VENTAS) {
    const g = cobro.find((x) => x.texto.includes(`Factura ${v.numero}`))
    comprobar(g?.grupo === v.grupo, `${donde} · por cobrar: ${v.numero} en «${v.grupo}» (está en ${g?.grupo ?? 'ninguno'})`)
    const fila = limpio(await pagina.locator(`[data-factura="${v.numero}"]`).first().textContent().catch(() => ''))
    comprobar(fila.includes(v.dias), `${donde} · por cobrar: ${v.numero} dice «${v.dias}»`)
  }
  revisarTotales(cobro, await totalesCobro(), `${donde} · por cobrar`)
  const cobrar = await pagina.getByRole('button', { name: 'Registrar cobro' }).count()
  comprobar(puesto === 'tesoreria' ? cobrar > 0 : cobrar === 0, `${donde} · por cobrar: ${puesto === 'tesoreria' ? 'cobra desde su fila' : 'sin botón de cobrar'}`)
  if (viewport.width < 500) await sinDesborde(pagina, `${donde} · por cobrar`)
  await alGrupo(pagina, 'por-cobrar', 'VENCIDO')
  await capturar(pagina, `11-1-${puesto}-${sufijo}-por-cobrar`)

  // 2. Por pagar.
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle', timeout: 90000 })
  const pago = await leerGrupos(pagina, 'facturas')
  comprobar(pago.length > 0 && enOrden(pago), `${donde} · por pagar: grupos en orden (${pago.map((g) => g.grupo).join(' → ')})`)
  for (const p of PLAN) {
    const g = pago.find((x) => x.texto.includes(p.numero))
    comprobar(g?.grupo === p.grupo, `${donde} · por pagar: ${p.numero} en «${p.grupo}» (está en ${g?.grupo ?? 'ninguno'})`)
    const fila = limpio(await pagina.locator(`article#factura-${p.id}`).first().textContent().catch(() => ''))
    comprobar(fila.includes(p.dias), `${donde} · por pagar: ${p.numero} dice «${p.dias}»`)
  }
  const aparte = pago.find((g) => g.grupo === 'APARTE')
  comprobar(Boolean(aparte?.titulo.startsWith('No se pagan todavía')), `${donde} · por pagar: la que espera a Gerencia va al final, en «No se pagan todavía»`)
  revisarTotales(pago, await totalesPago(), `${donde} · por pagar`)

  // Las OC con boleta: las que se pagan aquí, por vencimiento; la del comprobante en camino, al final.
  const boletas = await leerGrupos(pagina, 'boletas')
  comprobar(boletas.length > 0 && enOrden(boletas), `${donde} · OC con boleta: grupos en orden (${boletas.map((g) => g.grupo).join(' → ')})`)
  for (const b of BOLETAS) {
    const g = boletas.find((x) => x.texto.includes(b.nombre))
    comprobar(g?.grupo === b.grupo, `${donde} · OC con boleta: ${b.nombre} en «${b.grupo}» (está en ${g?.grupo ?? 'ninguno'})`)
    if (b.texto) {
      const fila = limpio(await pagina.locator(`article#compra-${b.oc}`).first().textContent().catch(() => ''))
      comprobar(fila.includes(b.texto), `${donde} · OC con boleta: ${b.nombre} dice «${b.texto}»`)
    }
  }
  const sinTotal = boletas.find((g) => g.grupo === 'APARTE')
  comprobar(Boolean(sinTotal?.titulo.startsWith('No se pagan aquí')) && Object.keys(sinTotal?.totales ?? {}).length === 0,
    `${donde} · OC con boleta: «No se pagan aquí» va al final y sin total`)
  // Lo que suman sus grupos de fecha es lo que la base tiene por pagar en las OC con boleta que se pagan aquí.
  await como('tesoreria')
  const totalesBoleta = await consulta(
    `select case when f.vence < $1::date then 'VENCIDO' when f.vence = $1::date then 'HOY'
                 when f.vence <= date_trunc('week', $1::date)::date + 6 then 'SEMANA' else 'DESPUES' end as grupo,
            coalesce(f.moneda, 'PEN') as moneda, sum(f.total - f.pagado)::numeric(14,2)::text as total
       from compras_con_boleta_por_pagar() f
      where not f.cancelada and f.comprobante_en_camino is null and f.factura is null
        and not (coalesce(f.de_mas, 0) > 0 or coalesce(f.otra_moneda, false)) and f.total - f.pagado > 0
        and not (coalesce(f.devuelto, 0) > 0 and coalesce(f.pagado, 0) <= 0)
      group by 1, 2`,
    [hoy],
  )
  await como(null)
  revisarTotales(boletas, totalesBoleta, `${donde} · OC con boleta`)

  // La boleta de una parte, en su grupo con sus días.
  const partes = await leerGrupos(pagina, 'partes')
  const gp = partes.find((x) => x.texto.includes(PARTE.numero))
  comprobar(gp?.grupo === PARTE.grupo, `${donde} · boletas de una parte: ${PARTE.numero} en «${PARTE.grupo}» (está en ${gp?.grupo ?? 'ninguno'})`)
  const filaParte = limpio(await pagina.locator(`article#parte-${PARTE.id}`).first().textContent().catch(() => ''))
  comprobar(filaParte.includes(PARTE.texto), `${donde} · boletas de una parte: ${PARTE.numero} dice «${PARTE.texto}»`)

  // El índice de arriba de cada lista lleva a su grupo.
  const indice = pagina.locator('nav[data-indice-vencimiento="facturas"] a').first()
  comprobar((await indice.count()) === 1 && (await indice.getAttribute('href')) === '#facturas-vencido', `${donde} · el índice de las facturas lleva a «Vencido»`)
  const pagar = await pagina.getByRole('button', { name: 'Registrar pago' }).count()
  comprobar(puesto === 'tesoreria' ? pagar > 0 : pagar === 0, `${donde} · por pagar: ${puesto === 'tesoreria' ? 'paga desde su fila' : 'sin botón de pagar'}`)
  if (viewport.width < 500) await sinDesborde(pagina, `${donde} · por pagar`)
  await alGrupo(pagina, 'facturas', 'VENCIDO')
  await capturar(pagina, `11-1-${puesto}-${sufijo}-por-pagar`)

  comprobar(errores.length === 0, `${donde} · sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

/**
 * Recorre con clic real los pagos y cobros que mueven la caja diaria
 * (migración 20261019100000, «Conectar ya» de DKS el 19/10), con la cuenta de
 * Tesorería (nunca ADMIN):
 *
 *   1. Paga a cuenta una factura de compra en soles: el formulario pide la
 *      cuenta (sin elegirla no deja enviar); tres toques dejan un solo pago y
 *      un solo egreso, y el aviso de la caja de la barra de arriba dice de qué
 *      cuenta salió (también cuando el pago cancela el documento y su botón
 *      desaparece): está cerrado, se abre al tocarlo y se cierra con Escape. Con un día
 *      de antes del inicio de la cuenta, dice que no la mueve; pagada así otra
 *      factura, «La caja no se movió» se ve en la página sin tocar nada.
 *   2. Paga una factura en dólares desde la cuenta en soles: aparece «Lo que
 *      salió de la cuenta, en soles» y la caja guarda su tipo de cambio.
 *   3. Paga una orden de servicio, cobra una factura de venta en dólares a la
 *      cuenta en dólares, paga un recibo por honorarios (el neto) y la planilla
 *      diaria de dos personas: cada uno deja su movimiento en la base.
 *   4. La caja diaria los muestra con su origen y dónde se anulan, sin botón
 *      para anularlos sueltos, y el saldo de la cuenta baja.
 *   5. Anula el pago de la factura: su egreso queda anulado. Después paga
 *      ayer otra factura, Tesorería cierra ayer, y al anular ese pago su
 *      egreso se queda en el día cerrado y hoy vuelve lo que salió; el
 *      formulario avisa antes que la cuenta está cerrada ese día.
 *   6. En el teléfono, la ventana de pago y la caja entran sin desbordarse.
 *   7. Gerencia ve Cuentas por pagar sin el botón de pagar.
 *
 * Arma sus documentos y sus dos cuentas por SQL en la base del banco, con un
 * sello distinto en cada corrida. Necesita las cuentas `*.local@metalwork.test`
 * de Tesorería y Gerencia.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const TESORERIA = process.env.TESORERIA ?? 'tesoreria.local@metalwork.test'
const GERENCIA = process.env.GERENCIA ?? 'gerencia.local@metalwork.test'
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

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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

/** Elige la cuenta por su nombre en el desplegable de la ventana. */
async function elegirCuenta(v, nombre) {
  const valor = await v.locator('select[name="caja_id"] option', { hasText: nombre }).getAttribute('value')
  await v.locator('select[name="caja_id"]').selectOption(valor)
}

// ------------------------------------------------- archivos y armazón
const archivos = join(CAPTURAS, 'archivos-pagos-caja')
mkdirSync(archivos, { recursive: true })
writeFileSync(
  join(archivos, 'voucher.pdf'),
  Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  ),
)
const VOUCHER = join(archivos, 'voucher.pdf')

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const sello = Date.now().toString().slice(-6)
const SOLES = `Banco prueba soles ${sello}`
const DOLARES = `Banco prueba dólares ${sello}`
const N = {
  adqPen: `F998-1${sello}`,
  adqUsd: `F998-2${sello}`,
  adqCierre: `F998-3${sello}`,
  adqAntes: `F998-4${sello}`,
  os: `QA-OS-${sello}`,
  fv: `E998-1${sello}`,
  rec: `E998-${sello}`,
  pd: `QA-PD-${sello}`,
}

const [teso] = await consulta(`select id from usuarios where correo = $1`, [TESORERIA])
const [gere] = await consulta(`select id from usuarios where correo = $1`, [GERENCIA])
if (!teso || !gere) throw new Error('Faltan las cuentas locales de Tesorería o Gerencia en la base del banco.')

// Las cuentas van dentro de la transacción: si algo falla, no quedan sueltas en
// los desplegables (una cuenta con saldo ya no se borra).
let ids
await base.query('begin')
try {
  ids = (
    await consulta(
      `with
        caja_pen as (insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
                     values ($1, 'BANCO', 'BANCO DE PRUEBA', 'PEN', 10000, $3::date - 30, $4) returning id),
        caja_usd as (insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
                     values ($2, 'BANCO', 'BANCO DE PRUEBA', 'USD', 5000, $3::date - 30, $4) returning id)
       select (select id from caja_pen) as pen, (select id from caja_usd) as usd`,
      [SOLES, DOLARES, hoy, teso.id],
    )
  )[0]

  const [prov] = await consulta(
    `insert into proveedores (numero_documento, razon_social)
     select '2010099' || $1::text || d, 'PROVEEDOR PRUEBA CAJA' from generate_series(0, 9) d where ruc_es_valido('2010099' || $1::text || d) limit 1
     on conflict (tipo_documento, numero_documento) do update set activo = true
     returning id`,
    [sello.slice(0, 3)],
  )
  // La factura registrada lleva su PDF en el almacenamiento (fn_proteger_adquisicion).
  // La tercera es de hace cinco días: se paga ayer, y ayer se cierra antes de anular el pago.
  for (const [clave, numero, monedaFactura, total, dias] of [
    ['adqPen', N.adqPen, 'PEN', 1180, 0],
    ['adqUsd', N.adqUsd, 'USD', 100, 0],
    ['adqCierre', N.adqCierre, 'PEN', 100, 5],
    ['adqAntes', N.adqAntes, 'PEN', 100, 40],
  ]) {
    const [{ id }] = await consulta('select gen_random_uuid() as id')
    await consulta(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('comprobantes-financieros', 'adquisiciones/' || $1::text || '/comprobante.pdf', $2::text, '{"mimetype": "application/pdf", "size": 2048}')`,
      [id, teso.id],
    )
    await consulta(
      `insert into adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, estado, ruta_storage, registrado_por)
       values ($1::uuid, 'FACTURA_COMPRA', 'PROVEEDOR PRUEBA CAJA', $2, $3::date - $7::int, $3::date - $7::int, $4, $5, 'CONTADO', 'REGISTRADA', 'adquisiciones/' || $1::text || '/comprobante.pdf', $6)`,
      [id, numero, hoy, monedaFactura, total, teso.id, dias],
    )
    ids[clave] = id
  }
  ids.os = (await consulta(
    `insert into ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno, aprobacion, aprobado_por, aprobado_en, creado_por)
     values ($1, $2, 'PROVEEDOR PRUEBA CAJA', 'Servicio de prueba de la caja diaria', 500, 'PEN', 'PRB-CAJA', 'APROBADA', $3, now(), $3) returning id`,
    [N.os, prov.id, gere.id],
  ))[0].id
  const [cli] = await consulta(
    `insert into clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal, distrito)
     select 'RUC', '2099099' || $1::text || d, 'CLIENTE PRUEBA CAJA', 'Av. de Prueba 1', 'Trujillo' from generate_series(0, 9) d
      where ruc_es_valido('2099099' || $1::text || d) limit 1
     on conflict do nothing returning id`,
    [sello.slice(0, 3)],
  )
  const clienteId = cli?.id ?? (await consulta(`select id from clientes where razon_social = 'CLIENTE PRUEBA CAJA' limit 1`))[0].id
  const [cot] = await consulta(
    `with nuevo as (select gen_random_uuid() as id)
     insert into cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
     select nuevo.id, $1, $2, (select id from tipos_carroceria where activo order by orden_secuencia limit 1), 'POR_REVISAR', 'prueba.pdf',
            'cot/' || nuevo.id || '/prueba.pdf', 'application/pdf', 120, $3, 1000, 'USD' from nuevo returning id`,
    [`QA-CAJA-${sello}`, clienteId, teso.id],
  )
  ids.fv = (await consulta(
    `insert into facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, cliente_id, numero, fecha_emision, fecha_vencimiento,
                                 moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
     values ('PRB-CAJA', $1, $2, 'CLIENTE PRUEBA CAJA', $3, $4, $5::date, $5::date + 30, 'USD', 1000, $7, 'prueba.pdf', 120, $6) returning id`,
    [cot.id, `QA-CAJA-${sello}`, clienteId, N.fv, hoy, teso.id, `fv/prueba-caja-${sello}.pdf`],
  ))[0].id
  const [sub] = await consulta(
    `insert into subcontratistas (ruc, nombre)
     select '1071299' || $1::text || d, 'SUBCONTRATISTA PRUEBA CAJA' from generate_series(0, 9) d where ruc_es_valido('1071299' || $1::text || d) limit 1
     on conflict do nothing returning id`,
    [sello.slice(0, 3)],
  )
  const subId = sub?.id ?? (await consulta(`select id from subcontratistas where nombre = 'SUBCONTRATISTA PRUEBA CAJA' limit 1`))[0].id
  ids.sc = (await consulta(
    `insert into subcontratos (numero, subcontratista_id, codigo_interno, descripcion, moneda, monto, creado_por)
     values ($1, $2, 'PRB-CAJA', 'Subcontrato de prueba de la caja diaria', 'PEN', 1000, $3) returning id`,
    [`QA-SC-${sello}`, subId, teso.id],
  ))[0].id
  ids.rec = (await consulta(
    `insert into recibos_honorarios (subcontrato_id, subcontratista_id, numero, fecha_emision, moneda, monto_bruto, retencion_porcentaje,
                                     archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
     values ($1::uuid, $2, $3, $4::date, 'PEN', 1000, 8, $1::text || '/' || gen_random_uuid() || '.pdf', 'application/pdf', 2048, $5) returning id`,
    [ids.sc, subId, N.rec, hoy, teso.id],
  ))[0].id
  ids.pd = (await consulta(
    `insert into planillas_diarias (numero, fecha, personas, total, enviada_por) values ($1, $2::date, 2, 300, $3) returning id`,
    [N.pd, hoy, teso.id],
  ))[0].id
  for (const [i, monto] of [[1, 100], [2, 200]]) {
    const [t] = await consulta(
      `insert into trabajadores (nombres, apellidos, dni, creado_por)
       select 'Persona', 'Prueba caja ' || $1::text, lpad(n::text, 8, '0'), $3 from generate_series(70000000 + $2::int * 100, 70000000 + $2::int * 100 + 99) n
        where not exists (select 1 from trabajadores w where w.dni = lpad(n::text, 8, '0')) limit 1 returning id`,
      [i, Number(sello.slice(-4)), teso.id],
    )
    await consulta(
      `insert into planilla_diaria_personas (planilla_id, trabajador_id, nombre, horas_ordinarias, horas_extras, monto_ordinarias, monto_extras, total)
       values ($1, $2, $3, 8, 0, $4, 0, $4)`,
      [ids.pd, t.id, `Persona prueba caja ${i}`, monto],
    )
  }
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}

const movimiento = async (origen, documento, campo) =>
  (await consulta(
    `select m.monto::float as monto, m.tipo, m.tipo_cambio::float as cambio, m.caja_id, m.codigo_interno, m.anulado_en
       from movimientos_caja m where m.origen = $1 and m.origen_id in (select id from ${campo.tabla} where ${campo.columna} = $2)
      order by m.creado_en`,
    [origen, documento],
  ))

// ---------------------------------------------------------------- 1–3. Tesorería paga y cobra
{
  const { pagina, contexto, errores } = await entrar(TESORERIA)

  // 1. Factura de compra en soles.
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const factura = pagina.locator('article', { hasText: N.adqPen })
  await factura.getByRole('button', { name: 'Registrar pago' }).click()
  let v = pagina.locator('[role="dialog"]')
  const opciones = limpio(await v.locator('select[name="caja_id"]').textContent())
  comprobar(opciones.includes(SOLES) && opciones.includes(DOLARES), 'el pago pide la cuenta de la caja, con las cuentas activas')
  await v.locator('input[name="monto"]').fill('500')
  await v.locator('input[name="referencia"]').fill(`OP-${sello}-1`)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const valido = await v.locator('select[name="caja_id"]').evaluate((el) => el.validity.valid)
  comprobar(!valido && (await v.isVisible()), 'sin elegir la cuenta no deja enviar')
  await elegirCuenta(v, SOLES)
  comprobar((await v.locator('input[name="monto_cuenta"]').count()) === 0, 'con la cuenta en soles no pide otro monto')
  const campoDia = v.locator('input[name="fecha"]')
  const haceCuarenta = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(Date.now() - 40 * 86400000))
  await campoDia.fill(haceCuarenta)
  comprobar(limpio(await v.textContent()).includes('se registra sin moverla'), 'con un día de antes del inicio de la cuenta, dice que el pago no la mueve')
  await campoDia.fill(hoy)
  comprobar(!limpio(await v.textContent()).includes('se registra sin moverla'), 'con el día de hoy ya no lo dice')
  const boton = v.getByRole('button', { name: 'Registrar el pago' })
  await boton.click()
  await boton.click({ timeout: 1000 }).catch(() => {})
  await boton.click({ timeout: 1000 }).catch(() => {})
  let error = await esperarVentana(pagina)
  comprobar(!error, `paga la factura desde la cuenta en soles${error ? ` (dijo «${error}»)` : ''}`)
  const movPen = await hasta(() => movimiento('PAGO_ADQUISICION', ids.adqPen, { tabla: 'pagos_adquisicion', columna: 'adquisicion_id' }), (r) => r.length > 0)
  const pagos = await consulta('select count(*)::int as n from pagos_adquisicion where adquisicion_id = $1', [ids.adqPen])
  comprobar(pagos[0].n === 1 && movPen.length === 1, `tres toques dejan un pago y un egreso (${pagos[0].n} pagos, ${movPen.length} egresos)`)
  comprobar(movPen[0]?.tipo === 'EGRESO' && movPen[0]?.monto === 500 && movPen[0]?.caja_id === ids.pen, 'el egreso es de S/ 500.00 en la cuenta en soles')
  // El aviso de la caja es un botón de la barra de arriba: se toca para leerlo
  // y se cierra con Escape, que no lo borra.
  const botonAviso = pagina.getByRole('button', { name: 'Lo que pasó en la caja diaria' })
  const cuadroAviso = pagina.locator('[data-aviso-caja]')
  const leerAviso = async () => {
    await botonAviso.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    if (!(await botonAviso.isVisible())) return ''
    if ((await botonAviso.getAttribute('aria-expanded')) !== 'true') await botonAviso.click()
    await cuadroAviso.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
    const texto = (await cuadroAviso.isVisible()) ? limpio(await cuadroAviso.textContent()) : ''
    await pagina.keyboard.press('Escape')
    return texto
  }
  comprobar(await cuadroAviso.isHidden().catch(() => true), 'el detalle del aviso llega cerrado, sin cuadro encima de la lista')
  const aviso = await leerAviso()
  comprobar(aviso.includes(`Salió de ${SOLES}`), `el aviso de la barra dice de qué cuenta salió («${aviso}»)`)
  comprobar((await cuadroAviso.isHidden()) && (await botonAviso.isVisible()), 'Escape cierra el detalle y el aviso se queda en la barra')

  // 1b. Una factura de hace cuarenta días pagada ese día, antes del inicio de la
  // cuenta: no mueve la caja, y eso no se esconde detrás del botón de la barra.
  await pagina.locator('article', { hasText: N.adqAntes }).getByRole('button', { name: 'Registrar pago' }).click()
  v = pagina.locator('[role="dialog"]')
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="fecha"]').fill(haceCuarenta)
  await v.locator('input[name="monto"]').fill('100')
  await v.locator('input[name="referencia"]').fill(`OP-${sello}-4`)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `paga la factura de antes del inicio de la cuenta${error ? ` (dijo «${error}»)` : ''}`)
  const alertaCaja = pagina.locator('main p[role="alert"]')
  await alertaCaja.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const textoAlerta = limpio(await alertaCaja.textContent().catch(() => ''))
  comprobar(textoAlerta.includes('La caja no se movió'), `que la caja no se movió se ve en la página sin tocar nada («${textoAlerta}»)`)
  comprobar(((await botonAviso.getAttribute('class')) ?? '').includes('text-aviso'), 'y el botón de la barra va en tono de aviso')
  const movAntes = await movimiento('PAGO_ADQUISICION', ids.adqAntes, { tabla: 'pagos_adquisicion', columna: 'adquisicion_id' })
  comprobar(movAntes.length === 0, `ese pago no deja movimiento en la caja (${movAntes.length})`)

  // 2. Factura en dólares desde la cuenta en soles.
  const facturaUsd = pagina.locator('article', { hasText: N.adqUsd })
  await facturaUsd.getByRole('button', { name: 'Registrar pago' }).click()
  v = pagina.locator('[role="dialog"]')
  await elegirCuenta(v, SOLES)
  const etiqueta = limpio(await v.getByText('Lo que salió de la cuenta, en soles').textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(etiqueta.length > 0, 'en otra moneda pide «Lo que salió de la cuenta, en soles»')
  await v.locator('input[name="referencia"]').fill(`OP-${sello}-2`)
  await v.locator('input[name="monto_cuenta"]').fill('370.00')
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `paga la factura en dólares desde soles${error ? ` (dijo «${error}»)` : ''}`)
  const movUsd = await hasta(() => movimiento('PAGO_ADQUISICION', ids.adqUsd, { tabla: 'pagos_adquisicion', columna: 'adquisicion_id' }), (r) => r.length > 0)
  comprobar(movUsd[0]?.monto === 370 && movUsd[0]?.cambio === 3.7, 'sale S/ 370.00 de la cuenta, al cambio de 3.70')
  // Saldada, la factura pasa a «Pagadas» sin su botón: su línea dice de qué cuenta salió y cuánto en soles.
  await pagina.reload({ waitUntil: 'networkidle' })
  const textoUsd = limpio(await pagina.locator('article', { hasText: N.adqUsd }).first().textContent().catch(() => ''))
  comprobar(textoUsd.includes(`salió de ${SOLES}: S/ 370.00`), `la factura saldada dice que salió S/ 370.00 de la cuenta en soles («${textoUsd.slice(0, 160)}»)`)

  // 3a. Orden de servicio, a cuenta (queda otra por pagar para mirarla en el teléfono).
  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  await pagina.locator(`[data-pagar-servicio="${N.os}"]`).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').fill('200')
  await v.locator('select[name="cancela"]').selectOption('no')
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `paga la orden de servicio${error ? ` (dijo «${error}»)` : ''}`)
  const movOs = await hasta(() => movimiento('PAGO_ORDEN_SERVICIO', ids.os, { tabla: 'pagos_orden_servicio', columna: 'orden_servicio_id' }), (r) => r.length > 0)
  comprobar(movOs[0]?.monto === 200 && movOs[0]?.codigo_interno === 'PRB-CAJA', 'el egreso del servicio lleva su código interno')

  // 3b. Factura de venta en dólares, a la cuenta en dólares.
  await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
  await pagina.locator(`[data-cobrar-factura="${N.fv}"]`).click()
  v = pagina.locator('[role="dialog"]')
  comprobar(limpio(await v.textContent()).includes('Cuenta a la que entró'), 'el cobro pide la cuenta a la que entró')
  await elegirCuenta(v, DOLARES)
  await v.locator('input[name="monto"]').fill('400')
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el cobro' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `cobra a cuenta en la cuenta en dólares${error ? ` (dijo «${error}»)` : ''}`)
  const movFv = await hasta(() => movimiento('COBRO_FACTURA_VENTA', ids.fv, { tabla: 'cobros_factura_venta', columna: 'factura_id' }), (r) => r.length > 0)
  comprobar(movFv[0]?.tipo === 'INGRESO' && movFv[0]?.monto === 400 && movFv[0]?.caja_id === ids.usd, 'entra un ingreso de US$ 400.00 a la cuenta en dólares')

  // 3c. Recibo por honorarios: el neto.
  await pagina.goto(`${BASE}/tesoreria/recibos-por-honorarios`, { waitUntil: 'networkidle' })
  await pagina.locator(`[data-pagar-recibo="${N.rec}"]`).click()
  v = pagina.locator('[role="dialog"]')
  await elegirCuenta(v, SOLES)
  await v.locator('input[type="file"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `paga el recibo por honorarios${error ? ` (dijo «${error}»)` : ''}`)
  const movRec = await hasta(() => movimiento('PAGO_RECIBO_HONORARIOS', ids.rec, { tabla: 'pagos_recibo_honorarios', columna: 'recibo_id' }), (r) => r.length > 0)
  comprobar(movRec[0]?.monto === 920, 'sale el neto del recibo, S/ 920.00, sin la retención')
  const avisoRecibo = await leerAviso()
  comprobar(avisoRecibo.includes(`Salió de ${SOLES}`), `el recibo pagado sale de la lista y el aviso se queda («${avisoRecibo}»)`)

  // 3d. Planilla diaria: dos personas, un egreso.
  await pagina.goto(`${BASE}/planilla-diaria/${ids.pd}`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-registrar-pago]').click()
  v = pagina.locator('[role="dialog"]')
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `paga la planilla diaria${error ? ` (dijo «${error}»)` : ''}`)
  const movPd = await hasta(() => movimiento('PAGO_PLANILLA_DIARIA', ids.pd, { tabla: 'planilla_diaria_pagos', columna: 'planilla_id' }), (r) => r.length > 0)
  comprobar(movPd.length === 1 && movPd[0]?.monto === 300, 'las dos personas salen en un solo egreso de S/ 300.00')
  const avisoPlanilla = await leerAviso()
  comprobar(avisoPlanilla.includes(`Salió de ${SOLES}`), `pagada toda la planilla, el aviso se queda («${avisoPlanilla}»)`)

  // Pagar el total saca el botón y su aviso: la línea del pago dice de qué cuenta salió.
  await pagina.reload({ waitUntil: 'networkidle' })
  const textoPlanilla = limpio(await pagina.locator('main').textContent().catch(() => ''))
  comprobar(textoPlanilla.includes(`salió de ${SOLES}`), 'la planilla ya pagada dice en su pago de qué cuenta salió')
  await pagina.goto(`${BASE}/tesoreria/recibos-por-honorarios?ver=pagados`, { waitUntil: 'networkidle' })
  const textoRecibo = limpio(await pagina.locator('li', { hasText: N.rec }).first().textContent().catch(() => ''))
  comprobar(textoRecibo.includes(`Salió de ${SOLES}`), 'el recibo pagado dice de qué cuenta salió')

  // 4. La caja diaria.
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tr', { hasText: `Pago de la factura ${N.adqPen}` })
  const textoFila = limpio(await fila.textContent().catch(() => ''))
  comprobar(textoFila.includes('Pago de factura de compra') && textoFila.includes('Se anula en: Cuentas por pagar'),
    'la caja muestra el pago con su origen y dónde se anula')
  comprobar((await fila.locator('button').count()) === 0, 'y sin botón para anularlo suelto')
  const enlace = await fila.locator('a', { hasText: 'Cuentas por pagar' }).getAttribute('href').catch(() => null)
  comprobar(enlace === '/tesoreria/por-pagar', 'el enlace lleva a Cuentas por pagar')
  const enlacePlanilla = await pagina.locator('tr', { hasText: N.pd }).locator('a', { hasText: 'su planilla' }).getAttribute('href').catch(() => null)
  comprobar(enlacePlanilla === `/planilla-diaria/${ids.pd}`, 'el pago de la planilla se anula en su planilla, no en la lista')
  const filaSaldo = limpio(await pagina.locator('table').first().locator('tr', { hasText: SOLES }).textContent().catch(() => ''))
  comprobar(filaSaldo.includes('2,290.00') && filaSaldo.includes('7,710.00'), `de la cuenta en soles salen S/ 2,290.00 y queda en S/ 7,710.00 («${filaSaldo}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'pagos-caja-diaria.png'), fullPage: true })

  // 5. Anular el pago de la factura anula su egreso.
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  await pagina.locator('article', { hasText: N.adqPen }).getByRole('button', { name: 'Anular' }).first().click()
  v = pagina.locator('[role="dialog"]')
  comprobar(limpio(await v.textContent()).includes('la caja diaria anula su egreso'), 'la ventana de anular avisa que la caja anula su egreso')
  await v.locator('textarea[name="motivo"]').fill('El banco devolvió la transferencia.')
  await v.getByRole('button', { name: 'Anular' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `anula el pago${error ? ` (dijo «${error}»)` : ''}`)
  const anulado = await hasta(() => movimiento('PAGO_ADQUISICION', ids.adqPen, { tabla: 'pagos_adquisicion', columna: 'adquisicion_id' }), (r) => !!r[0]?.anulado_en)
  comprobar(!!anulado[0]?.anulado_en, 'su egreso en la caja queda anulado')
  const avisoAnular = await leerAviso()
  comprobar(avisoAnular.includes('también quedó anulado'), `y la pantalla lo dice («${avisoAnular}»)`)

  // 5b. Un pago cuyo día ya se cerró: anularlo deja su egreso en ese día y devuelve hoy lo que salió.
  const ayer = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(Date.now() - 86400000))
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const facturaCierre = pagina.locator('article', { hasText: N.adqCierre })
  await facturaCierre.getByRole('button', { name: 'Registrar pago' }).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').fill('50')
  await v.locator('input[name="referencia"]').fill(`OP-${sello}-3`)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="fecha"]').fill(ayer)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `paga ayer la tercera factura${error ? ` (dijo «${error}»)` : ''}`)
  const delCierre = { tabla: 'pagos_adquisicion', columna: 'adquisicion_id' }
  await hasta(() => movimiento('PAGO_ADQUISICION', ids.adqCierre, delCierre), (r) => r.length > 0)
  // Tesorería cierra ayer en la cuenta en soles: con su sesión, como en el cierre de Caja diaria.
  await base.query('begin')
  try {
    await consulta('select test.como_usuario($1)', [teso.id])
    await base.query('set local role authenticated')
    const [{ saldo }] = await consulta(
      `select coalesce(saldo_final, 0)::float as saldo from caja_del_dia($1::date) where caja_id = $2`,
      [ayer, ids.pen],
    )
    await consulta('select cerrar_dia_caja(gen_random_uuid(), $1, $2::date, $3, null)', [ids.pen, ayer, saldo])
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
  await pagina.reload({ waitUntil: 'networkidle' })
  await facturaCierre.getByRole('button', { name: 'Registrar pago' }).click()
  v = pagina.locator('[role="dialog"]')
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="fecha"]').fill(ayer)
  comprobar(limpio(await v.textContent()).includes('La cuenta está cerrada hasta el'), 'con el día cerrado, el formulario lo dice antes de enviar')
  await pagina.keyboard.press('Escape')
  await v.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await facturaCierre.getByRole('button', { name: 'Anular' }).first().click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('Se pagó dos veces al proveedor.')
  await v.getByRole('button', { name: 'Anular' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `anula el pago de un día cerrado${error ? ` (dijo «${error}»)` : ''}`)
  const tras = await hasta(() => movimiento('PAGO_ADQUISICION', ids.adqCierre, delCierre), (r) => r.length > 1)
  const propio = tras.find((m) => m.tipo === 'EGRESO')
  const devolucion = tras.find((m) => m.tipo === 'INGRESO')
  comprobar(!!propio && !propio.anulado_en, 'su egreso se queda en el día cerrado')
  comprobar(!!devolucion && !devolucion.anulado_en && devolucion.monto === 50 && devolucion.caja_id === ids.pen,
    'y hoy vuelven S/ 50.00 a la misma cuenta')
  const avisoCierre = await leerAviso()
  comprobar(avisoCierre.includes(`hoy vuelve a ${SOLES}`), `la pantalla dice que hoy vuelve a la cuenta («${avisoCierre}»)`)
  await pagina.reload({ waitUntil: 'networkidle' })
  const lineaCierre = limpio(await pagina.locator('article', { hasText: N.adqCierre }).textContent().catch(() => ''))
  comprobar(lineaCierre.includes(`salió de ${SOLES}`) && lineaCierre.includes('y volvió el'), `la línea del pago dice que salió y volvió («${lineaCierre}»)`)
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  const filaDevolucion = limpio(await pagina.locator('tr', { hasText: `Anulación del pago` }).filter({ hasText: N.adqCierre }).textContent().catch(() => ''))
  comprobar(filaDevolucion.includes('devolución de uno anulado'), `la caja de hoy muestra la devolución y por qué («${filaDevolucion}»)`)

  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 6. El teléfono
{
  const { pagina, contexto } = await entrar(TESORERIA, CELULAR)
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  comprobar(ancho <= 0, `la caja entra en el teléfono (sobran ${ancho} px)`)
  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  const otro = pagina.locator('[data-pagar-servicio]').first()
  if (await otro.count()) {
    await otro.click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('select[name="caja_id"]').waitFor({ timeout: 5000 }).catch(() => {})
    const caja = await v.locator('select[name="caja_id"]').boundingBox()
    comprobar(!!caja && caja.x >= 0 && caja.x + caja.width <= CELULAR.width, 'en el teléfono el desplegable de la cuenta entra en la ventana')
    await pagina.screenshot({ path: join(CAPTURAS, 'pagos-caja-telefono.png') })
  } else {
    comprobar(true, '(no quedó otra orden de servicio por pagar para mirar la ventana en el teléfono)')
  }
  await contexto.close()
}

// ---------------------------------------------------------------- 7. Gerencia
{
  const { pagina, contexto } = await entrar(GERENCIA)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('article', { hasText: N.adqUsd }).count()) === 1
    && (await pagina.locator('[data-pagar-factura]').count()) === 0, 'Gerencia ve la factura sin el botón de pagar')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLA(S)` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

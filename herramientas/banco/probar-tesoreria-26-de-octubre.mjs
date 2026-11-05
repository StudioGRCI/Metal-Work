/**
 * Recorre con clic real los cuatro arreglos que DKS pidió para Tesorería el
 * 26/10 (migraciones 20261026100000 y 20261026110000), con la cuenta de
 * Tesorería (nunca ADMIN):
 *
 *   1. Pagos de servicio: la OS de S/ 1,800 sin IGV se ve por S/ 2,124.00 con
 *      IGV; la ventana del pago dice lo que falta de cada parte y propone
 *      S/ 1,869.00 al proveedor (el total con IGV menos la detracción de
 *      S/ 255), a cuenta mientras falte la detracción. Al elegir la detracción
 *      propone S/ 255.00 en soles. Se deposita la detracción y después el resto,
 *      con lo que la ventana propone, y la orden queda pagada. En otra OS, la
 *      base no deja cancelar sin la detracción y la ventana lo dice.
 *   2. Cuentas por pagar nombra el código interno de cada factura y de cada
 *      compra a crédito sin comprobante, no la OT ni «Para almacén».
 *   3. El globo de Caja diaria en el menú cuenta las cuentas con días sin cerrar.
 *   4. En Cotización, Tesorería ve el cliente de las cotizaciones aprobadas.
 *
 * Arma lo suyo por SQL en la base del banco, con un sello distinto en cada
 * corrida. Necesita la cuenta `tesoreria.local@metalwork.test`.
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
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}

async function elegirCuenta(v, nombre) {
  const valor = await v.locator('select[name="caja_id"] option', { hasText: nombre }).getAttribute('value')
  await v.locator('select[name="caja_id"]').selectOption(valor)
}

// ------------------------------------------------- archivos y armazón
const archivos = join(CAPTURAS, 'archivos-tesoreria-26')
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
const SOLES = `Banco prueba IGV ${sello}`
const N = {
  os: `QA-OS-IGV-${sello}`,
  os2: `QA-OS-IGV2-${sello}`,
  codigoCredito: `PRB-CRE-${sello}`,
  codigoFactura: `PRB-FAC-${sello}`,
  factura: `F997-${sello}`,
}

const [teso] = await consulta(`select id from usuarios where correo = $1`, [TESORERIA])
const [gere] = await consulta(`select u.id from usuarios u join roles r on r.id = u.rol_id where r.codigo = 'GERENTE' and u.activo limit 1`)
const [cont] = await consulta(`select u.id from usuarios u join roles r on r.id = u.rol_id where r.codigo = 'CONTABILIDAD' and u.activo limit 1`)
const [logi] = await consulta(`select u.id from usuarios u join roles r on r.id = u.rol_id where r.codigo = 'COMPRADOR' and u.activo limit 1`)
if (!teso || !gere || !cont || !logi) throw new Error('Faltan las cuentas de Tesorería, Gerencia, Contabilidad o Logística en la base del banco.')

const ids = {}
await base.query('begin')
try {
  // Una cuenta en soles que empezó hace tres días, con un movimiento de hace dos
  // que nadie cerró: su globo. Un día sin movimientos no hay que cerrarlo
  // (caja_del_dia mira los movimientos, no el inicio de la cuenta).
  ids.caja = (await consulta(
    `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
     values ($1, 'BANCO', 'BANCO DE PRUEBA', 'PEN', 10000, $2::date - 3, $3) returning id`,
    [SOLES, hoy, teso.id],
  ))[0].id
  await consulta(
    `insert into movimientos_caja (caja_id, fecha, tipo, monto, descripcion, registrado_por)
     values ($1, $2::date - 2, 'INGRESO', 50, $3, $4)`,
    [ids.caja, hoy, `Ingreso de prueba ${SOLES}`, teso.id],
  )
  const [prov] = await consulta(
    `insert into proveedores (numero_documento, razon_social)
     select '2010098' || $1::text || d, 'PROVEEDOR PRUEBA IGV' from generate_series(0, 9) d where ruc_es_valido('2010098' || $1::text || d) limit 1
     on conflict (tipo_documento, numero_documento) do update set activo = true
     returning id`,
    [sello.slice(0, 3)],
  )
  ids.prov = prov.id
  // Dos OS de S/ 1,800 sin IGV, con detracción del 12 % (020, mínimo S/ 700).
  for (const [clave, numero] of [['os', N.os], ['os2', N.os2]]) {
    ids[clave] = (await consulta(
      `insert into ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, monto_pen, moneda, codigo_interno, aprobacion, aprobado_por, aprobado_en, creado_por,
                                     detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo)
       values ($1, $2, 'PROVEEDOR PRUEBA IGV', 'Servicio de prueba con IGV y detracción', 1800, 1800, 'PEN', 'PRB-IGV', 'APROBADA', $3, now(), $4,
               true, '020', 12, 700) returning id`,
      [numero, prov.id, gere.id, logi.id],
    ))[0].id
  }
  // Una OC a crédito sin comprobante y otra con su factura registrada, cada una con su código.
  const [mat] = await consulta(`select id from materiales where activo and not unidad_pendiente order by codigo limit 1`)
  for (const [clave, referencia, condicion, dias, codigo] of [
    ['ocCredito', `QA-CRE-${sello}`, 'CREDITO', 30, N.codigoCredito],
    ['ocFactura', `QA-FAC-${sello}`, 'CONTADO', 0, N.codigoFactura],
  ]) {
    ids[clave] = (await consulta(
      `insert into ordenes_compra_materiales (proveedor_id, proveedor, referencia, condicion_pago, dias_credito, moneda, origen, motivo, con_factura,
                                              creado_por, aprobacion, codigo_interno)
       values ($1, 'PROVEEDOR PRUEBA IGV', $2, $3, $4, 'PEN', 'DIRECTA', 'Reposición de prueba', true, $5, 'NO_REQUERIDA', $6) returning id`,
      [prov.id, referencia, condicion, dias, logi.id, codigo],
    ))[0].id
    await consulta(`insert into orden_compra_material_detalles (orden_compra_id, cantidad, precio_unitario, material_id) values ($1, 1, 100, $2)`, [ids[clave], mat.id])
  }
  ids.factura = (await consulta('select gen_random_uuid() as id'))[0].id
  await consulta(
    `insert into adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, registrado_por)
     values ($1, $2, 'FACTURA_COMPRA', 'PROVEEDOR PRUEBA IGV', $3, $4::date, $4::date, 'PEN', 118, 'CONTADO', $5)`,
    [ids.factura, ids.ocFactura, N.factura, hoy, cont.id],
  )
  await consulta(
    `insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('comprobantes-financieros', 'adquisiciones/' || $1::text || '/comprobante.pdf', $2::text, '{"mimetype": "application/pdf", "size": 2048}')`,
    [ids.factura, cont.id],
  )
  await consulta(
    `update adquisiciones set ruta_storage = 'adquisiciones/' || $1::text || '/comprobante.pdf', estado = 'REGISTRADA' where id = $1`,
    [ids.factura],
  )
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}

const pagosDe = (os) =>
  consulta(`select destino, moneda, monto::float as monto, cancela from pagos_orden_servicio where orden_servicio_id = $1 and anulado_en is null order by creado_en`, [os])

// ---------------------------------------------------------------- 1. Pagos de servicio
{
  const { pagina, contexto, errores } = await entrar(TESORERIA)
  await pagina.goto(`${BASE}/tesoreria/pagos-de-servicio`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('article', { hasText: N.os })
  const texto = limpio(await tarjeta.innerText())
  comprobar(texto.includes('Total S/ 2,124.00 con IGV'), `la OS dice su total con IGV, S/ 2,124.00 («${texto.slice(0, 200)}»)`)
  comprobar(texto.includes('Falta S/ 1,869.00 al proveedor y S/ 255.00 de detracción'), 'a la vista, lo que falta: S/ 1,869.00 al proveedor y S/ 255.00 de detracción')

  await pagina.locator(`[data-pagar-servicio="${N.os}"]`).click()
  let v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').waitFor({ timeout: 5000 })
  const descripcion = limpio(await v.textContent())
  comprobar(
    descripcion.includes('Falta pagar S/ 1,869.00 al proveedor y S/ 255.00 de detracción, del total de S/ 2,124.00 con IGV'),
    `la ventana dice lo que falta de cada parte («${descripcion.slice(0, 220)}»)`,
  )
  comprobar((await v.locator('input[name="monto"]').inputValue()) === '1869.00', 'propone S/ 1,869.00 al proveedor')
  comprobar((await v.locator('select[name="cancela"]').inputValue()) === 'no', 'mientras falte la detracción, propone el pago a cuenta')
  await pagina.screenshot({ path: join(CAPTURAS, 'pago-servicio-proveedor.png'), caret: 'initial' })

  await v.locator('select[name="destino"]').selectOption('DETRACCION')
  comprobar((await v.locator('input[name="monto"]').inputValue()) === '255.00', 'al elegir la detracción propone S/ 255.00')
  comprobar(limpio(await v.textContent()).includes('Importe pagado (soles)'), 'la detracción se escribe en soles')
  comprobar(limpio(await v.textContent()).includes('no tiene su cuenta del Banco de la Nación'), 'al elegir la detracción, la ventana busca su cuenta del Banco de la Nación')
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="operacion"]').fill(`CONST-${sello}`)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await pagina.screenshot({ path: join(CAPTURAS, 'pago-servicio-detraccion.png'), caret: 'initial' })
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  let error = await esperarVentana(pagina)
  comprobar(!error, `deposita la detracción${error ? ` (dijo «${error}»)` : ''}`)
  let pagos = await hasta(() => pagosDe(ids.os), (r) => r.length > 0)
  comprobar(pagos.length === 1 && pagos[0].destino === 'DETRACCION' && pagos[0].moneda === 'PEN' && pagos[0].monto === 255 && !pagos[0].cancela,
    `queda un pago de S/ 255 a la detracción, a cuenta (${JSON.stringify(pagos)})`)
  const [mov] = await consulta(
    `select descripcion, monto::float as monto from movimientos_caja where origen = 'PAGO_ORDEN_SERVICIO' and origen_id = (select id from pagos_orden_servicio where orden_servicio_id = $1 limit 1)`,
    [ids.os],
  )
  comprobar(mov?.monto === 255 && mov.descripcion.startsWith(`Detracción de la ${N.os}`), `la caja anota «Detracción de la ${N.os}» (${mov?.descripcion})`)

  // Lo que queda: al proveedor, con lo que la ventana propone.
  await pagina.locator(`[data-pagar-servicio="${N.os}"]`).waitFor({ timeout: 15000 })
  const tarjetaDespues = await hasta(async () => limpio(await pagina.locator('article', { hasText: N.os }).textContent()), (t) => t.includes('Detracción depositada'))
  comprobar(tarjetaDespues.includes('Falta S/ 1,869.00 al proveedor') && !tarjetaDespues.includes('S/ 255.00 de detracción') && tarjetaDespues.includes('Detracción depositada S/ 255.00'),
    'depositada la detracción, la tarjeta dice que solo falta S/ 1,869.00 al proveedor')
  await pagina.locator(`[data-pagar-servicio="${N.os}"]`).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').waitFor({ timeout: 5000 })
  comprobar((await v.locator('select[name="destino"]').inputValue()) === 'PROVEEDOR', 'vuelve a proponer el pago al proveedor')
  comprobar((await v.locator('input[name="monto"]').inputValue()) === '1869.00', 'propone los S/ 1,869.00 que faltan')
  comprobar((await v.locator('select[name="cancela"]').inputValue()) === 'si', 'con la detracción depositada, propone que cancela')
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error, `paga al proveedor lo que falta${error ? ` (dijo «${error}»)` : ''}`)
  pagos = await hasta(() => pagosDe(ids.os), (r) => r.length > 1)
  comprobar(pagos.length === 2 && pagos[1].destino === 'PROVEEDOR' && pagos[1].monto === 1869 && pagos[1].cancela, 'el pago al proveedor de S/ 1,869 cancela la orden')
  await pagina.locator(`[data-pagar-servicio="${N.os}"]`).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  comprobar((await pagina.locator(`[data-pagar-servicio="${N.os}"]`).count()) === 0, 'pagada entera, la orden sale de «Por pagar»')

  // Otra OS: cancelar sin la detracción no entra, y la ventana dice por qué.
  await pagina.locator(`[data-pagar-servicio="${N.os2}"]`).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').waitFor({ timeout: 5000 })
  await v.locator('select[name="cancela"]').selectOption('si')
  comprobar(limpio(await v.textContent()).includes('Falta depositar S/ 255.00 de detracción: regístrala antes de cancelar'), 'al elegir «Sí» con la detracción pendiente, la ventana lo avisa antes de enviar')
  await elegirCuenta(v, SOLES)
  await v.locator('input[name="archivo"]').setInputFiles(VOUCHER)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  error = await esperarVentana(pagina)
  comprobar(error.includes('Falta depositar S/ 255.00 de detracción'), `no deja cancelar sin la detracción («${error}»)`)
  comprobar((await pagosDe(ids.os2)).length === 0, 'y no queda ningún pago')
  await v.getByRole('button', { name: 'Cancelar' }).click()

  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 2. Cuentas por pagar
{
  const { pagina, contexto, errores } = await entrar(TESORERIA)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const factura = limpio(await pagina.locator('article', { hasText: N.factura }).textContent())
  comprobar(factura.includes(`código ${N.codigoFactura}`) && !/\bsin OT\b|\bOT\b/.test(factura), `la factura nombra su código interno («${factura.slice(0, 200)}»)`)
  const [{ numero: ocCredito }] = await consulta(`select numero from ordenes_compra_materiales where id = $1`, [ids.ocCredito])
  const credito = limpio(await pagina.locator('div.border', { hasText: ocCredito }).last().innerText({ timeout: 5000 }).catch(() => ''))
  comprobar(credito.toLowerCase().includes(`código ${N.codigoCredito}`.toLowerCase()) && !credito.includes('Para almacén'), `la compra a crédito nombra su código interno («${credito.slice(0, 200)}»)`)
  const todo = limpio(await pagina.locator('main').textContent())
  comprobar(!todo.includes('sin OT') && !todo.includes('Para almacén'), 'Cuentas por pagar ya no dice «sin OT» ni «Para almacén»')
  await pagina.screenshot({ path: join(CAPTURAS, 'por-pagar-codigos.png'), fullPage: true, caret: 'initial' })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 3. El globo de Caja diaria
{
  await base.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [
    teso.id,
    JSON.stringify({ sub: teso.id, role: 'authenticated' }),
  ])
  const [{ n }] = await consulta(`select count(*)::int as n from caja_del_dia($1::date) where caja_id is not null and primer_dia_sin_cerrar < $1::date`, [hoy])
  const { pagina, contexto, errores } = await entrar(TESORERIA)
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  const enlace = pagina.locator('nav a[href="/tesoreria/caja-diaria"]').first()
  const etiqueta = limpio(await hasta(() => enlace.getAttribute('aria-label'), (t) => Boolean(t)))
  const esperado = `Caja diaria, ${n} ${n === 1 ? 'pendiente' : 'pendientes'}`
  comprobar(n >= 1 && etiqueta === esperado, `el globo de Caja diaria cuenta ${n} cuenta(s) con días sin cerrar («${etiqueta}»)`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 4. El cliente en Cotización
{
  const aprobadas = await consulta(
    `select c.numero, cl.razon_social from cotizaciones_pdf c join clientes cl on cl.id = c.cliente_id
      where c.estado::text <> 'ANULADA' and cotizacion_fue_aprobada(c.id) order by c.creado_en desc limit 5`,
  )
  const { pagina, contexto, errores } = await entrar(TESORERIA)
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const texto = limpio(await pagina.locator('main').textContent())
  comprobar(aprobadas.length > 0, `hay cotizaciones aprobadas para mirar (${aprobadas.length})`)
  for (const a of aprobadas) comprobar(texto.includes(a.razon_social), `Tesorería ve el cliente de la ${a.numero}: ${a.razon_social}`)
  comprobar(!texto.includes('Cliente reservado'), 'ninguna aprobada dice «Cliente reservado»')
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-cliente.png'), fullPage: true, caret: 'initial' })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} FALLA(S)` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

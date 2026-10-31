/**
 * Clic real sobre la nota de crédito del proveedor (migración 20261022190000),
 * con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Un RQ pide 10 de un material; Logística los compra a 10 con IGV, el
 *      conductor los deja y Almacén los valida. Contabilidad tiene registrada la
 *      factura F1 de esa OC (118) y otra factura F2 del mismo proveedor (59), y
 *      Almacén devolvió 2 sin reposición (sembrado por SQL, con cada cuenta).
 *   2. Contabilidad ve la devolución en «Esperan nota de crédito», registra la
 *      nota con su PDF y F1 baja a 94.40. Tesorería paga lo que queda.
 *   3. Contabilidad registra en la fila de F1 una nota por un descuento de 30:
 *      F1 ya estaba pagada y los 30 quedan a favor.
 *   4. Tesorería, en el teléfono, descuenta 20 de F2 y registra que el
 *      proveedor devolvió los 10 que quedan, a una cuenta de la caja. Después
 *      quita el descuento.
 *   5. Requerimientos ve el descuento en el gasto del código.
 *   6. Contabilidad anula la primera nota: F1 vuelve a deber y la devolución
 *      vuelve a esperar su nota.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_ARCHIVOS, CAPTURAS y el correo de cada cuenta si no es la
 * `<puesto>.local@metalwork.test` que siembra `preparar.sh`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = join(process.env.CAPTURAS ?? '/tmp/banco-capturas', 'nota-credito')
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(
  ['requerimientos', 'almacen', 'logistica', 'gerencia', 'conductor', 'contabilidad', 'tesoreria'].map((p) => [p, cuenta(p)]),
)
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })
const PDF_NOTA = join(CAPTURAS, 'nota.pdf')
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
writeFileSync(PDF_NOTA, PDF)

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

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
async function rucNuevo() {
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
/** Un archivo de quien lo sube, en el disco del banco y en `storage.objects`. */
async function archivo(bucket, ruta, puesto) {
  mkdirSync(dirname(join(ARCHIVOS, bucket, ruta)), { recursive: true })
  writeFileSync(join(ARCHIVOS, bucket, ruta), PDF)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4, jsonb_build_object('mimetype', 'application/pdf', 'size', $5::bigint))`,
    [bucket, ruta, ids[CUENTAS[puesto]], ids[CUENTAS[puesto]], PDF.length],
  )
}
const [{ hoy }] = await consulta(`select (now() at time zone 'America/Lima')::date::text as hoy`)
const PROVEEDOR = `DISCOS NOTA ${SUFIJO} S.A.C.`
const RUC = await rucNuevo()
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 427, Trujillo', '999 000 427') returning id`,
  [RUC, PROVEEDOR],
)
const MATERIAL = `Disco banco ${SUFIJO}`
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id)
   values ($1, $2, (select id from categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
           (select id from unidades_medida where codigo = 'UND')) returning id`,
  [`BAN427-${SUFIJO}`, MATERIAL],
)
const [{ rq, oc, ing, dev, f1, f2, pago }] = await consulta(
  `select gen_random_uuid() as rq, gen_random_uuid() as oc, gen_random_uuid() as ing, gen_random_uuid() as dev,
          gen_random_uuid() as f1, gen_random_uuid() as f2, gen_random_uuid() as pago`)
const [{ id: areaMtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const codigoUnidad = `BAN427_${SUFIJO}`
await consulta(`insert into unidades (placa, tipo_vehiculo, marca, codigo_interno, activo) values ($1, 'CAMION', 'Volvo', $2, true)`,
  [`C${SUFIJO.slice(0, 2)}-${SUFIJO.slice(2, 5)}`, codigoUnidad])
await como('requerimientos')
await consulta(`select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Discos para el banco de la nota de crédito', null, $4::jsonb)`,
  [rq, areaMtz, codigoUnidad, JSON.stringify([{ material_id: material, cantidad: 10 }])])
await como('almacen')
await consulta(`select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]'::jsonb, null)`, [rq])
const [{ id: linea }] = await consulta(`select l.id from requerimiento_lineas l where l.requerimiento_id = $1`, [rq])
await como('logistica')
await consulta(`select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, $4, null, 'CONTADO', 0, 'PEN', true)`,
  [oc, JSON.stringify([{ material_id: material, cantidad: 10, precio: 10, insumos: [linea] }]), proveedor, `COT-NC-${SUFIJO}`])
await como('gerencia')
await consulta(`select public.aprobar_compra($1) from ordenes_compra_materiales where id = $1 and aprobacion = 'POR_APROBAR'`, [oc])
await como('logistica')
await consulta(`select public.mandar_compra_a_recojo($1)`, [oc])
await consulta(`select public.programar_recojo($1, 25, null)`, [oc])
await como('conductor')
await consulta(`select public.marcar_compra_en_recojo($1)`, [oc])
await consulta(`select public.marcar_compra_recogida($1)`, [oc])
await consulta(`select public.marcar_compra_dejada_almacen($1)`, [oc])
await como('almacen')
const [{ id: pendiente }] = await consulta(`select id from ingresos_pendientes_almacen where orden_compra_id = $1`, [oc])
await consulta(`select public.validar_ingresos_compra($1, $2::jsonb, null)`, [oc, JSON.stringify([{ id: pendiente, movimiento_id: ing, cantidad: 10 }])])
await consulta(`select public.devolver_al_proveedor($1, $2, 2, $3, 'Dos discos llegaron partidos', false)`, [dev, ing, `GR-NC-${SUFIJO}`])
const [{ numero: ocNumero }] = await consulta(`select numero from ordenes_compra_materiales where id = $1`, [oc])
const F1 = `F427-${SUFIJO.slice(0, 5)}1`
const F2 = `F427-${SUFIJO.slice(0, 5)}2`
await como('contabilidad')
await consulta(
  `insert into adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, orden_compra_id)
   values ($1, 'FACTURA_COMPRA', $3, $4, $5, $7::date - 3, $7::date - 3, 'PEN', 118, 'CONTADO', $8),
          ($2, 'FACTURA_TESORERIA', $3, $4, $6, $7::date - 3, $7::date - 3, 'PEN', 59, 'CONTADO', null)`,
  [f1, f2, PROVEEDOR, RUC, F1, F2, hoy, oc],
)
for (const f of [f1, f2]) {
  await archivo('comprobantes-financieros', `adquisiciones/${f}/comprobante.pdf`, 'contabilidad')
  await consulta(`update adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA' where id = $1`, [f])
}
const CAJA = `Banco nota ${SUFIJO}`
const [{ id: caja }] = await consulta(
  `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
   values ($1, 'BANCO', 'BANCO DE PRUEBA', 'PEN', 1000, $2::date - 30, $3) returning id`,
  [CAJA, hoy, ids[CUENTAS.tesoreria]],
)
await consulta(`select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)`)
console.log(`  siembra: ${ocNumero} compra 10 de ${MATERIAL}; ${F1} (118) y ${F2} (59) de ${PROVEEDOR}; Almacén devolvió 2`)

const saldo = async (f) =>
  Number((await consulta(`select a.total - coalesce((select sum(p.monto) from pagos_adquisicion p where p.adquisicion_id = a.id and p.anulado_en is null), 0) as s from adquisiciones a where a.id = $1`, [f]))[0].s)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    // El corte a propósito de la sección 7 deja su error de red en la consola.
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket') && !/ERR_CONNECTION_RESET|Failed to fetch/.test(m.text())) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('response', (r) => {
    if (r.status() >= 400) errores.push(`${correo}: ${r.status()} ${r.request().method()} ${r.url().replace(/[?#].*$/, '')}`)
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
const anchoDe = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth)

// La acción de servidor que lleva `corte.armado` en su cuerpo llega y se
// cumple; su respuesta no llega. `quedan` cuenta cuántas veces: la subida
// repite sola el envío cuando no le llega la respuesta, así que para que la
// persona vea «No llegó la respuesta» se cortan las dos.
async function armarCorte(contexto, pagina) {
  const cdp = await contexto.newCDPSession(pagina)
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] })
  const corte = { armado: null, quedan: 0, cortadas: 0 }
  const cuerpo = (r) => r.postData ?? (r.postDataEntries ?? []).map((x) => Buffer.from(x.bytes ?? '', 'base64').toString()).join('')
  cdp.on('Fetch.requestPaused', async (e) => {
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    if (corte.armado && corte.quedan > 0 && e.request.method === 'POST' && h['next-action'] && cuerpo(e.request).includes(corte.armado)) {
      if (--corte.quedan === 0) corte.armado = null
      corte.cortadas++
      return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => {})
    }
    return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
  })
  return corte
}

/**
 * Envía con las dos respuestas cortadas, cambia algo y vuelve a enviar: el
 * primer envío ya había entrado. Devuelve lo que la ventana muestra 4 s
 * después del aviso: antes de 68b43d7 se cerraba sola en menos de uno.
 */
async function reenviarTrasElCorte(pagina, corte, v, { boton, marca, cambiar }) {
  corte.armado = marca
  corte.quedan = 2
  await v.getByRole('button', { name: boton }).click()
  const sinRespuesta = await v.locator('[role="alert"]', { hasText: 'No llegó la respuesta' }).waitFor({ timeout: 45000 }).then(() => true, () => false)
  await cambiar()
  await v.getByRole('button', { name: boton }).click()
  const neutro = v.locator('[data-ya-entro]')
  await neutro.waitFor({ timeout: 30000 }).catch(() => {})
  await pagina.waitForTimeout(4000)
  return {
    sinRespuesta,
    cortadas: corte.cortadas,
    dijo: limpio(await neutro.textContent().catch(() => '')),
    sigue: await neutro.isVisible().catch(() => false),
    cursor: await neutro.evaluate((p) => document.activeElement === p).catch(() => false),
    soloCerrar: (await v.getByRole('button', { name: boton }).count()) === 0
      && (await v.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).count()) === 1,
  }
}

try {
  // ------------------------------------------------------------ 2. Contabilidad, nota por lo devuelto
  const { pagina: con } = await entrar(CUENTAS.contabilidad)
  await con.goto(`${BASE}/adquisiciones?vista=facturas#notas-credito`, { waitUntil: 'networkidle' })
  const espera = con.locator(`#notas-credito [data-espera-nota="${ocNumero}"]`)
  comprobar((await espera.count()) === 1, `Contabilidad ve la devolución de la ${ocNumero} en «Esperan nota de crédito»`)
  comprobar(limpio(await espera.textContent()).includes(`${MATERIAL}: 2`), 'la fila dice qué y cuánto se devolvió')
  await espera.getByRole('button', { name: new RegExp(`nota de crédito de la factura ${F1}`) }).click()
  let v = con.getByRole('dialog')
  await v.waitFor()
  comprobar((await v.locator('select[name="tipo"]').inputValue()) === 'DEVOLUCION' && (await v.locator('select[name="devolucion"]').inputValue()) === dev,
    'la ventana llega con «lo devuelto» y esa devolución ya elegidos')
  await v.locator('input[name="numero"]').fill(`fc01-${SUFIJO}`)
  await v.locator('input[name="monto"]').fill('23.60')
  await v.locator('textarea[name="motivo"]').fill('Dos discos partidos devueltos al proveedor')
  await v.locator('input[name="archivo"]').setInputFiles(PDF_NOTA)
  await v.getByRole('button', { name: 'Registrar la nota' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const alerta = await v.locator('[role="alert"]').textContent().catch(() => null)
  const [n1] = await consulta(`select id, numero, archivo_ruta, devolucion_id from notas_credito_compra where adquisicion_id = $1 and tipo = 'DEVOLUCION'`, [f1])
  comprobar(n1?.numero === `FC01-${SUFIJO}` && n1?.devolucion_id === dev, `la nota entra en mayúsculas y ligada a la devolución${alerta ? ` (dijo «${limpio(alerta)}»)` : ''}`)
  const [obj] = n1 ? await consulta(`select owner_id from storage.objects where bucket_id = 'notas-credito' and name = $1`, [n1.archivo_ruta]) : []
  comprobar(obj?.owner_id === ids[CUENTAS.contabilidad] && n1?.archivo_ruta.startsWith(`${f1}/`), 'el PDF quedó en notas-credito/{factura}/…, de Contabilidad')
  comprobar((await saldo(f1)) === 94.4, 'F1 baja a 94.40')
  await con.waitForLoadState('networkidle')
  comprobar(limpio(await con.locator('body').textContent()).includes(`La factura ${F1} bajó S/ 23.60`), 'el aviso dice cuánto bajó la factura')
  comprobar((await con.locator(`#notas-credito [data-espera-nota="${ocNumero}"]`).count()) === 0, 'la devolución ya no espera nota')
  const filaNota = con.locator(`table [data-nota-credito="FC01-${SUFIJO}"]`)
  comprobar((await filaNota.count()) === 1 && limpio(await filaNota.textContent()).includes('por lo devuelto'), 'la factura muestra su nota en la tabla')
  await con.screenshot({ path: join(CAPTURAS, '1-contabilidad-nota.png'), fullPage: true })

  // Tesorería paga lo que queda de F1 (por SQL: el pago ya tiene su propia prueba).
  await como('tesoreria')
  const rutaPago = `${f1}/${pago}.pdf`
  await archivo('pagos-facturas', rutaPago, 'tesoreria')
  await consulta(`select public.registrar_pago_factura($1, $2, $3::date, 94.40, 'OP-NC', $4, $5, null)`, [pago, f1, hoy, rutaPago, caja])
  await consulta(`select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)`)

  // ------------------------------------------------------------ 3. Contabilidad, descuento sobre la factura pagada
  await con.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  await con.locator(`table [data-registrar-nota="${F1}"]`).click()
  v = con.getByRole('dialog')
  await v.waitFor()
  await v.locator('select[name="tipo"]').selectOption('DESCUENTO')
  comprobar((await v.locator('select[name="devolucion"]').count()) === 0, 'con «descuento» no se pide devolución')
  await v.locator('input[name="numero"]').fill(`FC01-${SUFIJO}1`)
  await v.locator('input[name="monto"]').fill('30')
  await v.locator('textarea[name="motivo"]').fill('Descuento por pronto pago acordado')
  await v.locator('input[name="archivo"]').setInputFiles(PDF_NOTA)
  await v.getByRole('button', { name: 'Registrar la nota' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await con.waitForLoadState('networkidle')
  const [n2] = await consulta(`select id from notas_credito_compra where numero = $1`, [`FC01-${SUFIJO}1`])
  comprobar(Boolean(n2), 'la nota por descuento entra')
  comprobar(limpio(await con.locator('body').textContent()).includes('Quedan S/ 30.00 a favor'), 'el aviso dice que quedan 30 a favor para Tesorería')
  const [aviso] = await consulta(`select count(*)::int as n from notificaciones where usuario_id = $1 and titulo = $2`, [ids[CUENTAS.tesoreria], `Saldo a favor: nota de crédito FC01-${SUFIJO}1`])
  comprobar(aviso.n === 1, 'Tesorería recibe el aviso del saldo a favor')

  // ------------------------------------------------------------ 4. Tesorería, en el teléfono
  const { pagina: tes } = await entrar(CUENTAS.tesoreria, { width: 390, height: 844 })
  await tes.goto(`${BASE}/tesoreria/por-pagar#notas-credito`, { waitUntil: 'networkidle' })
  const tarjeta = tes.locator(`[data-nota-a-favor="FC01-${SUFIJO}1"]`)
  comprobar((await tarjeta.count()) === 1 && limpio(await tarjeta.textContent()).includes('A favor S/ 30.00'), 'Tesorería ve la nota con S/ 30.00 a favor')
  comprobar((await tes.locator('a[href="#notas-credito"]', { hasText: /notas? de crédito a favor/ }).count()) === 1, 'el encabezado avisa de la nota a favor')
  const aFavorEnF2 = tes.locator(`[data-a-favor-de-la-factura="${F2}"]`)
  comprobar((await aFavorEnF2.count()) === 1 && limpio(await aFavorEnF2.textContent()).includes(`S/ 30.00 a favor en la nota FC01-${SUFIJO}1`),
    `la factura ${F2} dice que el proveedor tiene S/ 30.00 a favor`)
  comprobar((await tes.locator(`[data-a-favor-de-la-factura="${F1}"]`).count()) === 0, 'la factura de la propia nota no la ofrece')
  await tarjeta.getByRole('button', { name: `Descontar la nota FC01-${SUFIJO}1 de otra factura` }).click()
  v = tes.getByRole('dialog')
  await v.waitFor()
  comprobar((await v.locator('select[name="factura"]').inputValue()) === f2 && (await v.locator('input[name="monto"]').inputValue()) === '30.00',
    `la ventana propone ${F2} y los 30`)
  await v.locator('input[name="monto"]').fill('20')
  await v.getByRole('button', { name: 'Descontar' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await tes.waitForLoadState('networkidle')
  comprobar((await saldo(f2)) === 39, 'F2 baja a 39')
  await tarjeta.waitFor()
  await tes.waitForFunction((t) => document.querySelector(`[data-nota-a-favor="${t}"]`)?.textContent?.includes('A favor S/ 10.00'), `FC01-${SUFIJO}1`, { timeout: 15000 }).catch(() => {})
  comprobar(limpio(await tarjeta.textContent()).includes('A favor S/ 10.00'), 'a la nota le quedan 10')

  await tarjeta.getByRole('button', { name: `El proveedor devolvió lo de la nota FC01-${SUFIJO}1` }).click()
  v = tes.getByRole('dialog')
  await v.waitFor()
  comprobar((await v.locator('input[name="monto"]').inputValue()) === '10.00', 'la ventana propone los 10 que quedan')
  const valor = await v.locator('select[name="caja_id"] option', { hasText: CAJA }).getAttribute('value')
  await v.locator('select[name="caja_id"]').selectOption(valor)
  await v.locator('input[name="operacion"]').fill(`OP-DEV-${SUFIJO}`)
  await v.locator('input[name="archivo"]').setInputFiles(PDF_NOTA)
  await v.getByRole('button', { name: 'Registrar la devolución' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await tes.waitForLoadState('networkidle')
  const [reem] = await consulta(`select r.id, r.archivo_ruta from reembolsos_nota_credito r where r.nota_credito_id = $1 and r.anulado_en is null`, [n2?.id])
  const ingreso = reem ? await consulta(`select tipo, monto::float as monto, caja_id from movimientos_caja where origen = 'REEMBOLSO_NOTA_CREDITO' and origen_id = $1`, [reem.id]) : []
  comprobar(ingreso.length === 1 && ingreso[0].tipo === 'INGRESO' && ingreso[0].monto === 10 && ingreso[0].caja_id === caja, 'los 10 entran a la caja elegida como un ingreso')
  comprobar(reem?.archivo_ruta.startsWith(`${n2?.id}/`), 'la constancia quedó en notas-credito/{nota}/…')
  await tes.waitForFunction((t) => document.querySelector(`[data-nota-a-favor="${t}"]`)?.textContent?.includes('Usada entera'), `FC01-${SUFIJO}1`, { timeout: 15000 }).catch(() => {})
  comprobar(limpio(await tarjeta.textContent()).includes('Usada entera'), 'la nota queda usada entera, con sus dos usos a la vista')
  comprobar((await anchoDe(tes)) <= 390, 'en el teléfono la página no se sale de los 390 px')
  await tes.screenshot({ path: join(CAPTURAS, '2-tesoreria-nota.png'), fullPage: true })

  await tarjeta.getByRole('button', { name: new RegExp(`Quitar el descuento de la factura ${F2}`) }).click()
  v = tes.getByRole('dialog')
  await v.waitFor()
  await v.locator('textarea[name="motivo"]').fill('Se descontó de la factura equivocada')
  await v.getByRole('button', { name: 'Quitar' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await tes.waitForLoadState('networkidle')
  comprobar((await saldo(f2)) === 59, 'quitado el descuento, F2 vuelve a deber 59')

  // ------------------------------------------------------------ 5. Requerimientos ve el descuento en el código
  const { pagina: req } = await entrar(CUENTAS.requerimientos)
  await req.goto(`${BASE}/requerimientos/gasto-por-codigo/detalle?codigo=${codigoUnidad}`, { waitUntil: 'networkidle' })
  const texto = limpio(await req.locator('main').textContent())
  comprobar(texto.includes(`Nota de crédito FC01-${SUFIJO}1`) && texto.includes('25.42'), 'Requerimientos ve en el código la nota que baja S/ 25.42')

  // ------------------------------------------------------------ 6. Contabilidad anula la primera nota
  await con.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  await con.locator(`table [data-anular-nota="FC01-${SUFIJO}"]`).click()
  v = con.getByRole('dialog')
  await v.waitFor()
  await v.locator('textarea[name="motivo"]').fill('Se registró contra la factura equivocada')
  await v.getByRole('button', { name: 'Anular' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  await con.waitForLoadState('networkidle')
  const [anulada] = await consulta(`select anulado_en is not null as si from notas_credito_compra where id = $1`, [n1?.id])
  comprobar(anulada?.si === true && (await saldo(f1)) === 23.6, 'anulada la nota, F1 vuelve a deber 23.60')
  // Desde la misma dirección, el ancla sola no recarga: se recarga la página.
  await con.reload({ waitUntil: 'networkidle' })
  comprobar((await con.locator(`#notas-credito [data-espera-nota="${ocNumero}"]`).count()) === 1, 'la devolución vuelve a esperar su nota')

  // ------------------------------------------------------------ 7. La respuesta perdida y el reenvío con otro importe
  // La nota y la devolución del dinero suben su archivo a una ruta nueva en
  // cada envío: reenviadas tras una respuesta perdida, ya entraron la primera
  // vez. La ventana lo dice sin rojo y con el cursor en el aviso, solo ofrece
  // «Cerrar», sigue a la vista hasta que se cierra, el archivo nuevo no queda
  // suelto y, al volver a abrirla, se puede registrar otra.
  {
    const { pagina: c7, contexto: x7 } = await entrar(CUENTAS.contabilidad)
    const corte = await armarCorte(x7, c7)
    await c7.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
    await c7.locator(`table [data-registrar-nota="${F1}"]`).click()
    v = c7.getByRole('dialog')
    await v.waitFor()
    await v.locator('select[name="tipo"]').selectOption('DESCUENTO')
    await v.locator('input[name="numero"]').fill(`FC01-${SUFIJO}7`)
    await v.locator('input[name="monto"]').fill('3')
    const motivo7 = `Descuento por embalaje roto ${SUFIJO}`
    await v.locator('textarea[name="motivo"]').fill(motivo7)
    await v.locator('input[name="archivo"]').setInputFiles(PDF_NOTA)
    const vio = await reenviarTrasElCorte(c7, corte, v, {
      boton: 'Registrar la nota',
      marca: motivo7,
      cambiar: () => v.locator('input[name="monto"]').fill('4'),
    })
    comprobar(vio.sinRespuesta && vio.cortadas === 2, `[Contabilidad] se pierden las dos respuestas de la nota y la ventana dice «No llegó la respuesta» (${vio.cortadas} cortadas)`)
    comprobar(vio.dijo.includes('Esta nota de crédito ya quedó registrada la primera vez que la enviaste') && vio.sigue && vio.cursor && vio.soloCerrar,
      `[Contabilidad] con otro importe, dice sin rojo que ya quedó, con el cursor en el aviso, solo ofrece «Cerrar» y sigue a la vista 4 s después (${JSON.stringify(vio)})`)
    const notas7 = await consulta(`select monto::float as monto, archivo_ruta from notas_credito_compra where numero = $1`, [`FC01-${SUFIJO}7`])
    const sueltos7 = await consulta(
      `select o.name from storage.objects o where o.bucket_id = 'notas-credito' and o.name like $1
          and not exists (select 1 from notas_credito_compra n where n.archivo_ruta = o.name)
          and not exists (select 1 from reembolsos_nota_credito r where r.archivo_ruta = o.name)`,
      [`${f1}/%`],
    )
    comprobar(notas7.length === 1 && notas7[0].monto === 3 && sueltos7.length === 0,
      `[Contabilidad] queda la nota de la primera vez, por 3, y ningún PDF suelto (${notas7.length} nota, ${notas7[0]?.monto}; ${sueltos7.length} sueltos)`)
    await c7.screenshot({ path: join(CAPTURAS, '7-contabilidad-ya-quedo.png'), fullPage: true })
    await v.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).click()
    await v.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
    const enLaTabla = await c7.locator(`table [data-nota-credito="FC01-${SUFIJO}7"]`).waitFor({ timeout: 15000 }).then(() => true, () => false)
    comprobar(enLaTabla, '[Contabilidad] al cerrar, la tabla ya muestra la nota que entró')
    await c7.locator(`table [data-registrar-nota="${F1}"]`).click()
    v = c7.getByRole('dialog')
    await v.waitFor()
    const limpia = (await v.locator('[role="alert"]').count()) === 0 && (await v.getByRole('button', { name: 'Registrar la nota' }).count()) === 1
    comprobar(limpia, '[Contabilidad] al volver a abrir, la ventana llega sin el aviso y deja registrar otra')
    await v.getByRole('button', { name: 'Cancelar' }).click()
    await x7.close()

    const { pagina: t7, contexto: y7 } = await entrar(CUENTAS.tesoreria, { width: 390, height: 844 })
    const corteT = await armarCorte(y7, t7)
    await t7.goto(`${BASE}/tesoreria/por-pagar#notas-credito`, { waitUntil: 'networkidle' })
    const tarjeta7 = t7.locator(`[data-nota-a-favor="FC01-${SUFIJO}1"]`)
    comprobar(limpio(await tarjeta7.textContent()).includes('A favor S/ 20.00'), '[Tesorería] quitado el descuento, la nota vuelve a tener S/ 20.00 a favor')
    await tarjeta7.getByRole('button', { name: `El proveedor devolvió lo de la nota FC01-${SUFIJO}1` }).click()
    v = t7.getByRole('dialog')
    await v.waitFor()
    const valor7 = await v.locator('select[name="caja_id"] option', { hasText: CAJA }).getAttribute('value')
    await v.locator('select[name="caja_id"]').selectOption(valor7)
    await v.locator('input[name="monto"]').fill('5')
    await v.locator('input[name="operacion"]').fill(`OP-CORTE-${SUFIJO}`)
    await v.locator('input[name="archivo"]').setInputFiles(PDF_NOTA)
    const vioT = await reenviarTrasElCorte(t7, corteT, v, {
      boton: 'Registrar la devolución',
      marca: `OP-CORTE-${SUFIJO}`,
      cambiar: () => v.locator('input[name="monto"]').fill('6'),
    })
    comprobar(vioT.sinRespuesta && vioT.dijo.includes('Esta devolución ya quedó registrada la primera vez que la enviaste') && vioT.sigue && vioT.cursor && vioT.soloCerrar,
      `[Tesorería 390] la devolución del dinero con otro importe: aviso sin rojo, cursor en él, solo «Cerrar», a la vista 4 s después (${JSON.stringify(vioT)})`)
    const reem7 = await consulta(`select monto::float as monto from reembolsos_nota_credito where nota_credito_id = $1 and operacion = $2`, [n2?.id, `OP-CORTE-${SUFIJO}`])
    const caja7 = await consulta(`select count(*)::int as n from movimientos_caja m join reembolsos_nota_credito r on r.id = m.origen_id where m.origen = 'REEMBOLSO_NOTA_CREDITO' and r.operacion = $1`, [`OP-CORTE-${SUFIJO}`])
    const sueltosT = await consulta(
      `select o.name from storage.objects o where o.bucket_id = 'notas-credito' and o.name like $1
          and not exists (select 1 from reembolsos_nota_credito r where r.archivo_ruta = o.name)`,
      [`${n2?.id}/%`],
    )
    comprobar(reem7.length === 1 && reem7[0].monto === 5 && caja7[0].n === 1 && sueltosT.length === 0,
      `[Tesorería 390] queda la devolución de la primera vez, por 5, un solo ingreso en la caja y ninguna constancia suelta (${reem7.length}, ${reem7[0]?.monto}; caja ${caja7[0].n}; ${sueltosT.length} sueltos)`)
    await t7.screenshot({ path: join(CAPTURAS, '7-tesoreria-ya-quedo.png'), fullPage: true })
    await v.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).click()
    await v.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
    await t7.waitForFunction((t) => document.querySelector(`[data-nota-a-favor="${t}"]`)?.textContent?.includes('A favor S/ 15.00'), `FC01-${SUFIJO}1`, { timeout: 15000 }).catch(() => {})
    comprobar(limpio(await tarjeta7.textContent()).includes('A favor S/ 15.00'), '[Tesorería 390] al cerrar, la nota ya dice S/ 15.00 a favor')
    await tarjeta7.getByRole('button', { name: `El proveedor devolvió lo de la nota FC01-${SUFIJO}1` }).click()
    v = t7.getByRole('dialog')
    await v.waitFor()
    comprobar((await v.locator('[role="alert"]').count()) === 0 && (await v.locator('input[name="monto"]').inputValue()) === '15.00'
      && (await v.getByRole('button', { name: 'Registrar la devolución' }).count()) === 1,
      '[Tesorería 390] al volver a abrir, la ventana propone los 15 que quedan, sin el aviso')
    await v.getByRole('button', { name: 'Cancelar' }).click()
    await y7.close()
  }
} finally {
  await navegador.close()
  await base.end()
}

const reales = errores.filter((e) => !e.includes('favicon'))
comprobar(reales.length === 0, `sin errores de consola ni respuestas de error${reales.length ? `: ${reales.slice(0, 5).join(' | ')}` : ''}`)
console.log(fallas.length === 0 ? 'Todo pasa' : `${fallas.length} fallan`)
process.exit(fallas.length === 0 ? 0 : 1)

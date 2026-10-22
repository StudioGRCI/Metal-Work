/**
 * Clic real sobre el RUC de la factura de compra (migración 20261022170000) y la
 * factura de una OC con boleta que se dio por pagada fuera (20261022175000), con
 * la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Contabilidad marca una OC con factura: el RUC sale solo de su proveedor;
 *      con otro RUC escrito, el campo lo dice antes de registrar. Registra la
 *      factura y la base la guarda con el RUC de la OC.
 *   2. Elige la factura que Logística anexó a una OC con boleta de antes del
 *      20/10: el RUC sale de esa OC y no se escribe; al registrarla, el aviso
 *      dice que espera que Contabilidad diga si ya se pagó.
 *   3. Tesorería la ve «Espera a Contabilidad», sin botón para pagarla.
 *   4. Contabilidad dice «Ya se pagó» con su fecha, su monto y su nota: queda el
 *      pago hecho fuera, la factura lo toma y deja de esperar.
 *   5. Tesorería ve lo que falta (la factura es por más) con su botón de pago, y
 *      en la OC con boleta el pago anotado fuera del sistema.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * CAPTURAS, BANCO_ARCHIVOS (la carpeta del servidor del banco) y el correo de cada cuenta si no es la
 * `<puesto>.local@metalwork.test` que siembra `preparar.sh`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = join(process.env.CAPTURAS ?? '/tmp/banco-capturas', 'ruc-y-espera')
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'contabilidad', 'tesoreria', 'gerencia'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })
const PDF_COMPROBANTE = join(CAPTURAS, 'minimo.pdf')
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
writeFileSync(PDF_COMPROBANTE, PDF)

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
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())

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
const RUC_UNO = await rucNuevo()
const RUC_DOS = await rucNuevo()
const PROV_UNO = `ACEROS RUC ${SUFIJO} S.A.C.`
const PROV_DOS = `FERRETERÍA BOLETA ${SUFIJO} E.I.R.L.`
const [{ id: provUno }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 424, Trujillo', '999 000 424') returning id`,
  [RUC_UNO, PROV_UNO],
)
const [{ id: provDos }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 425, Trujillo', '999 000 425') returning id`,
  [RUC_DOS, PROV_DOS],
)
const [{ id: material }] = await consulta(`select id from materiales where activo and not coalesce(unidad_pendiente, false) order by codigo limit 1`)
const [{ a: ocUno, b: ocDos, d: doc }] = await consulta(`select gen_random_uuid() as a, gen_random_uuid() as b, gen_random_uuid() as d`)
await como('logistica')
for (const [oc, prov, conFactura] of [[ocUno, provUno, true], [ocDos, provDos, false]]) {
  await consulta(
    `select public.emitir_compra_directa($1, $2, $3, 'Reposición del almacén (banco del RUC)', $4::jsonb, $5::date + 5, 'CONTADO', 0, 'PEN', $6, 'PLANTA')`,
    [oc, prov, `COT-RUC-${SUFIJO}`, JSON.stringify([{ material_id: material, cantidad: 4, precio: 100 }]), hoy, conFactura],
  )
}
await como('gerencia')
await consulta(`select public.aprobar_compra(id) from ordenes_compra_materiales where id = any($1) and aprobacion = 'POR_APROBAR'`, [[ocUno, ocDos]])
// La de antes del 20/10: la base no deja marcarla, como la migración marcó las de antes.
await consulta(`set session_replication_role = replica`)
await consulta(`update ordenes_compra_materiales set pago_en_tesoreria = false where id = $1`, [ocDos])
await consulta(`set session_replication_role = origin`)
const [uno] = await consulta(`select numero, public.total_orden_compra(id) as total from ordenes_compra_materiales where id = $1`, [ocUno])
const [dos] = await consulta(`select numero, public.total_orden_compra(id) as total from ordenes_compra_materiales where id = $1`, [ocDos])
// Logística anexa a la OC con boleta la factura que mandó el proveedor.
const FA = `F424-${SUFIJO}`
const FB = `F425-${SUFIJO}`
await como('logistica')
const rutaAnexo = `compra/${ocDos}/${doc}.pdf`
mkdirSync(dirname(join(ARCHIVOS, 'documentos-compras', rutaAnexo)), { recursive: true })
writeFileSync(join(ARCHIVOS, 'documentos-compras', rutaAnexo), PDF)
await consulta(
  `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('documentos-compras', $1, $2::uuid, $3, jsonb_build_object('mimetype', 'application/pdf', 'size', $4::bigint))`,
  [rutaAnexo, ids[CUENTAS.logistica], ids[CUENTAS.logistica], PDF.length],
)
await consulta(
  `insert into documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision)
   values ($1, $2, 'FACTURA', 'factura.pdf', $3, 'application/pdf', $7, $4, $5, $6)`,
  [doc, ocDos, rutaAnexo, ids[CUENTAS.logistica], FB, hoy, PDF.length],
)
console.log(`  siembra: ${uno.numero} (${PROV_UNO}, RUC ${RUC_UNO}) · ${dos.numero} con boleta, de antes (${PROV_DOS}, RUC ${RUC_DOS}) · anexo ${FB}`)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
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

// ------------------------------------------------------- 1. El RUC sale de la OC
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  await pagina.locator(`input[name="ordenes_compra"][value="${ocUno}"]`).check()
  comprobar((await pagina.locator('#adq-ruc').inputValue()) === RUC_UNO, `marcada la ${uno.numero}, el RUC sale de su proveedor (${RUC_UNO})`)
  await pagina.locator('#adq-ruc').fill(RUC_DOS)
  const aviso = limpio(await pagina.locator('#adq-ruc-otro').textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(aviso.includes(RUC_UNO) && aviso.includes(uno.numero), `con otro RUC escrito, el campo lo dice antes de registrar («${aviso}»)`)
  await pagina.locator('#adq-ruc').fill(`${RUC_UNO.slice(0, 2)}-${RUC_UNO.slice(2)}`)
  comprobar((await pagina.locator('#adq-ruc-otro').count()) === 0, 'con su RUC, aunque lleve un guion, el aviso se va')
  await pagina.locator('#adq-numero').fill(FA)
  await pagina.locator('#adq-total').fill(Number(uno.total).toFixed(2))
  await pagina.locator('#adq-emision').fill(hoy)
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await pagina.locator('#adq-pdf').setInputFiles(PDF_COMPROBANTE)
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText(`Comprobante ${FA} registrado`).waitFor({ timeout: 30000 }).catch(() => {})
  const error = limpio(await pagina.locator('form [role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  const [fa] = await consulta(`select ruc_proveedor, estado from adquisiciones where numero_documento = $1`, [FA])
  comprobar(!error && fa?.estado === 'REGISTRADA' && fa?.ruc_proveedor === RUC_UNO, `la factura entra con el RUC sin guion${error ? ` (dijo «${error}»)` : ''}`)

  // ----------------------------------------------- 2. El anexo de la OC con boleta de antes
  await pagina.locator('#adq-documento').selectOption(doc)
  comprobar((await pagina.locator('#adq-ruc').inputValue()) === RUC_DOS, 'elegido el anexo, el RUC sale del proveedor de su OC')
  comprobar((await pagina.locator('#adq-numero').inputValue()) === FB, 'el número sale del anexo')
  await pagina.locator('#adq-total').fill((Number(dos.total) + 20).toFixed(2))
  await pagina.locator('#adq-emision').fill(hoy)
  await pagina.locator('#adq-vencimiento').fill(hoy)
  // Si Logística anexó la factura de otra empresa, el RUC se corrige y el campo lo dice sin enviar nada.
  await pagina.locator('#adq-ruc').fill(RUC_UNO)
  const deOtra = limpio(await pagina.locator('#adq-ruc-otro').textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(deOtra.includes(dos.numero) && deOtra.includes(RUC_DOS), `con el RUC de otra empresa, dice que la OC del anexo es de otro RUC («${deOtra}»)`)
  let envios = 0
  const contar = (r) => {
    if (r.method() === 'POST' && r.url().includes('/adquisiciones')) envios++
  }
  pagina.on('request', contar)
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.waitForTimeout(800)
  pagina.off('request', contar)
  comprobar(envios === 0 && (await pagina.locator('#adq-ruc').evaluate((e) => e === document.activeElement)), 'y no se envía: el foco vuelve al RUC')
  await pagina.locator('#adq-ruc').fill(RUC_DOS)
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText(`Comprobante ${FB} registrado`).waitFor({ timeout: 30000 }).catch(() => {})
  const mensaje = limpio(await pagina.getByText(`Comprobante ${FB} registrado`).textContent({ timeout: 500 }).catch(() => ''))
  comprobar(mensaje.includes('se dio por pagada fuera') && mensaje.includes(dos.numero), `al registrarla, dice que espera («${mensaje}»)`)
  const [espera] = await consulta(
    `select x.compra from adquisiciones a cross join lateral public.compra_pagada_fuera_de_la_factura(a) x where a.numero_documento = $1`,
    [FB],
  )
  comprobar(espera?.compra === dos.numero, 'la base la tiene en espera de Contabilidad')
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 1280, `la página no se ensancha (${ancho} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, '1-contabilidad-registra.png'), fullPage: true })
  await contexto.close()
}

// ---------------------------------------------------- 3. Tesorería no la paga
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('article', { hasText: FB }).first()
  const texto = limpio(await tarjeta.textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(texto.includes('Espera a Contabilidad') && texto.includes(dos.numero) && texto.includes('Saldo por confirmar'),
    'Tesorería la ve «Espera a Contabilidad», con su OC y el saldo por confirmar')
  const cabeza = limpio(await pagina.getByText(/^Por pagar:/).first().textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(/esperan? a Contabilidad/.test(cabeza), `el encabezado cuenta las que esperan a Contabilidad («${cabeza}»)`)
  comprobar((await tarjeta.getByRole('button', { name: 'Registrar pago' }).count()) === 0, 'y no tiene botón para pagarla')
  await pagina.screenshot({ path: join(CAPTURAS, '2-tesoreria-en-espera.png'), fullPage: true })
  await contexto.close()
}

// ------------------------------------------------- 4. Contabilidad: «Ya se pagó»
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad, { width: 390, height: 844 })
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const vista = limpio(await pagina.getByRole('link', { name: /Pago por confirmar/ }).first().textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(/\d/.test(vista), `la pestaña «Pago por confirmar» cuenta las que esperan («${vista}»)`)
  await pagina.goto(`${BASE}/adquisiciones?vista=por-confirmar`, { waitUntil: 'networkidle' })
  // El elemento más hondo que tiene esta factura y su botón: hay otras en espera de vueltas anteriores.
  const yaSePago = pagina.locator('button:visible', { hasText: 'Ya se pagó' })
  const fila = pagina.locator('*:visible', { hasText: FB, has: yaSePago }).last()
  const boton = fila.locator(yaSePago)
  comprobar((await fila.getByText('Di si se pagó').count()) > 0 && (await boton.count()) === 1,
    'en el teléfono, en «Pago por confirmar», la factura le pide a Contabilidad que diga si se pagó')
  await boton.click()
  const v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('#pb-monto').inputValue()) === Number(dos.total).toFixed(2), 'lo pagado sale con el total de la OC')
  await v.locator('#pb-fecha').fill(hoy)
  await v.locator('#pb-nota').fill('corto')
  await v.getByRole('button', { name: 'Anotar que ya se pagó' }).click()
  comprobar(await v.locator('#pb-nota').evaluate((e) => !e.checkValidity()), 'con una nota corta no se envía')
  await v.locator('#pb-nota').fill(`Transferencia del banco de prueba ${SUFIJO}, según el estado de cuenta`)
  await v.getByRole('button', { name: 'Anotar que ya se pagó' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const anotado = limpio(await pagina.getByText('Anotado:').first().textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(anotado.includes('toma lo que se pagó fuera'), `la pantalla lo confirma («${anotado}»)`)
  await pagina.waitForTimeout(3000)
  comprobar((await pagina.getByText('Anotado:').count()) > 0, 'y lo anotado sigue a la vista cuando la fila deja de esperar')
  const [pago] = await consulta(`select monto, pagado_fuera, archivo_ruta from pagos_orden_compra where orden_compra_id = $1 and anulado_en is null`, [ocDos])
  comprobar(pago && Number(pago.monto) === Number(dos.total) && pago.pagado_fuera?.includes(SUFIJO) && pago.archivo_ruta === null,
    'queda el pago de la OC hecho fuera, sin voucher, con la nota')
  const [factura] = await consulta(
    `select a.total - coalesce((select sum(x.monto) from pagos_adquisicion x where x.adquisicion_id = a.id and x.anulado_en is null), 0) as saldo
       from adquisiciones a where a.numero_documento = $1`,
    [FB],
  )
  comprobar(Number(factura?.saldo) === 20, `la factura lo toma y le faltan los 20.00 que es por más (falta ${factura?.saldo})`)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono la página no se corre de costado (${ancho} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, '3-contabilidad-ya-se-pago.png'), fullPage: true })
  await contexto.close()
}

// -------------------------------------------- 5. Tesorería paga lo que falta
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('article', { hasText: FB }).first()
  const texto = limpio(await tarjeta.textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(!texto.includes('Espera a Contabilidad') && texto.includes('20.00'), 'ya no espera, y el saldo es lo que falta')
  comprobar((await tarjeta.getByRole('button', { name: 'Registrar pago' }).count()) === 1, 'Tesorería tiene su botón para pagar la diferencia')
  const boleta = limpio(await pagina.locator('article', { hasText: dos.numero }).filter({ hasText: 'pagado fuera del sistema' }).first().textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(boleta.includes('según Contabilidad'), 'en la OC con boleta se lee el pago anotado fuera del sistema')
  await pagina.screenshot({ path: join(CAPTURAS, '4-tesoreria-paga-la-diferencia.png'), fullPage: true })
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length) {
  console.log('Errores de consola:')
  for (const e of errores) console.log('  ', e)
}
comprobar(errores.length === 0, 'sin errores de consola')
console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

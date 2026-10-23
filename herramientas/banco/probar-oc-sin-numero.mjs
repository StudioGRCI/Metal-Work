/**
 * Las OC de antes de la serie OC-…-MW no tienen número de la casa, y su
 * referencia es la cotización del proveedor. En producción, Adquisiciones ›
 * Facturas la mostraba sola, como si fuera el número de la OC («OC-0001»), y
 * Gerencia no tenía Adquisiciones en su menú (2026-10-22). Con clic real y la
 * cuenta de cada puesto (nunca ADMIN), consultando la base después del clic:
 *
 *   1. Gerencia tiene Adquisiciones en «Consultas» y la abre; la OC sin número
 *      sale «OC sin número» con su referencia aparte. En Aprobación, la lista de
 *      las que puede anular la nombra igual, porque el nombre lo arma la base
 *      (migración 20261022220000), y en el teléfono no ensancha la página.
 *   2. Contabilidad la ve igual en el formulario (también el aviso de otro
 *      RUC), registra su factura, y la tabla la nombra igual. En «Corregir»,
 *      la lista también; el detector, al leer un PDF que menciona la otra OC
 *      sin número, la nombra «OC sin número (ref. del proveedor …)»; la suma,
 *      y el historial dice cuál se sumó. En el teléfono, igual y sin ensanchar
 *      la página. El PDF de la OC sale «SIN NÚMERO», sin pedir que la
 *      referencia se cite como número.
 *   3. Tesorería ve la factura en Cuentas por pagar con la OC nombrada así, y
 *      el PDF de la OC con el mismo nombre; en Facturas, «Pagar en Cuentas por
 *      pagar». En el teléfono, la tarjeta de la OC con boleta no se desborda.
 *      Logística le anexa a otra la boleta de una parte, y el aviso a Tesorería
 *      y su tarjeta en «Boletas de una parte» la nombran igual.
 *   4. Gerencia, que lee Cuentas por pagar y no paga, ve en Facturas «Ver en
 *      Cuentas por pagar».
 *
 * Siembra cuatro OC del RQ, aprobadas: tres con factura y una con boleta, para
 * su tarjeta de Cuentas por pagar en el teléfono. Les quita el número como a una
 * de antes de la serie (sin disparadores: ninguna pantalla deja hacerlo). Corre
 * las veces que haga falta. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * CAPTURAS, BANCO_BASE, ARCHIVOS y el correo de cada cuenta si no es
 * `<puesto>.local@metalwork.test`. Lee el PDF con `pdftotext` (poppler).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.ARCHIVOS ?? CAPTURAS
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'contabilidad', 'tesoreria', 'gerencia', 'requerimientos', 'almacen'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(ARCHIVOS, { recursive: true })

/** Un PDF de una página con texto que el detector puede leer (Helvetica, WinAnsi). */
function pdfConTexto(lineas) {
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = []
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

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

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
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

/** El texto de todas las filas de una factura: la primera la nombra y las demás siguen hasta su rowspan. */
async function grupo(pagina, numero) {
  const primera = pagina.locator('tbody tr', { hasText: numero }).first()
  if ((await primera.count()) === 0) return ''
  const alto = Number((await primera.locator('td[rowspan]').first().getAttribute('rowspan').catch(() => '1')) ?? 1)
  const textos = [await primera.textContent()]
  for (let i = 1; i < alto; i++) textos.push(await primera.locator(`xpath=following-sibling::tr[${i}]`).textContent())
  return textos.join(' ')
}

/** Espera a que la ventana se cierre o diga por qué no; devuelve lo que dijo. */
async function terminarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 60000 }), v.locator('[role="alert"]').waitFor({ timeout: 60000 })]).catch(() => {})
  return limpio((await v.locator('[role="alert"]').allTextContents().catch(() => [])).join(' '))
}

/** Los textos del menú, sin el contador del final. */
const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+$/, ''))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const PROVEEDOR = `ACEROS SIN NÚMERO ${SUFIJO} S.A.C.`
// Las referencias tienen la forma de un número de OC: es justo lo que confundía.
// Sin ceros delante, para que el detector las lea igual que la pantalla.
const REFERENCIA = `OC-${1000 + (Number(SUFIJO) % 8999)}`
const REFERENCIA_2 = `OC-${1000 + ((Number(SUFIJO) + 1) % 8999)}`
const FACTURA = `F903-${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
async function rucLibre() {
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
const RUC = await rucLibre()
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 903, Lima', '999 903 903') returning id`,
  [RUC, PROVEEDOR],
)
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: und }] = await consulta(`select id from unidades_medida where codigo = 'UND'`)
const [{ id: cat }] = await consulta(`select id from categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id) values ($1, $2, $3, $4) returning id`,
  [`SN-${SUFIJO}`, `Plancha LAC 1/8" (${SUFIJO})`, cat, und],
)

/**
 * Una OC de su RQ, aprobada, de 295.00 al contado, con factura (o con boleta si
 * `conFactura` es false); después, sin número y con `referencia`.
 */
async function ocSinNumero(referencia, conFactura = true) {
  const [{ id: rq }] = await consulta(`select gen_random_uuid() as id`)
  await como('requerimientos')
  await consulta(
    `select public.emitir_requerimiento($1, $2, 'PLA_SR_O4_1_26/21', $3, null,
       jsonb_build_array(jsonb_build_object('descripcion', 'Plancha', 'cantidad', 1, 'unidad_medida_id', $4::text, 'categoria_id', $5::text)))`,
    [rq, area, `Prueba de la OC sin número ${SUFIJO} (${referencia})`, und, cat],
  )
  await como('almacen')
  await consulta(`select public.rq_marcar_sin_stock($1, 'No hay nada de esto')`, [rq])
  await como('logistica')
  const [{ id: oc }] = await consulta(
    `select public.emitir_compra_del_requerimiento(gen_random_uuid(), $1, array[1]::smallint[], $2, null,
       jsonb_build_array(jsonb_build_object('material_id', $3::text, 'cantidad', 1, 'precio', 250::numeric)), null, 'CONTADO', 0, 'PEN', $4) as id`,
    [rq, proveedor, material, conFactura],
  )
  await como('gerencia')
  await consulta(`select public.aprobar_compra($1)`, [oc])
  // Como una de antes de la serie: sin número de la casa, con la referencia del proveedor.
  await base.query('begin')
  await base.query(`set local session_replication_role = replica`)
  await base.query(`update ordenes_compra_materiales set numero = null, referencia = $2 where id = $1`, [oc, referencia])
  await base.query('commit')
  const [sembrada] = await consulta(`select numero, referencia, aprobacion, public.total_orden_compra(id)::float as total from ordenes_compra_materiales where id = $1`, [oc])
  const total = conFactura ? 295 : 250
  if (sembrada.numero !== null || sembrada.referencia !== referencia || sembrada.aprobacion !== 'APROBADA' || sembrada.total !== total) {
    throw new Error(`La siembra no dejó la OC aprobada, sin número y con ${total}.00: ${JSON.stringify(sembrada)}`)
  }
  return oc
}
const oc = await ocSinNumero(REFERENCIA)
const oc2 = await ocSinNumero(REFERENCIA_2)
// Con boleta, para su tarjeta en Cuentas por pagar; la referencia larga, como la de una proforma.
const REFERENCIA_3 = `PROFORMA-${SUFIJO}-2026`
const oc3 = await ocSinNumero(REFERENCIA_3, false)
const NOMBRE = `OC sin número (ref. del proveedor ${REFERENCIA})`
const NOMBRE_2 = `OC sin número (ref. del proveedor ${REFERENCIA_2})`
const NOMBRE_3 = `OC sin número (ref. del proveedor ${REFERENCIA_3})`
// Con factura, para la boleta de una parte (la OC que llega en partes).
const REFERENCIA_4 = `OC-${1000 + ((Number(SUFIJO) + 2) % 8999)}`
const oc4 = await ocSinNumero(REFERENCIA_4)
const NOMBRE_4 = `OC sin número (ref. del proveedor ${REFERENCIA_4})`
console.log(`     sembradas cuatro OC sin número: ${REFERENCIA}, ${REFERENCIA_2} y ${REFERENCIA_4} con factura, ${REFERENCIA_3} con boleta`)

const JUSTIFICANTE = join(ARCHIVOS, `justificante-sin-numero-${SUFIJO}.pdf`)
writeFileSync(JUSTIFICANTE, pdfConTexto(['Correo del proveedor', 'La factura cubre las dos cotizaciones']))
// La factura corregida menciona solo la segunda: el detector tiene que nombrarla sin hacer pasar su referencia por número.
const FACTURA_CORREGIDA = join(ARCHIVOS, `factura-sin-numero-${SUFIJO}.pdf`)
writeFileSync(
  FACTURA_CORREGIDA,
  pdfConTexto(['FACTURA ELECTRONICA', FACTURA, `Fecha de Emision : ${hoy.split('-').reverse().join('/')}`, `Orden de compra ${REFERENCIA_2}`, 'Importe Total : S/ 590.00']),
)
// Para el detector del formulario: una factura que cita la OC sin número por su referencia, y otra que cita las dos.
const fechaEnElPdf = `Fecha de Emision : ${hoy.split('-').reverse().join('/')}`
const PDF_CITA_UNA = join(ARCHIVOS, `cita-una-${SUFIJO}.pdf`)
writeFileSync(PDF_CITA_UNA, pdfConTexto(['FACTURA ELECTRONICA', FACTURA, fechaEnElPdf, `Orden de compra ${REFERENCIA}`, 'Importe Total : S/ 295.00']))
const PDF_CITA_DOS = join(ARCHIVOS, `cita-dos-${SUFIJO}.pdf`)
writeFileSync(
  PDF_CITA_DOS,
  pdfConTexto(['FACTURA ELECTRONICA', FACTURA, fechaEnElPdf, `Orden de compra ${REFERENCIA}`, `Orden de compra ${REFERENCIA_2}`, 'Importe Total : S/ 295.00']),
)
const PDF_COMPROBANTE = join(ARCHIVOS, 'minimo.pdf')
writeFileSync(
  PDF_COMPROBANTE,
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

// ---------------------------------------------------------------- 1. Gerencia
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  const items = await menu(pagina)
  console.log('     menú de Gerencia:', items.join(' · '))
  comprobar(items.includes('Adquisiciones') && items.indexOf('Adquisiciones') < items.indexOf('Cuentas por cobrar'),
    'Gerencia tiene Adquisiciones en «Consultas», antes de Cuentas por cobrar')
  // Sin el enlace, por su dirección: lo demás se comprueba igual.
  const enlace = pagina.locator('nav[aria-label="Menú principal"] a', { hasText: 'Adquisiciones' }).first()
  if (await enlace.count()) await enlace.click()
  else await pagina.goto(`${BASE}/adquisiciones`)
  await pagina.waitForURL((u) => u.pathname === '/adquisiciones', { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const h1 = limpio(await pagina.locator('h1').first().textContent().catch(() => ''))
  const filas = await pagina.locator('tbody tr').count()
  comprobar(pagina.url().endsWith('/adquisiciones') && h1 === 'Adquisiciones' && filas > 0, `la pantalla abre con su tabla: «${h1}», ${filas} filas`)
  const fila = limpio(await pagina.locator('tbody tr', { hasText: REFERENCIA }).first().textContent().catch(() => ''))
  comprobar(fila.includes('OC sin número') && fila.includes(`Ref. del proveedor: ${REFERENCIA}`), 'la OC sin número sale «OC sin número», con su referencia aparte')
  await pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-gerencia.png'), fullPage: true, caret: 'initial' })
  // En Aprobación, las que puede anular: el nombre lo arma la base (migración 20261022220000).
  await pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  const anulables = await pagina.locator('tr[data-anulable]').evaluateAll((filas) => filas.map((f) => f.getAttribute('data-anulable')))
  const filaAnulable = limpio(await pagina.locator(`tr[data-anulable="${NOMBRE}"]`).first().textContent().catch(() => ''))
  comprobar(anulables.includes(NOMBRE) && !anulables.includes(REFERENCIA) && !anulables.includes(`OC ${REFERENCIA}`) &&
    filaAnulable.startsWith('OC sin número ·') && filaAnulable.includes(`Ref. del proveedor: ${REFERENCIA}`),
    `en «Aprobadas que se pueden anular» la base la nombra «${NOMBRE}» y la fila dice «OC sin número» con su referencia aparte («${filaAnulable.slice(0, 80)}»)`)
  const decididas = pagina.locator('section', { has: pagina.getByRole('heading', { name: 'Decididas en los últimos 30 días' }) })
  const decidida = limpio(await decididas.locator('tbody tr', { hasText: REFERENCIA }).first().textContent().catch(() => ''))
  comprobar(decidida.startsWith('OC sin número ·') && decidida.includes(`Ref. del proveedor: ${REFERENCIA}`),
    `entre las decididas también sale «OC sin número», con su referencia aparte («${decidida.slice(0, 80)}»)`)
  await contexto.close()
  const tel = await entrar(CUENTAS.gerencia, { width: 390, height: 844 })
  await tel.pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  const ref3 = tel.pagina.locator(`tr[data-anulable="${NOMBRE_3}"] span.whitespace-nowrap`, { hasText: REFERENCIA_3 }).first()
  const renglones = await ref3.evaluate((e) => e.getClientRects().length).catch(() => 0)
  const ancho = await tel.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(renglones === 1 && ancho <= 390, `en el teléfono, la referencia larga (${REFERENCIA_3}) va en un renglón y la página no se ensancha (${renglones} renglón, ${ancho} px)`)
  await tel.pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-aprobacion-telefono.png'), fullPage: true, caret: 'initial' })
  await tel.contexto.close()
}

// ------------------------------------------------------------- 2. Contabilidad
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const casilla = pagina.locator(`input[name="ordenes_compra"][value="${oc}"]`)
  const etiqueta = limpio(await casilla.locator('xpath=ancestor::label').textContent().catch(() => ''))
  comprobar(etiqueta.startsWith('OC sin número ·') && etiqueta.includes(`Ref. del proveedor: ${REFERENCIA}`),
    `en el formulario se marca como «OC sin número», con su referencia aparte (dice «${etiqueta.slice(0, 90)}»)`)
  // El detector busca la OC sin número por su referencia: con nada marcado, la marca sola;
  // con ella marcada, ofrece «Marcarla» para la otra que cita la factura.
  await pagina.locator('#adq-pdf').setInputFiles(PDF_CITA_UNA)
  await pagina.locator('p', { hasText: 'Leído' }).first().waitFor({ timeout: 60000 }).catch(() => {})
  await pagina.waitForTimeout(500)
  comprobar(await casilla.isChecked(), 'la factura que cita su referencia marca sola la OC sin número')
  await pagina.locator('#adq-pdf').setInputFiles(PDF_CITA_DOS)
  const avisoOtra = pagina.locator('ul[role="status"] li', { hasText: `menciona la ${NOMBRE_2} y no está marcada` }).first()
  await avisoOtra.waitFor({ timeout: 60000 }).catch(() => {})
  const casilla2 = pagina.locator(`input[name="ordenes_compra"][value="${oc2}"]`)
  const conBoton = (await avisoOtra.getByRole('button', { name: 'Marcarla' }).count()) === 1
  if (conBoton) await avisoOtra.getByRole('button', { name: 'Marcarla' }).click()
  comprobar(conBoton && (await casilla2.isChecked()), `la otra OC sin número que cita la factura se ofrece con «Marcarla», y la marca`)
  await casilla2.uncheck()
  await pagina.locator('#adq-pdf').setInputFiles(PDF_COMPROBANTE)
  await casilla.check()
  // Con el RUC de otra empresa, el aviso la nombra sin hacer pasar la referencia por número.
  await pagina.locator('#adq-ruc').fill(await rucLibre())
  const avisoRuc = limpio(await pagina.locator('#adq-ruc-otro').textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(avisoRuc.startsWith(`La ${NOMBRE} es del RUC ${RUC}`), `con otro RUC el aviso la nombra «${NOMBRE}» («${avisoRuc.slice(0, 90)}»)`)
  await pagina.locator('#adq-ruc').fill(RUC)
  await pagina.locator('#adq-total').fill('295')
  await pagina.locator('#adq-numero').fill(FACTURA)
  await pagina.locator('#adq-emision').fill(hoy)
  await pagina.locator('#adq-vencimiento').fill(hoy)
  await pagina.locator('#adq-pdf').setInputFiles(PDF_COMPROBANTE)
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.getByText(`Comprobante ${FACTURA} registrado`).waitFor({ timeout: 30000 }).catch(() => {})
  const error = limpio(await pagina.locator('form [role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  const [enlace] = await consulta(
    `select count(*)::int as n from adquisiciones_ordenes_compra l join adquisiciones a on a.id = l.adquisicion_id
      where a.numero_documento = $1 and a.estado = 'REGISTRADA' and l.orden_compra_id = $2`,
    [FACTURA, oc],
  )
  comprobar(!error && enlace.n === 1, `registra la factura con esa OC, y la base la guarda ligada${error ? ` (dijo «${error}»)` : ''}`)
  await pagina.locator('tbody tr', { hasText: FACTURA }).first().waitFor({ timeout: 15000 }).catch(() => {})
  const textoFila = limpio(await grupo(pagina, FACTURA))
  const celda = limpio(await pagina.locator('tbody tr', { hasText: FACTURA }).first().locator(`a[href="/compras/${oc}/pdf"]`).first().textContent().catch(() => ''))
  comprobar(celda === 'OC sin número' && textoFila.includes(`Ref. del proveedor: ${REFERENCIA}`),
    `en la tabla, la OC es «OC sin número» y su referencia va aparte (el enlace dice «${celda}»)`)

  // El PDF de la OC: «SIN NÚMERO» donde va el número, y la referencia como lo que es.
  const respuesta = await pagina.request.get(`${BASE}/compras/${oc}/pdf`)
  const disposicion = respuesta.headers()['content-disposition'] ?? ''
  const archivoOc = join(CAPTURAS, `oc-sin-numero-${SUFIJO}.pdf`)
  writeFileSync(archivoOc, await respuesta.body())
  const enElPapel = respuesta.ok() ? limpio(execFileSync('pdftotext', ['-layout', archivoOc, '-']).toString()) : ''
  comprobar(respuesta.ok() && disposicion.includes(`MW-Compra-sin-numero-ref-${REFERENCIA}.pdf`), `el PDF de la OC se descarga como sin número (${disposicion || respuesta.status()})`)
  comprobar(
    enElPapel.includes('N°: SIN NÚMERO') && !enElPapel.includes(`N°: ${REFERENCIA}`) && enElPapel.includes(`Según su cotización ${REFERENCIA}`) &&
      enElPapel.includes(`citando su cotización ${REFERENCIA}`) && !enElPapel.includes(`con el número ${REFERENCIA}`),
    'en el papel dice «N°: SIN NÚMERO» y la referencia va como su cotización, no como el número que se cita',
  )

  // «Corregir»: la lista de OC de la ventana, el detector y el historial.
  await pagina.getByRole('button', { name: `Corregir el comprobante ${FACTURA}` }).first().click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 15000 }).catch(() => {})
  // Las OC de la lista llevan su casilla; los avisos del detector, que también son `li`, no.
  const ocDeLaLista = (ref) => ventana.locator('li:has(input[type="checkbox"])', { hasText: `Ref. del proveedor: ${ref}` }).first()
  const enLaLista = async (ref) => limpio(await ocDeLaLista(ref).textContent().catch(() => ''))
  const primera = await enLaLista(REFERENCIA)
  const segunda = await enLaLista(REFERENCIA_2)
  comprobar(primera.startsWith('OC sin número') && primera.includes(`Ref. del proveedor: ${REFERENCIA}`) &&
    segunda.startsWith('OC sin número') && segunda.includes(`Ref. del proveedor: ${REFERENCIA_2}`),
    `la ventana de «Corregir» las nombra igual (dice «${primera.slice(0, 70)}»)`)
  await ventana.locator('[id^="fc-pdf-"]').setInputFiles(FACTURA_CORREGIDA)
  await ventana.locator('[role="status"]', { hasText: 'menciona' }).first().waitFor({ timeout: 60000 }).catch(() => {})
  const avisos = limpio((await ventana.locator('[role="status"]').allTextContents()).join(' '))
  comprobar(avisos.includes(`menciona la ${NOMBRE_2}`) && avisos.includes(`La ${NOMBRE} está marcada`) && !avisos.includes(`la ${REFERENCIA_2}`),
    `el detector las nombra sin hacer pasar la referencia por número (${avisos.slice(0, 200)})`)
  await ocDeLaLista(REFERENCIA_2).locator('input[type="checkbox"]').first().check()
  await ventana.locator('[id^="fc-total-"]').fill('590')
  await ventana.locator('[id^="correccion-motivo-"]').fill('La factura cubre las dos cotizaciones del proveedor')
  await ventana.locator('[id^="correccion-justificante-"]').setInputFiles(JUSTIFICANTE)
  await ventana.getByRole('button', { name: 'Corregir', exact: true }).click()
  const alerta = await terminarVentana(pagina)
  const [corregida] = await consulta(
    `select a.total::float as total,
            (select count(*)::int from adquisiciones_ordenes_compra l where l.adquisicion_id = a.id and l.quitada_en is null and l.orden_compra_id = any($2)) as ordenes
       from adquisiciones a where a.numero_documento = $1 and a.estado = 'REGISTRADA'`,
    [FACTURA, [oc, oc2]],
  )
  comprobar(!alerta && corregida?.total === 590 && corregida?.ordenes === 2, `corrige la factura y le suma la otra OC sin número${alerta ? ` (dijo «${alerta}»)` : ''}`)
  await pagina.reload({ waitUntil: 'networkidle' })
  const cuerpo = pagina.locator('tbody', { hasText: FACTURA }).first()
  await cuerpo.getByText('Corregido una vez').first().click()
  const historial = limpio(await cuerpo.textContent().catch(() => ''))
  comprobar(historial.includes(`Se sumó la ${NOMBRE_2}`) && !historial.includes(`Se sumó la ${REFERENCIA_2}`),
    `el historial dice «Se sumó la ${NOMBRE_2}»`)
  // El detector de la factura registrada busca la OC sin número por su referencia: la que el PDF cita es suya.
  const citada = REFERENCIA_2.replace(/\D/g, '')
  comprobar(!historial.includes(`menciona la OC ${citada}`) && historial.includes(`La ${NOMBRE} es de esta factura y la factura no la menciona`),
    'el detector reconoce la OC sin número que el PDF cita, y avisa solo de la que no cita')
  await pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-contabilidad.png'), fullPage: true, caret: 'initial' })
  await contexto.close()

  // En el teléfono, la lista de facturas.
  const tel = await entrar(CUENTAS.contabilidad, { width: 390, height: 844 })
  await tel.pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const tarjeta = limpio(await tel.pagina.locator(`[data-factura-telefono="${FACTURA}"]`).textContent().catch(() => ''))
  comprobar(tarjeta.includes('OC sin número') && tarjeta.includes(`Ref. del proveedor: ${REFERENCIA}`) && tarjeta.includes(`Ref. del proveedor: ${REFERENCIA_2}`),
    'en el teléfono la factura nombra sus OC igual')
  const ancho = await tel.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `y la página no se ensancha (${ancho} px)`)
  await tel.pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-contabilidad-telefono.png'), fullPage: true, caret: 'initial' })
  await tel.contexto.close()
}

// ---------------------------------------------------------------- 3. Tesorería
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const factura = pagina.locator('article', { hasText: FACTURA })
  const texto = limpio(await factura.textContent().catch(() => ''))
  comprobar(texto.includes(NOMBRE) && !texto.includes(`OC ${REFERENCIA}`), 'en Cuentas por pagar la factura nombra la OC sin hacer pasar la referencia por su número')
  comprobar(texto.includes(`PDF de la ${NOMBRE}`), 'y el PDF de la OC lleva el mismo nombre')
  await pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-tesoreria.png'), fullPage: true, caret: 'initial' })
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const enFacturas = limpio(await grupo(pagina, FACTURA))
  comprobar(enFacturas.includes('Pagar en Cuentas por pagar'), 'en Facturas, Tesorería tiene «Pagar en Cuentas por pagar»')
  await contexto.close()

  // La OC con boleta, en el teléfono: su nombre largo se parte dentro de la tarjeta.
  const tel = await entrar(CUENTAS.tesoreria, { width: 390, height: 844 })
  await tel.pagina.goto(`${BASE}/tesoreria/por-pagar`, { waitUntil: 'networkidle' })
  const boleta = tel.pagina.locator(`#compra-${oc3}`)
  await boleta.waitFor({ timeout: 15000 }).catch(() => {})
  const textoBoleta = limpio(await boleta.textContent().catch(() => ''))
  const medida = await boleta.evaluate((e) => ({ dentro: e.scrollWidth, caja: e.clientWidth })).catch(() => null)
  const pagina390 = await tel.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(textoBoleta.includes(NOMBRE_3) && medida !== null && medida.dentro <= medida.caja && pagina390 <= 390,
    `la tarjeta de la OC con boleta la nombra «${NOMBRE_3}» sin salirse (${medida ? `${medida.dentro} de ${medida.caja} px` : 'no está'}, página ${pagina390} px)`)
  await tel.pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-tesoreria-telefono.png'), fullPage: true, caret: 'initial' })
  await tel.contexto.close()
}

// ------------------------------------- 3b. La boleta de una parte de una OC sin número
// La OC que llega en partes (migración 20261022200000): Logística le anexa la boleta
// de una parte, y el aviso y la tarjeta de Tesorería la nombran «OC sin número
// (ref. …)» (migración 20261022220000 y `nombreDeOc`), no «OC <referencia>».
{
  const BOLETA_PARTE = `B903-${SUFIJO}`
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  // Gestión de compras todavía la lista por su referencia: se arregla con su pantalla.
  await pagina.locator(`tr[data-compra="${REFERENCIA_4}"]`).first().getByRole('button', { name: 'Adjuntar', exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('select[name="tipo"]').selectOption('COMPROBANTE')
  await v.locator('input[name="parte"]').check()
  await v.locator('input[name="parte_numero"]').fill(BOLETA_PARTE)
  await v.locator('input[name="parte_fecha"]').fill(hoy)
  await v.locator('input[name="parte_monto"]').fill('100')
  await v.locator('select[name="parte_igv"]').selectOption('si')
  await v.locator('input[name="archivo"]').setInputFiles({
    name: `boleta-${BOLETA_PARTE}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdfConTexto(['BOLETA DE VENTA ELECTRONICA', BOLETA_PARTE, 'Importe Total : S/ 100.00']),
  })
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  await Promise.race([v.locator('[role="status"]').waitFor({ timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  const [parte] = await consulta(`select id from documentos_compra_material where orden_compra_id = $1 and monto_de_la_parte is not null`, [oc4])
  comprobar(!error && parte, `Logística anexa la boleta de una parte a la OC sin número${error ? ` (${error})` : ''}`)
  await contexto.close()
  const avisos = await consulta(`select titulo from notificaciones where origen_id = $1 and usuario_id = $2`, [parte?.id, ids[CUENTAS.tesoreria]])
  comprobar(avisos.some((a) => a.titulo === `Boleta de una parte por pagar: ${NOMBRE_4}`),
    `el aviso a Tesorería la nombra bien (${avisos.map((a) => a.titulo).join(' / ') || 'sin aviso'})`)

  const t = await entrar(CUENTAS.tesoreria)
  await t.pagina.goto(`${BASE}/tesoreria/por-pagar#partes-con-boleta`, { waitUntil: 'networkidle' })
  const tarjeta = limpio(await t.pagina.locator(`article#parte-${parte?.id}`).textContent().catch(() => ''))
  comprobar(tarjeta.includes(`Una parte de la ${NOMBRE_4}`) && tarjeta.includes(`PDF de la ${NOMBRE_4}`) && !tarjeta.includes(`OC ${REFERENCIA_4}`),
    `en «Boletas de una parte» la tarjeta dice «Una parte de la ${NOMBRE_4}» y su PDF, sin «OC ${REFERENCIA_4}»`)
  await t.pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-parte.png'), fullPage: true, caret: 'initial' })
  await t.contexto.close()
  const tel = await entrar(CUENTAS.tesoreria, { width: 390, height: 844 })
  await tel.pagina.goto(`${BASE}/tesoreria/por-pagar#partes-con-boleta`, { waitUntil: 'networkidle' })
  const caja = tel.pagina.locator(`article#parte-${parte?.id}`)
  const medida = await caja.evaluate((e) => ({ dentro: e.scrollWidth, caja: e.clientWidth })).catch(() => null)
  const ancho = await tel.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(medida !== null && medida.dentro <= medida.caja && ancho <= 390,
    `en el teléfono la tarjeta no se sale (${medida ? `${medida.dentro} de ${medida.caja} px` : 'no está'}, página ${ancho} px)`)
  await tel.pagina.screenshot({ path: join(CAPTURAS, 'oc-sin-numero-parte-telefono.png'), fullPage: true, caret: 'initial' })
  await tel.contexto.close()
}

// ------------------------------------------------- 4. Gerencia, en Facturas
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/adquisiciones?vista=facturas`, { waitUntil: 'networkidle' })
  const enFacturas = limpio(await grupo(pagina, FACTURA))
  comprobar(enFacturas.includes('Ver en Cuentas por pagar') && !enFacturas.includes('Pagar en Cuentas por pagar'),
    `Gerencia, que no paga, tiene «Ver en Cuentas por pagar» (${enFacturas ? 'la fila está' : 'no encontró la fila'})`)
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length) console.log('\nErrores de consola:\n  ' + errores.join('\n  '))
console.log(`\n${fallas.length === 0 ? 'Todo bien' : `${fallas.length} fallas`} · capturas en ${CAPTURAS}`)
process.exit(fallas.length === 0 && errores.length === 0 ? 0 : 1)

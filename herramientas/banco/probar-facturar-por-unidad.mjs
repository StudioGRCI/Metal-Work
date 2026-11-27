/**
 * Recorre con clic real «la factura dice de qué unidad es» (migración
 * 20261126998000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Contabilidad, en monitor: la cotización de tres unidades con dos OT
 *      cargadas sale en «Por facturar» una vez por cada unidad con su OT; su
 *      tarjeta dice los códigos, las tres unidades con lo que le toca a cada
 *      una y que falta una OT. El formulario pide de qué unidad es: la que no
 *      tiene OT y «toda la cotización» no se pueden elegir, y sin elegir no
 *      envía. Factura la unidad 2 por la mitad (tres toques, una factura): la
 *      factura queda en el código de la unidad 2 y esa unidad «Facturada en
 *      parte». Si lo facturado pasa de lo que le toca a la unidad, avisa.
 *   2. Administración carga la tercera OT. Contabilidad registra el adelanto
 *      por toda la cotización: la base lo reparte en tres partes que suman el
 *      total, y la factura dice cuánto le toca a cada unidad.
 *   3. La cotización de una unidad sigue igual: el formulario no pregunta la
 *      unidad y dice «Factura del código …».
 *   4. Tesorería, en Cuentas por cobrar: cada factura dice de qué unidad es o
 *      que es por toda la cotización, con sus códigos; cobra una parte de la
 *      factura por toda la cotización. Abajo, la cotización con sus tres códigos.
 *   5. Gerencia, en la ficha de cada código: la cotización como «unidad k de 3»
 *      con lo que le toca, y sus facturas; la de toda la cotización sale en
 *      los tres códigos, con la parte de ese código y lo cobrado que le toca.
 *   6. Contabilidad en el teléfono (390): las mismas tarjetas, sin desborde.
 *
 * Siembra por SQL, con la sesión de cada puesto, su cliente QA FACTURA POR
 * UNIDAD …, la cotización de tres (30 000 soles sin IGV: 35 400 con IGV,
 * 11 800 por unidad), la de una y sus OT con los códigos QA-FU…; todo se queda
 * en el banco: nada numerado se borra.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_ARCHIVOS (el mismo del servidor del banco).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba, elegirCuenta } from './caja-de-prueba.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ALMACEN = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const COSTOS = process.env.COSTOS ?? 'costos.cobrar@banco.test'
const CUENTAS = {
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad.local@metalwork.test',
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  ventas: process.env.VENTAS ?? 'ventas.local@metalwork.test',
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
}
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

/** Un PDF de una página con estas líneas de texto. */
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

// La red quieta, sin colgarse (ver `probar-facturacion.mjs`).
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(correo, viewport = { width: 1440, height: 900 }) {
  const telefono = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: telefono, hasTouch: telefono, deviceScaleFactor: 2, timezoneId: 'America/Lima', locale: 'es-PE' })
  // El indicador de `next dev` no es de la aplicación: fuera de las capturas.
  await contexto.addInitScript(() => {
    const quitar = () => document.querySelectorAll('nextjs-portal').forEach((e) => (e.style.display = 'none'))
    new MutationObserver(quitar).observe(document.documentElement, { childList: true, subtree: true })
  })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)
  return { pagina, contexto }
}

/** Espera a que la ventana abierta se cierre (la acción salió bien) o muestre su error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}
const globo = async (pagina, ruta) => (await pagina.locator(`nav a[href="${ruta}"]`).first().getAttribute('aria-label')) ?? ''
const cuenta = async (pagina, destino) => Number((await globo(pagina, destino)).match(/, (\d+) pendientes?$/)?.[1] ?? 0)
/** Si algo se sale de costado: en el teléfono la página no debe correrse. */
const desborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// ---------------------------------------------------------------- siembra
const sello = Date.now().toString().slice(-6)
const ids = {}
for (const [clave, correo] of Object.entries(CUENTAS)) {
  const fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) throw new Error(`Falta la cuenta ${correo} en la base del banco.`)
  ids[clave] = fila.id
}

/** Corre `sql` dentro de una transacción con la sesión de `quien` y el rol authenticated. */
async function como(quien, sql, valores = []) {
  await base.query('begin')
  try {
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [ids[quien]],
    )
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const anio = (await uno(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY') as a`)).a
const ruc = (await uno(
  `select n::text as ruc from generate_series(20990260000::bigint, 20990269999::bigint) n
    where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text) limit 1`,
)).ruc
const CLIENTE = `QA FACTURA POR UNIDAD ${sello} S.A.C.`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal) values ('RUC', $1, $2, 'Av. de Prueba 998') returning id`,
  [ruc, CLIENTE],
)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

function guardar(cubeta, ruta, contenido) {
  const destino = join(ALMACEN, cubeta, ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
}

/** Una cotización en soles que Ventas sube, confirma su IGV y Gerencia aprueba. */
async function cotizacion(monto, unidades, incluyeIgv) {
  const { id } = await uno('select gen_random_uuid() as id')
  const { numero } = await uno(
    `select n || '-' || $1 as numero from generate_series(9000, 9999) n
      where not exists (select 1 from public.cotizaciones_pdf c where c.numero = n || '-' || $1) order by random() limit 1`,
    [anio],
  )
  const ruta = `cot/${id}/${numero}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${numero}`, `CLIENTE: ${CLIENTE}`, `CANTIDAD : ${String(unidades).padStart(2, '0')}`, 'Semirremolque cama baja de prueba del banco'])
  guardar('cotizaciones-pdf', ruta, contenido)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [ruta, ids.ventas, contenido.length],
  )
  await como(
    'ventas',
    `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
     values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, $9, 'PEN', $10)`,
    [id, numero, clienteId, carroceria, `${numero}.pdf`, ruta, contenido.length, ids.ventas, monto, unidades],
  )
  await como('ventas', `select public.confirmar_igv_cotizacion($1, $2)`, [id, incluyeIgv])
  await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [id])
  return { id, numero }
}

/** Administración carga la OT de la unidad que sigue, con su código interno y su PDF. */
async function cargarOt(cot, codigo) {
  const { id } = await uno('select gen_random_uuid() as id')
  const { n } = await uno(
    `select n from generate_series(9100, 9999) n where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1) order by random() limit 1`,
    [anio],
  )
  const ruta = `ot/${id}/orden.pdf`
  const contenido = pdfConTexto([`ORDEN DE TRABAJO N ${n}-${anio}`, `CLIENTE: ${CLIENTE}`, 'Archivo de prueba del banco local de Metal Work.'])
  guardar('adjuntos-ot', ruta, contenido)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('adjuntos-ot', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [ruta, ids.administracion, contenido.length],
  )
  await como(
    'administracion',
    `select public.cargar_codigo_y_ot_de_cotizacion($1, $2, $3, $4, 'SEMIRREMOLQUE', (now() at time zone 'America/Lima')::date + 30, $5, 'orden.pdf', $6)`,
    [cot.id, id, codigo, String(n), ruta, contenido.length],
  )
}

// Lo que el menú contaba antes de sembrar.
const antes = {}
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  antes.facturar = await cuenta(pagina, '/contabilidad/facturacion')
  await contexto.close()
}

const C1 = `QA-FU1 ${sello}`
const C2 = `QA-FU2 ${sello}`
const C3 = `QA-FU3 ${sello}`
const C0 = `QA-FU0 ${sello}`
// La de tres: 30 000 sin IGV son 35 400 con IGV, 11 800 por unidad. Con dos OT cargadas.
const tres = await cotizacion(30000, 3, false)
await cargarOt(tres, C1)
await cargarOt(tres, C2)
// La de una, 9 000 con IGV, con su OT.
const una = await cotizacion(9000, 1, true)
await cargarOt(una, C0)

const serie = (await uno(
  `select 'F' || lpad(n::text, 3, '0') as s from generate_series(100, 999) n
    where not exists (select 1 from public.facturas_venta f where f.numero like 'F' || lpad(n::text, 3, '0') || '-%') order by random() limit 1`,
)).s
const F_UNIDAD = `${serie}-2`
const F_TODA = `${serie}-10`
const F_UNA = `${serie}-1`
const PDF_FACTURA = join(CAPTURAS, `factura-${serie}.pdf`)
const PDF_VOUCHER = join(CAPTURAS, `voucher-${serie}.pdf`)
writeFileSync(PDF_FACTURA, pdfConTexto([`FACTURA ELECTRONICA ${serie}`, CLIENTE, 'Archivo de prueba del banco local']))
writeFileSync(PDF_VOUCHER, pdfConTexto(['CONSTANCIA DE OPERACION', 'Operacion OP-998', 'Banco de prueba']))
console.log(`     sembrado: ${tres.numero} de tres unidades (${C1}, ${C2} y una sin OT) y ${una.numero} de una (${C0}); facturas ${serie}-…`)

/** Llena y envía la ventana de la factura; devuelve el error que mostró, si mostró. */
async function llenar(v, { numero, total, unidad }) {
  if (unidad !== undefined) await v.locator('select[name="unidad"]').selectOption(String(unidad))
  await v.locator('input[name="numero"]').fill(numero)
  await v.locator('input[name="total"]').fill(String(total))
  await v.locator('input[name="archivo"]').setInputFiles(PDF_FACTURA)
}

// ---------------------------------------------------------- 1. Contabilidad
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  comprobar((await cuenta(pagina, '/contabilidad/facturacion')) === antes.facturar + 3,
    `el menú de Contabilidad cuenta las tres unidades con OT que esperan factura (${antes.facturar} + 3)`)

  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  const fila = (c) => pagina.locator(`#por-facturar tbody tr[data-por-facturar="${c}"]`)
  const filas = { c1: limpio(await fila(C1).textContent()), c2: limpio(await fila(C2).textContent()), c0: limpio(await fila(C0).textContent()) }
  console.log('     por facturar:', filas.c1, '|', filas.c2, '|', filas.c0)
  comprobar(filas.c1.includes('unidad 1 de 3') && filas.c2.includes('unidad 2 de 3') && filas.c1.includes('11,800.00') && filas.c1.includes(tres.numero),
    '«Por facturar» trae una fila por cada unidad con OT de la cotización de tres, con lo que le toca')
  comprobar((await fila(C3).count()) === 0 && (await pagina.locator('#por-facturar tbody tr', { hasText: tres.numero }).count()) === 2,
    'la unidad sin OT no está por facturar')
  comprobar(filas.c0.includes('9,000.00') && !filas.c0.includes('unidad 1 de 1'), 'la de una unidad sale como siempre, sin decir «unidad 1 de 1»')
  const cabecera = limpio(await pagina.locator('#por-facturar').locator('p').first().textContent())
  comprobar(/unidades esperan su factura/.test(cabecera), `la cabecera cuenta unidades («${cabecera}»)`)

  const tarjeta = pagina.locator(`li[data-cotizacion="${tres.numero}"]`)
  const texto = limpio(await tarjeta.textContent())
  comprobar(texto.includes(`Códigos ${C1} · ${C2}`) && texto.includes('3 unidades') && texto.includes('Por facturar') && texto.includes('35,400.00'),
    'la tarjeta dice los códigos de las unidades con OT, que son 3 unidades y el total con IGV')
  comprobar(texto.includes('Falta que Administración cargue la OT de una unidad'), 'y que falta la OT de una unidad')
  const unidades = await tarjeta.locator('li[data-unidad]').evaluateAll((l) => l.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  console.log('     unidades:', unidades.join(' | '))
  comprobar(unidades.length === 3 && unidades[0].includes(`código ${C1}`) && unidades[0].includes('Por facturar') && unidades[0].includes('Le toca S/ 11,800.00')
    && unidades[2].includes('Falta su OT') && unidades[2].includes('Le toca S/ 11,800.00'),
    'cada unidad dice su código, en qué va y lo que le toca; la tercera, que falta su OT')

  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  const v = pagina.locator('[role="dialog"]')
  comprobar(limpio(await v.locator('h2').first().textContent()).includes(`Factura de la cotización ${tres.numero}`), 'la ventana es de la cotización, no de un código')
  const opciones = await v.locator('select[name="unidad"] option').evaluateAll((l) => l.map((o) => ({ texto: o.textContent.trim(), valor: o.value, apagada: o.disabled })))
  console.log('     opciones:', opciones.map((o) => `${o.texto}${o.apagada ? ' (apagada)' : ''}`).join(' | '))
  comprobar(opciones.find((o) => o.valor === '3')?.apagada === true && opciones.find((o) => o.valor === '3')?.texto.includes('falta su OT'), 'la unidad sin OT no se puede elegir')
  comprobar(opciones.find((o) => o.valor === '0')?.apagada === true, '«Toda la cotización» tampoco, mientras falte una OT')
  comprobar((await v.locator('select[name="unidad"]').inputValue()) === '', 'con dos unidades posibles no viene ninguna elegida')
  await llenar(v, { numero: F_UNIDAD, total: 5900 })
  await v.getByRole('button', { name: 'Registrar la factura' }).click()
  await pagina.waitForTimeout(800)
  comprobar((await v.isVisible()) && (await v.locator('select[name="unidad"]:invalid').count()) === 1
    && Number((await uno(`select count(*)::int n from facturas_venta where cotizacion_pdf_id = $1`, [tres.id])).n) === 0,
    'sin elegir la unidad no envía')
  await v.locator('select[name="unidad"]').selectOption('2')
  const ayuda = limpio(await v.textContent())
  comprobar(ayuda.includes('A la unidad 2 le tocan S/ 11,800.00'), 'al elegir la unidad dice lo que le toca')
  comprobar((await v.locator('[role="status"]').count()) === 0, 'sin aviso mientras no pase de lo que le toca')
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-1440-formulario.png') })
  // Tres toques al mismo envío: una factura.
  // Por su tipo y no por su nombre: mientras envía el botón cambia de texto, y los toques
  // de más no encontraban a quién tocar (auditoría de funcionamiento, segunda vuelta).
  const boton = v.locator('button[type="submit"]')
  await boton.click()
  await boton.click({ timeout: 1000, force: true }).catch(() => {})
  await boton.click({ timeout: 1000, force: true }).catch(() => {})
  const e1 = await esperarVentana(pagina)
  comprobar(e1 === '', `la factura de la unidad 2 se registra${e1 ? ` (dijo: ${e1})` : ''}`)
  await tarjeta.locator(`article[data-factura="${F_UNIDAD}"]`).waitFor({ timeout: 30000 }).catch(() => {})
  const f = await consulta(
    `select f.numero, f.codigo_interno, f.total, (select string_agg(p.numero_de_unidad || ':' || p.codigo_interno || ':' || p.monto, ' | ' order by p.numero_de_unidad)
                                                    from facturas_venta_unidades p where p.factura_id = f.id) as partes
       from facturas_venta f where f.cotizacion_pdf_id = $1`, [tres.id])
  comprobar(f.length === 1 && f[0].codigo_interno === C2 && f[0].partes === `2:${C2}:5900.00`,
    `la base guarda una sola factura, en el código de la unidad 2 (${f.map((x) => `${x.numero} ${x.codigo_interno} [${x.partes}]`).join('; ')})`)
  const facturaUnidad = limpio(await tarjeta.locator(`article[data-factura="${F_UNIDAD}"]`).textContent())
  comprobar(facturaUnidad.includes('Unidad 2 de 3'), `la factura dice de qué unidad es («${facturaUnidad.slice(0, 70)}…»)`)
  const despues = await tarjeta.locator('li[data-unidad]').evaluateAll((l) => l.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  comprobar(despues[1].includes('Facturada en parte') && despues[1].includes('facturado S/ 5,900.00') && despues[1].includes('falta S/ 5,900.00') && despues[0].includes('Por facturar'),
    `la unidad 2 queda «Facturada en parte» con lo que le falta, y la 1 sigue «Por facturar» («${despues[1]}»)`)
  comprobar(limpio(await fila(C2).textContent()).includes('En parte') && limpio(await fila(C2).textContent()).includes('5,900.00'), 'y en «Por facturar» la unidad 2 sale «En parte», con lo que falta')
  comprobar((await cuenta(pagina, '/contabilidad/facturacion')) === antes.facturar + 3, 'el globo sigue contando las tres: la unidad 2 espera el resto')

  // Lo que pasa de lo que le toca a la unidad: avisa y no impide.
  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  await v.locator('select[name="unidad"]').selectOption('2')
  await v.locator('input[name="total"]').fill('6000')
  const aviso = limpio(await v.locator('[role="status"]').first().textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(aviso.includes('lo facturado de la unidad 2 llega a S/ 11,900.00') && aviso.includes('regístrala igual'), `si pasa de lo que le toca a la unidad, avisa sin impedir («${aviso}»)`)
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-1440-facturacion-dos-ot.png'), fullPage: true })

  // ------------------------------------------------ 2. La tercera OT y el adelanto por toda la cotización
  await cargarOt(tres, C3)
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  comprobar(limpio(await tarjeta.textContent()).includes(`Códigos ${C1} · ${C2} · ${C3}`) && !limpio(await tarjeta.textContent()).includes('Falta que Administración'),
    'con la tercera OT, la tarjeta dice los tres códigos y ya no pide ninguna OT')
  const otDeLaUna = limpio(await tarjeta.locator('li[data-unidad="1"] [data-ot-de-la-unidad]').textContent().catch(() => ''))
  comprobar(/^OT \d+-\d{4}$/.test(otDeLaUna) && (await tarjeta.locator('[data-ot-de-la-unidad]').count()) === 3, `cada unidad dice el número de su OT («${otDeLaUna}»)`)
  // «Facturar», junto a la unidad 3: la ventana se abre con esa unidad elegida.
  await tarjeta.locator('li[data-unidad="3"] [data-facturar-unidad="3"]').click()
  comprobar((await v.locator('select[name="unidad"]').inputValue()) === '3', '«Facturar» de la unidad 3 abre la ventana con la unidad 3 ya elegida')
  comprobar((await tarjeta.locator('li[data-unidad="2"] [data-facturar-unidad]').count()) === 1 && (await pagina.locator(`li[data-cotizacion="${una.numero}"] [data-facturar-unidad]`).count()) === 0,
    'cada unidad que espera lleva su «Facturar»; la cotización de una unidad no lo lleva')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  const toda = await v.locator('select[name="unidad"] option[value="0"]').evaluate((o) => ({ texto: o.textContent.trim(), apagada: o.disabled }))
  comprobar(!toda.apagada && toda.texto.includes('3 unidades, en partes iguales'), `«Toda la cotización» ya se puede elegir («${toda.texto}»)`)
  // La unidad 2 ya lleva 5 900 de 11 800: con 20 000 por toda la cotización su parte (6 666.66) la pasa, y lo dice.
  await llenar(v, { numero: F_TODA, total: 20000, unidad: 0 })
  const sePasan = limpio(await v.locator('[data-se-pasan]').textContent().catch(() => ''))
  comprobar(sePasan.includes('lo facturado de la unidad 2 llega a S/ 12,566.66 y le tocan S/ 11,800.00') && !sePasan.includes('unidad 1') && !sePasan.includes('unidad 3'),
    `la factura por toda la cotización avisa de la unidad que se pasa, con sus cifras («${sePasan}»)`)
  await llenar(v, { numero: F_TODA, total: 10000, unidad: 0 })
  comprobar((await v.locator('[data-se-pasan]').count()) === 0, 'con 10 000 ninguna se pasa y no avisa')
  await v.locator('input[name="concepto"]').fill('Adelanto')
  await v.getByRole('button', { name: 'Registrar la factura' }).click()
  const e2 = await esperarVentana(pagina)
  comprobar(e2 === '', `el adelanto por toda la cotización se registra${e2 ? ` (dijo: ${e2})` : ''}`)
  await tarjeta.locator(`article[data-factura="${F_TODA}"]`).waitFor({ timeout: 30000 }).catch(() => {})
  const [p] = await consulta(
    `select string_agg(p.numero_de_unidad || ':' || p.codigo_interno || ':' || p.monto, ' | ' order by p.numero_de_unidad) as partes, sum(p.monto) as suma
       from facturas_venta_unidades p join facturas_venta f on f.id = p.factura_id where f.numero = $1`, [F_TODA])
  comprobar(p?.partes === `1:${C1}:3333.33 | 2:${C2}:3333.34 | 3:${C3}:3333.33` && Number(p.suma) === 10000, `la base lo reparte en tres partes que suman 10 000 (${p?.partes})`)
  const facturaToda = limpio(await tarjeta.locator(`article[data-factura="${F_TODA}"]`).textContent())
  comprobar(facturaToda.includes('Toda la cotización · 3 unidades') && facturaToda.includes(`Unidad 2 · código ${C2} · S/ 3,333.34`),
    `la factura dice que es por toda la cotización y lo que le toca a cada unidad («${facturaToda.slice(0, 120)}…»)`)
  const final = await tarjeta.locator('li[data-unidad]').evaluateAll((l) => l.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  comprobar(final[0].includes('facturado S/ 3,333.33') && final[1].includes('facturado S/ 9,233.34') && final[2].includes('facturado S/ 3,333.33') && final[2].includes('Facturada en parte'),
    `cada unidad suma su parte del adelanto (${final.map((x) => x.match(/facturado S\/ [\d,.]+/)?.[0]).join(' | ')})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-1440-facturacion.png'), fullPage: true })
  await tarjeta.scrollIntoViewIfNeeded()
  await tarjeta.screenshot({ path: join(CAPTURAS, 'unidad-1440-tarjeta.png') })

  // ------------------------------------------------ 3. La de una unidad, como siempre
  const sola = pagina.locator(`li[data-cotizacion="${una.numero}"]`)
  const textoSola = limpio(await sola.textContent())
  comprobar(textoSola.includes(`Código ${C0}`) && (await sola.locator('li[data-unidad]').count()) === 0 && !textoSola.includes('unidades'),
    'la cotización de una unidad no lleva el bloque de unidades')
  await sola.getByRole('button', { name: 'Registrar factura' }).click()
  comprobar(limpio(await v.locator('h2').first().textContent()).includes(`Factura del código ${C0}`) && (await v.locator('select[name="unidad"]').count()) === 0,
    'su ventana es la de siempre: «Factura del código …», sin preguntar la unidad')
  await llenar(v, { numero: F_UNA, total: 9000 })
  await v.getByRole('button', { name: 'Registrar la factura' }).click()
  const e3 = await esperarVentana(pagina)
  comprobar(e3 === '', `su factura se registra${e3 ? ` (dijo: ${e3})` : ''}`)
  await sola.locator(`article[data-factura="${F_UNA}"]`).waitFor({ timeout: 30000 }).catch(() => {})
  const [u] = await consulta(
    `select f.codigo_interno, (select string_agg(p.numero_de_unidad || '/' || p.de_unidades || ':' || p.monto, ' | ') from facturas_venta_unidades p where p.factura_id = f.id) as partes
       from facturas_venta f where f.numero = $1`, [F_UNA])
  comprobar(u?.codigo_interno === C0 && u.partes === '1/1:9000.00', `la base la guarda en su código, con su única parte (${u?.partes})`)
  const solaDespues = limpio(await sola.textContent())
  comprobar(solaDespues.includes('Facturada') && !solaDespues.includes('Unidad 1 de 1') && (await fila(C0).count()) === 0,
    'queda «Facturada», sin decir «Unidad 1 de 1», y sale de «Por facturar»')
  comprobar((await cuenta(pagina, '/contabilidad/facturacion')) === antes.facturar + 3, 'el globo cuenta las tres unidades de la primera, todas en parte')
  // En el inicio, «Te toca» dice unidades (hay una cotización de varias) y lo que falta facturar de ellas.
  await ir(pagina, `${BASE}/`)
  const teToca = limpio(await pagina.locator('a[href="/contabilidad/facturacion"]').filter({ hasText: /por facturar/ }).first().textContent().catch(() => '(no está)'))
  comprobar(/unidades con su OT por facturar/.test(teToca) && /S\/\s?[\d,]+\.\d\d/.test(teToca), `el inicio dice las unidades por facturar con su monto («${teToca}»)`)
  await contexto.close()
}

// -------------------------------------------------------------- 4. Tesorería
// La unidad 2 pide salir del taller: una salida por revisar con su código.
const PLACA = `QF2-${sello.slice(2)}`
/** El renglón del cobro en la tarjeta de la salida de ese vehículo. */
const delaSalida = (pagina, que) => pagina.locator('li, article').filter({ hasText: PLACA }).filter({ has: pagina.locator(que) }).last().locator(que).first()
{
  const { id: pide } = await uno(`select u.id from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'REQUERIMIENTOS' and u.activo limit 1`)
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    const { id: registro } = await uno(
      `insert into public.registro_vehiculos (id, placa, unidad, empresa, motivo, codigo_interno, ingreso_en, ingreso_por)
       values (gen_random_uuid(), $1, 'CAMABAJA DE PRUEBA', $2, 'FABRICACION', $3, now() - interval '2 days', $4) returning id`,
      [PLACA, CLIENTE, C2, pide],
    )
    await consulta(`insert into public.registro_vehiculo_revisiones (registro_id, concepto, solicitado_por) values ($1, 'Salida de la camabaja terminada', $2)`, [registro, pide])
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
  // La cuenta de Costos, si no está (la misma de probar-por-cobrar-de-costos.mjs).
  if (!process.env.COSTOS) {
    let fila = await uno('select id from public.usuarios where correo = $1', [COSTOS])
    if (!fila) {
      fila = await uno(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [COSTOS])
      await consulta(
        `insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
         select $1, 'COSTOS', 'Banco por cobrar', $2, r.id from public.roles r where r.codigo = 'COSTOS'`,
        [fila.id, COSTOS],
      )
    }
    await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [COSTOS, CLAVE])
  }
}
{
  const caja = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await ir(pagina, `${BASE}/tesoreria/por-cobrar`)
  const deUnidad = pagina.locator(`article[data-factura="${F_UNIDAD}"]`)
  const deToda = pagina.locator(`article[data-factura="${F_TODA}"]`)
  const t1 = limpio(await deUnidad.textContent())
  const t2 = limpio(await deToda.textContent())
  comprobar(t1.includes('Unidad 2 de 3') && t1.includes(`código ${C2}`) && t1.includes(`cotización ${tres.numero}`), `Tesorería ve de qué unidad es la factura y su código («${t1.slice(0, 110)}…»)`)
  comprobar(t2.includes('Toda la cotización · 3 unidades') && t2.includes(`Unidad 1 · código ${C1} · S/ 3,333.33`) && t2.includes(`Unidad 3 · código ${C3} · S/ 3,333.33`)
    && t2.split(C1).length === 2,
    `y la de toda la cotización, con sus tres códigos una sola vez y lo de cada una («${t2.slice(0, 110)}…»)`)
  const t0 = limpio(await pagina.locator(`article[data-factura="${F_UNA}"]`).textContent())
  comprobar(t0.includes(`código ${C0}`) && !t0.includes('Unidad 1') && !t0.includes('Toda la cotización'), 'la de una unidad, como siempre')

  await deToda.getByRole('button', { name: 'Registrar cobro' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="monto"]').fill('1000')
  await v.locator('input[name="operacion"]').fill('OP-998')
  await v.locator('input[name="archivo"]').setInputFiles(PDF_VOUCHER)
  await elegirCuenta(v, caja)
  await v.getByRole('button', { name: 'Registrar el cobro' }).click()
  const e = await esperarVentana(pagina)
  comprobar(e === '', `Tesorería cobra S/ 1 000 de la factura por toda la cotización${e ? ` (dijo: ${e})` : ''}`)
  await deToda.getByText('Cobro a cuenta').waitFor({ timeout: 30000 }).catch(() => {})
  const partes = await consulta(
    `select numero_de_unidad, cobrado, saldo from v_facturas_venta_por_unidad where numero = $1 order by numero_de_unidad`, [F_TODA])
  comprobar(partes.map((x) => `${x.cobrado}/${x.saldo}`).join(' | ') === '333.33/3000.00 | 333.34/3000.00 | 333.33/3000.00',
    `lo cobrado y el saldo se reparten como el total (${partes.map((x) => `${x.cobrado}/${x.saldo}`).join(' | ')})`)
  const aprobada = limpio(await pagina.locator(`div[data-cotizacion="${tres.numero}"]`).textContent())
  comprobar(aprobada.includes(`Códigos ${C1} · ${C2} · ${C3}`) && aprobada.includes('3 unidades') && aprobada.includes('35,400.00'),
    `abajo, la cotización aprobada con sus tres códigos («${aprobada.slice(0, 120)}…»)`)
  await deToda.scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-1440-por-cobrar.png'), fullPage: true })

  // La revisión de salida del vehículo de la unidad 2: lo cobrado y lo que falta, de esa unidad.
  await ir(pagina, `${BASE}/tesoreria/por-cobrar`)
  const salida = limpio(await delaSalida(pagina, '[data-cobro-del-codigo]').textContent().catch(() => '(no está)'))
  comprobar(salida.includes('Cobrado S/ 333.34') && salida.includes('de lo que le toca a la unidad 2 de 3 de su cotización, S/ 11,800.00') && !salida.includes('de la cotización de'),
    `Tesorería ve en la salida del vehículo lo cobrado de la unidad 2, contra lo que le toca («${salida}»)`)
  await delaSalida(pagina, '[data-cobro-del-codigo]').scrollIntoViewIfNeeded().catch(() => {})
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-1440-salida-del-vehiculo.png') })
  await contexto.close()

  // Costos responde la misma salida sin leer cotizaciones: lo por cobrar de las facturas de ese código.
  const costos = await entrar(COSTOS)
  await ir(costos.pagina, `${BASE}/tesoreria/por-cobrar`)
  const paraCostos = limpio(await delaSalida(costos.pagina, '[data-por-cobrar-de-facturas]').textContent().catch(() => '(no está)'))
  comprobar(paraCostos.includes('2 facturas') && paraCostos.includes('S/ 8,900.00'),
    `Costos ve lo por cobrar del código de la unidad 2: su factura y su parte de la de toda la cotización («${paraCostos}»)`)
  await costos.contexto.close()

  const telefono = await entrar(CUENTAS.tesoreria, { width: 390, height: 844 })
  await ir(telefono.pagina, `${BASE}/tesoreria/por-cobrar`)
  comprobar((await desborde(telefono.pagina)) <= 0, 'Cuentas por cobrar no se corre de costado en el teléfono')
  await telefono.pagina.locator(`article[data-factura="${F_TODA}"]`).scrollIntoViewIfNeeded()
  await telefono.pagina.screenshot({ path: join(CAPTURAS, 'unidad-390-por-cobrar.png') })
  await telefono.contexto.close()
}

// --------------------------------------------------------------- 5. Gerencia
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  const ficha = (c) => `${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: c, vista: 'facturacion' })}`
  await ir(pagina, ficha(C1))
  const cot1 = limpio(await pagina.locator(`li[data-cotizacion="${tres.numero}"]`).textContent())
  comprobar(cot1.includes('unidad 1 de 3') && cot1.includes('S/ 11,800.00') && cot1.includes('lo que le toca a esta unidad') && cot1.includes('Facturado S/ 3,333.33 · cobrado S/ 333.33'),
    `la ficha del código de la unidad 1 trae la cotización como «unidad 1 de 3», con lo que le toca y lo suyo («${cot1.slice(0, 150)}…»)`)
  const facturas1 = await pagina.locator('article[data-factura]').evaluateAll((l) => l.map((e) => e.getAttribute('data-factura')))
  comprobar(facturas1.length === 1 && facturas1[0] === F_TODA, `y solo la factura por toda la cotización, no la de la unidad 2 (${facturas1.join(', ')})`)
  const parte1 = limpio(await pagina.locator(`article[data-factura="${F_TODA}"] li[data-parte="1"]`).textContent())
  comprobar(parte1.includes('este código') && parte1.includes('S/ 3,333.33'), `con la parte de este código marcada («${parte1}»)`)
  const facturaEnFicha = pagina.locator(`article[data-factura="${F_TODA}"]`)
  const saldoEnFicha = limpio(await facturaEnFicha.locator('[data-saldo-de-la-factura]').textContent())
  const deEste = limpio(await facturaEnFicha.locator('[data-de-este-codigo]').textContent())
  comprobar(saldoEnFicha === 'Saldo de este código S/ 3,000.00' && deEste.includes('A este código le tocan S/ 3,333.33 · cobrado S/ 333.33') && deEste.includes('la factura es por S/ 10,000.00, con saldo de S/ 9,000.00'),
    `y la cifra que manda es la de este código, no el saldo de toda la factura («${saldoEnFicha}» · «${deEste}»)`)
  const cobroEnFicha = limpio(await facturaEnFicha.locator('ol li').first().textContent().catch(() => ''))
  comprobar(cobroEnFicha.includes('S/ 1,000.00 de toda la factura'), `y el cobro dice que es el de toda la factura («${cobroEnFicha}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-1440-ficha-del-codigo.png'), fullPage: true })

  await ir(pagina, ficha(C2))
  const cot2 = limpio(await pagina.locator(`li[data-cotizacion="${tres.numero}"]`).textContent())
  const facturas2 = await pagina.locator('article[data-factura]').evaluateAll((l) => l.map((e) => e.getAttribute('data-factura')))
  comprobar(cot2.includes('unidad 2 de 3') && cot2.includes('Facturado S/ 9,233.34') && facturas2.length === 2 && facturas2.includes(F_UNIDAD) && facturas2.includes(F_TODA),
    `la del código de la unidad 2 trae sus dos facturas y lo facturado de su unidad (${facturas2.join(', ')})`)

  await ir(pagina, ficha(C0))
  const cot0 = limpio(await pagina.locator(`li[data-cotizacion="${una.numero}"]`).textContent())
  comprobar(cot0.includes('S/ 9,000.00') && !cot0.includes('unidad 1 de') && !cot0.includes('lo que le toca'), 'la ficha del código de la cotización de una unidad, como siempre')
  await contexto.close()
}

// ----------------------------------------------- 6. Contabilidad en el teléfono
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  comprobar((await desborde(pagina)) <= 0, 'Facturación no se corre de costado en el teléfono')
  const fila = limpio(await pagina.locator(`#por-facturar tbody tr[data-por-facturar="${C1}"]`).textContent())
  comprobar(fila.includes('unidad 1 de 3') && fila.includes('falta'), `en el teléfono la fila dice la unidad y lo que falta («${fila}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-390-por-facturar.png') })
  const tarjeta = pagina.locator(`li[data-cotizacion="${tres.numero}"]`)
  await tarjeta.scrollIntoViewIfNeeded()
  await tarjeta.screenshot({ path: join(CAPTURAS, 'unidad-390-tarjeta.png') })
  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('select[name="unidad"]').selectOption('1')
  // La captura, con la pregunta de la unidad a la vista y sin el indicador de `next dev`.
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await v.getByText('De qué unidad es').first().scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-390-formulario.png') })
  await v.locator('input[name="total"]').fill('8466.67')
  comprobar((await desborde(pagina)) <= 0, 'ni con la ventana de la factura abierta')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await contexto.close()
}

// ------------------- 7. La OT que podría quedarse con la factura de otro vehículo
// La factura sigue al número de la unidad. Se anulan las OT de las unidades 2 y 3
// (la 2 ya tiene su factura): quedan dos libres, y la OT que se cargue primero
// queda como unidad 2, con esa factura. La ventana de la OT lo avisa antes.
{
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    await consulta(
      `update public.ordenes_trabajo o set estado = 'ANULADA', motivo_anulacion = 'Se cargó con el código equivocado'
        where o.cotizacion_pdf_id = $1 and coalesce(o.numero_de_unidad, 1) in (2, 3)`,
      [tres.id],
    )
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
  const { pagina, contexto } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/cotizaciones/pdf?${new URLSearchParams({ q: tres.numero })}`)
  await pagina.getByRole('button', { name: 'Cargar la OT 2 de 3' }).first().click()
  const v = pagina.locator('[role="dialog"]')
  const aviso = limpio(await v.locator('[data-unidad-ya-facturada]').textContent({ timeout: 10000 }).catch(() => ''))
  comprobar(aviso.includes('La unidad 2 ya tiene factura') && aviso.includes(C2) && aviso.includes('solo si esta OT es de ese mismo vehículo') && !/S\/\s?\d/.test(aviso),
    `la ventana de la OT avisa que la unidad 2 ya tiene factura, con su código y sin montos («${aviso}»)`)
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await pagina.screenshot({ path: join(CAPTURAS, 'unidad-1440-ventana-de-la-ot.png') })
  await v.getByRole('button', { name: 'Cancelar' }).click()
  // La de una unidad, y la que tiene una sola libre, no avisan: cargada una, la que falta es la del otro vehículo.
  await cargarOt(tres, `QA-FU2B ${sello}`)
  await ir(pagina, `${BASE}/cotizaciones/pdf?${new URLSearchParams({ q: tres.numero })}`)
  await pagina.getByRole('button', { name: 'Cargar la OT 3 de 3' }).first().click()
  await v.locator('#eo-codigo-interno').waitFor({ timeout: 10000 })
  comprobar((await v.locator('[data-unidad-ya-facturada]').count()) === 0, 'con una sola unidad libre la ventana no avisa nada')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length > 0) {
  console.log('\nErrores de consola:')
  for (const e of [...new Set(errores)]) console.log('  ·', e)
  fallas.push(`${errores.length} errores de consola`)
}
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan:\n${fallas.map((f) => `  · ${f}`).join('\n')}`)
process.exit(fallas.length === 0 ? 0 : 1)

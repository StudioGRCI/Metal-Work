/**
 * Recorre con clic real «el recorrido de la cotización, unidad por unidad»
 * (migración 20261126998900), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Ventas, en monitor y en teléfono: la tarjeta de la cotización de tres
 *      unidades (una cobrada, otra con su OT y sin factura, otra sin OT) dice,
 *      cerrada, a quiénes espera (en el orden del circuito) y hace cuánto; abierta, lo de toda la
 *      cotización y cada unidad bajo su rótulo, con su OT y su factura. Ventas
 *      no ve el cobro. La cotización de una unidad se ve como siempre. La ficha
 *      del cliente nombra a todos los que la tienen.
 *   2. Contabilidad, en Facturación: la unidad 1 dice «Cobrada». Registra con
 *      clic real la factura de la unidad 2, y el recorrido de esa unidad pasa
 *      de Contabilidad a Tesorería; las otras dos no cambian.
 *   3. Gerencia, en la ficha de cada código: el código de la unidad 1 (que no
 *      es la OT más nueva) ya tiene su cotización, dice «unidad 1 de 3» y su
 *      recorrido trae solo esa unidad.
 *   3b. Gerencia: la cotización de dos unidades ya cobradas dice, cerrada, en
 *      qué terminó («Cobrada» y la fecha), no a quién espera.
 *   4. Administración, en la OT de la unidad 2: el recorrido de su cotización
 *      trae lo de toda la cotización y lo de la unidad 2, sin las otras.
 *
 * Siembra por SQL, con la sesión de cada puesto, su cliente QA RECORRIDO POR
 * UNIDAD …, la cotización de tres (30 000 soles sin IGV: 11 800 por unidad con
 * IGV), la de una, sus OT, la factura de la unidad 1 y su cobro; todo se queda
 * en el banco: nada numerado se borra.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_ARCHIVOS (el mismo del servidor del banco).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba } from './caja-de-prueba.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ALMACEN = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
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
const CLIENTE = `QA RECORRIDO POR UNIDAD ${sello} S.A.C.`
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

/** Contabilidad registra por SQL la factura de una unidad (0 = toda la cotización), con su PDF. */
async function facturar(cot, numero, total, unidad) {
  const { id, archivo } = await uno('select gen_random_uuid() as id, gen_random_uuid() as archivo')
  const ruta = `${id}/${archivo}.pdf`
  const contenido = pdfConTexto([`FACTURA ELECTRONICA ${numero}`, CLIENTE, 'Archivo de prueba del banco local'])
  guardar('facturas-venta', ruta, contenido)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('facturas-venta', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [ruta, ids.contabilidad, contenido.length],
  )
  await como(
    'contabilidad',
    `select public.registrar_factura_venta_de_unidad($1, $2, $3, (now() at time zone 'America/Lima')::date,
       (now() at time zone 'America/Lima')::date + 30, 'PEN', $4, null, $5, 'factura.pdf', $6)`,
    [id, cot.id, numero, total, ruta, unidad],
  )
  return id
}

/** Tesorería cobra por SQL una factura entera, con su constancia, en la caja de prueba. */
async function cobrar(facturaId, monto, caja) {
  const { id } = await uno('select gen_random_uuid() as id')
  const ruta = `${facturaId}/${id}.pdf`
  const contenido = pdfConTexto(['CONSTANCIA DE OPERACION', `Operacion OP-${sello}-${id.slice(0, 4)}`, 'Banco de prueba'])
  guardar('cobros-venta', ruta, contenido)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('cobros-venta', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [ruta, ids.tesoreria, contenido.length],
  )
  const { id: cajaId } = await uno('select id from public.cajas where nombre = $1', [caja])
  await como(
    'tesoreria',
    `select public.registrar_cobro_factura($1, $2, (now() at time zone 'America/Lima')::date, $3, true, $4, $5, $6, null)`,
    [id, facturaId, monto, `OP-${sello}-${id.slice(0, 4)}`, ruta, cajaId],
  )
}

const C1 = `QA-RU1 ${sello}`
const C2 = `QA-RU2 ${sello}`
const C0 = `QA-RU0 ${sello}`
// La de tres: 30 000 sin IGV son 35 400 con IGV, 11 800 por unidad. Dos con su OT; la 1, facturada y cobrada.
const tres = await cotizacion(30000, 3, false)
await cargarOt(tres, C1)
await cargarOt(tres, C2)
// La de una, 9 000 con IGV, con su OT: espera su factura.
const una = await cotizacion(9000, 1, true)
await cargarOt(una, C0)

const serie = (await uno(
  `select 'F' || lpad(n::text, 3, '0') as s from generate_series(100, 999) n
    where not exists (select 1 from public.facturas_venta f where f.numero like 'F' || lpad(n::text, 3, '0') || '-%') order by random() limit 1`,
)).s
const F_UNA = `${serie}-1`
const F_DOS = `${serie}-2`
const caja = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)
await cobrar(await facturar(tres, F_UNA, 11800, 1), 11800, caja)
// La de dos, 20 000 sin IGV (11 800 por unidad), con sus dos OT, facturadas y cobradas: ya nadie la tiene.
const CA = `QA-RUA ${sello}`
const CB = `QA-RUB ${sello}`
const dos = await cotizacion(20000, 2, false)
await cargarOt(dos, CA)
await cargarOt(dos, CB)
await cobrar(await facturar(dos, `${serie}-3`, 11800, 1), 11800, caja)
await cobrar(await facturar(dos, `${serie}-4`, 11800, 2), 11800, caja)
const PDF_FACTURA = join(CAPTURAS, `factura-${serie}.pdf`)
writeFileSync(PDF_FACTURA, pdfConTexto([`FACTURA ELECTRONICA ${serie}`, CLIENTE, 'Archivo de prueba del banco local']))
const ots = await consulta(
  `select o.id, o.numero, coalesce(o.numero_de_unidad, 1) as unidad from public.ordenes_trabajo o where o.cotizacion_pdf_id = $1 order by 3`, [tres.id])
console.log(`     sembrado: ${tres.numero} de tres unidades (${C1} cobrada, ${C2} con su OT y una sin OT) y ${una.numero} de una (${C0})`)

/** Lo que dice el recorrido que hay dentro de `caja`: cerrado, y abierto por tramos. Lo deja abierto. */
async function leerRecorrido(dentro) {
  const r = dentro.locator('[data-recorrido]').first()
  await r.waitFor({ timeout: 15000 })
  const cerrado = limpio(await r.locator('summary').textContent())
  if (!(await r.evaluate((d) => d.open))) await r.locator('summary').click()
  const unidades = await r.locator('[data-recorrido-unidad]').evaluateAll((l) =>
    l.map((u) => ({
      unidad: Number(u.getAttribute('data-recorrido-unidad')),
      rotulo: (u.querySelector(':scope > p')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      pasos: [...u.querySelectorAll('[data-recorrido-paso]')].map((p) => `${p.getAttribute('data-recorrido-paso')}:${p.getAttribute('data-situacion')}`).join(' > '),
      texto: (u.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
  )
  const deToda = await r.locator(':scope > ol > [data-recorrido-paso]').evaluateAll((l) =>
    l.map((p) => `${p.getAttribute('data-recorrido-paso')}:${p.getAttribute('data-situacion')}`).join(' > '),
  )
  return { cerrado, unidades, deToda, donde: r }
}
const deLaUnidad = (rec, n) => rec.unidades.find((u) => u.unidad === n) ?? { rotulo: '', pasos: '', texto: '' }

/**
 * Captura `elemento` entero y centrado: la ventana crece hasta que quepa, para
 * que la barra de arriba y el menú del teléfono queden en su sitio y no encima.
 */
async function capturar(pagina, nombre, elemento) {
  const antes = pagina.viewportSize()
  const alto = Math.ceil((await elemento.boundingBox())?.height ?? 0)
  await pagina.setViewportSize({ width: antes.width, height: Math.max(antes.height, Math.min(alto + 240, 6000)) })
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {})
  await elemento.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await pagina.waitForTimeout(300)
  await pagina.screenshot({ path: join(CAPTURAS, nombre) })
  await pagina.setViewportSize(antes)
}

// ------------------------------------------------------------------ 1. Ventas
for (const [ancho, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const { pagina, contexto } = await entrar(CUENTAS.ventas, viewport)
  await ir(pagina, `${BASE}/cotizaciones/pdf?q=${encodeURIComponent(tres.numero)}`)
  const tarjeta = pagina.locator(`li[id="${tres.id}"]`)
  const rec = await leerRecorrido(tarjeta)
  console.log(`     Ventas ${ancho}, cerrado: ${rec.cerrado}`)
  comprobar(rec.cerrado.includes('La tienen Administración y Contabilidad') && rec.cerrado.includes('desde hoy'),
    `Ventas ${ancho}: cerrado nombra a los dos que la tienen, sin Tesorería, y desde cuándo («${rec.cerrado}»)`)
  comprobar(rec.deToda === 'SUBIDA:HECHO > REVISION:HECHO', `Ventas ${ancho}: primero lo de toda la cotización (${rec.deToda})`)
  comprobar(rec.unidades.length === 3 && rec.unidades.map((u) => u.rotulo).join(' | ') === 'Unidad 1 de 3 | Unidad 2 de 3 | Unidad 3 de 3',
    `Ventas ${ancho}: después, cada unidad bajo su rótulo (${rec.unidades.map((u) => u.rotulo).join(' | ')})`)
  comprobar(deLaUnidad(rec, 1).pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO' && !deLaUnidad(rec, 1).texto.includes('Cobrada'),
    `Ventas ${ancho}: la unidad 1 tiene su OT y su factura; el cobro no lo ve Ventas (${deLaUnidad(rec, 1).pasos})`)
  comprobar(deLaUnidad(rec, 2).pasos === 'CODIGO_Y_OT:HECHO > FACTURA:AHORA' && deLaUnidad(rec, 2).texto.includes('Ahora la tiene Contabilidad')
    && deLaUnidad(rec, 2).texto.includes('Registra su factura.'),
    `Ventas ${ancho}: la unidad 2 espera su factura sin esperar a la 3 (${deLaUnidad(rec, 2).pasos})`)
  comprobar(deLaUnidad(rec, 3).pasos === 'CODIGO_Y_OT:AHORA > FACTURA:PENDIENTE' && deLaUnidad(rec, 3).texto.includes('Ahora la tiene Administración')
    && deLaUnidad(rec, 3).texto.includes('Le da el código interno de la unidad y sube la OT.'),
    `Ventas ${ancho}: la unidad 3 espera su OT (${deLaUnidad(rec, 3).pasos})`)
  comprobar(deLaUnidad(rec, 1).texto.includes(`OT ${ots[0].numero}`), `Ventas ${ancho}: la unidad 1 dice el número de su OT`)
  comprobar((await desborde(pagina)) <= 0, `Ventas ${ancho}: la página no se corre de costado con el recorrido abierto`)
  await capturar(pagina, `recorrido-${ancho}-tarjeta.png`, tarjeta)

  // La de una unidad, como siempre.
  await ir(pagina, `${BASE}/cotizaciones/pdf?q=${encodeURIComponent(una.numero)}`)
  const recUna = await leerRecorrido(pagina.locator(`li[id="${una.id}"]`))
  comprobar(recUna.unidades.length === 0 && recUna.cerrado.includes('La tiene Contabilidad')
    && recUna.deToda === 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:AHORA',
    `Ventas ${ancho}: la cotización de una unidad se ve como siempre, sin rótulos de unidad («${recUna.cerrado}»: ${recUna.deToda})`)

  // La ficha del cliente nombra a todos los que la tienen.
  await ir(pagina, `${BASE}/clientes/${clienteId}`)
  const filaTres = pagina.locator('[data-cotizaciones-del-cliente] li', { hasText: tres.numero })
  const ahora = limpio(await filaTres.locator('[data-cotizacion-ahora]').textContent().catch(() => ''))
  comprobar(ahora.startsWith('Administración y Contabilidad') && ahora.includes('desde hoy') && ahora.includes('Lo tienen Administración y Contabilidad'),
    `Ventas ${ancho}: la ficha del cliente dice quiénes la tienen («${ahora}»)`)
  const filaUna = pagina.locator('[data-cotizaciones-del-cliente] li', { hasText: una.numero })
  const ahoraUna = limpio(await filaUna.locator('[data-cotizacion-ahora]').textContent().catch(() => ''))
  comprobar(ahoraUna.includes('Contabilidad · desde hoy') && ahoraUna.includes('Lo tiene Contabilidad'), `Ventas ${ancho}: y la de una unidad, como siempre («${ahoraUna}»)`)
  comprobar((await desborde(pagina)) <= 0, `Ventas ${ancho}: la ficha del cliente no se corre de costado`)
  await capturar(pagina, `recorrido-${ancho}-ficha-del-cliente.png`, pagina.locator('[data-cotizaciones-del-cliente]'))
  await contexto.close()
}

// ------------------------------------------------------------ 2. Contabilidad
for (const [ancho, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad, viewport)
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  const tarjeta = pagina.locator(`li[data-cotizacion="${tres.numero}"]`)
  let rec = await leerRecorrido(tarjeta)
  if (ancho === '1440') {
    comprobar(deLaUnidad(rec, 1).pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:HECHO' && deLaUnidad(rec, 1).texto.includes('Cobrada'),
      `Contabilidad: la unidad 1 quedó cobrada (${deLaUnidad(rec, 1).pasos})`)
    comprobar(deLaUnidad(rec, 2).pasos === 'CODIGO_Y_OT:HECHO > FACTURA:AHORA > COBRO:PENDIENTE'
      && deLaUnidad(rec, 3).pasos === 'CODIGO_Y_OT:AHORA > FACTURA:PENDIENTE > COBRO:PENDIENTE',
      `Contabilidad: la 2 espera su factura y la 3 su OT, cada una con el cobro que le falta (${deLaUnidad(rec, 2).pasos} | ${deLaUnidad(rec, 3).pasos})`)
    comprobar(rec.cerrado.includes('La tienen Administración y Contabilidad'), `Contabilidad: cerrado, a quiénes espera («${rec.cerrado}»)`)

    // Con clic real: la factura de la unidad 2, entera.
    await tarjeta.locator('li[data-unidad="2"] [data-facturar-unidad="2"]').click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('input[name="numero"]').fill(F_DOS)
    await v.locator('input[name="total"]').fill('11800')
    await v.locator('input[name="archivo"]').setInputFiles(PDF_FACTURA)
    await v.locator('button[type="submit"]').click()
    const error = await esperarVentana(pagina)
    comprobar(error === '', `Contabilidad registra la factura de la unidad 2${error ? ` (dijo: ${error})` : ''}`)
    await tarjeta.locator(`article[data-factura="${F_DOS}"]`).waitFor({ timeout: 30000 }).catch(() => {})
    await ir(pagina, `${BASE}/contabilidad/facturacion`)
    rec = await leerRecorrido(tarjeta)
    comprobar(deLaUnidad(rec, 2).pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:AHORA' && deLaUnidad(rec, 2).texto.includes('Ahora la tiene Tesorería')
      && deLaUnidad(rec, 2).texto.includes('Cobra sus facturas.'),
      `con su factura, la unidad 2 pasa de Contabilidad a Tesorería (${deLaUnidad(rec, 2).pasos})`)
    comprobar(deLaUnidad(rec, 1).pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:HECHO'
      && deLaUnidad(rec, 3).pasos === 'CODIGO_Y_OT:AHORA > FACTURA:PENDIENTE > COBRO:PENDIENTE',
      'y las otras dos unidades no cambian')
    comprobar(rec.cerrado.includes('La tienen Administración y Tesorería'), `cerrado, ahora espera a Administración y a Tesorería («${rec.cerrado}»)`)
  } else {
    comprobar(rec.unidades.length === 3 && deLaUnidad(rec, 2).pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:AHORA',
      `Contabilidad 390: las tres unidades, con la 2 ya en Tesorería (${deLaUnidad(rec, 2).pasos})`)
  }
  comprobar((await desborde(pagina)) <= 0, `Contabilidad ${ancho}: la página no se corre de costado con el recorrido abierto`)
  await capturar(pagina, `recorrido-${ancho}-facturacion.png`, tarjeta)
  await contexto.close()
}

// ---------------------------------------------------------------- 3. Gerencia
for (const [ancho, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const { pagina, contexto } = await entrar(CUENTAS.gerencia, viewport)
  for (const [codigo, n] of [[C1, 1], [C2, 2]]) {
    await ir(pagina, `${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent(codigo)}`)
    const ficha = pagina.locator('main')
    const texto = limpio(await ficha.textContent())
    comprobar(texto.includes(tres.numero) && texto.includes(`unidad ${n} de 3`) && !texto.includes('Sin cotización'),
      `Gerencia ${ancho}: la ficha del código de la unidad ${n} tiene su cotización y dice «unidad ${n} de 3»`)
    const rec = await leerRecorrido(ficha)
    comprobar(rec.cerrado.includes(`Recorrido de la cotización ${tres.numero}`) && rec.unidades.length === 1 && rec.unidades[0].unidad === n
      && rec.unidades[0].rotulo === `Unidad ${n} de 3` && rec.deToda === 'SUBIDA:HECHO > REVISION:HECHO',
      `Gerencia ${ancho}: su recorrido trae lo de toda la cotización y solo la unidad ${n} (${rec.unidades.map((u) => u.rotulo).join(', ')})`)
    if (n === 1) {
      comprobar(rec.unidades[0].pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:HECHO' && rec.cerrado.includes('Cobrada'),
        `Gerencia ${ancho}: la unidad 1 está cobrada y el recorrido cerrado lo dice («${rec.cerrado}»)`)
    } else {
      comprobar(rec.unidades[0].pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:AHORA' && rec.cerrado.includes('La tiene Tesorería'),
        `Gerencia ${ancho}: la unidad 2 espera su cobro, y cerrado dice solo quién tiene esa unidad («${rec.cerrado}»)`)
      comprobar((await desborde(pagina)) <= 0, `Gerencia ${ancho}: la ficha no se corre de costado`)
      await capturar(pagina, `recorrido-${ancho}-ficha-del-codigo.png`, rec.donde)
    }
  }
  await contexto.close()
}

// ------------------------------------------- 3b. Gerencia: la que ya nadie tiene
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/cotizaciones/pdf?q=${encodeURIComponent(dos.numero)}`)
  const rec = await leerRecorrido(pagina.locator(`li[id="${dos.id}"]`))
  comprobar(/Recorrido\s*Cobrada · \d{2}\/\d{2}\/\d{4}$/.test(rec.cerrado) && !rec.cerrado.includes('tiene'),
    `Gerencia: con sus dos unidades cobradas, cerrado dice en qué terminó y cuándo («${rec.cerrado}»)`)
  comprobar(rec.unidades.length === 2 && rec.unidades.every((u) => u.pasos === 'CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:HECHO'),
    `Gerencia: y abierta, cada unidad con su OT, su factura y su cobro hechos (${rec.unidades.map((u) => u.pasos).join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------------------------- 4. Administración
for (const [ancho, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const { pagina, contexto } = await entrar(CUENTAS.administracion, viewport)
  await ir(pagina, `${BASE}/ordenes/${ots[1].id}`)
  const caja = pagina.locator('[data-recorrido-de-la-ot]')
  const rec = await leerRecorrido(caja)
  comprobar(rec.unidades.length === 1 && rec.unidades[0].unidad === 2 && rec.unidades[0].rotulo === 'Unidad 2 de 3'
    && rec.deToda === 'SUBIDA:HECHO > REVISION:HECHO' && rec.unidades[0].texto.includes(`OT ${ots[1].numero}`),
    `Administración ${ancho}: la OT de la unidad 2 muestra lo de toda la cotización y solo su unidad (${rec.unidades.map((u) => u.rotulo).join(', ')})`)
  comprobar((await desborde(pagina)) <= 0, `Administración ${ancho}: la OT no se corre de costado`)
  await capturar(pagina, `recorrido-${ancho}-ot.png`, caja)
  await contexto.close()
}

await navegador.close()
await base.end()
comprobar(errores.length === 0, `sin errores en la consola del navegador${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
console.log(fallas.length === 0 ? '\nTodo en orden.' : `\n${fallas.length} FALLAS:\n- ${fallas.join('\n- ')}`)
process.exit(fallas.length === 0 ? 0 : 1)

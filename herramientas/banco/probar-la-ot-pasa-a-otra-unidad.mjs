/**
 * Recorre con clic real la OT de la unidad 2 o la 3 que pasa a otro comprador
 * (migración 20261126999100; StudioGRCI, 2026-11-27: «Sí, en un PR aparte»),
 * con la cuenta de cada puesto (nunca ADMIN). Hasta esa migración la base
 * rechazaba la OT de la unidad 2 hacia una cotización de 1 unidad («no tiene
 * unidad 2») y cualquier OT hacia una que ya tenía una OT.
 *
 *   1. Ventas sube tres cotizaciones (una de 3 unidades del primer cliente, una
 *      de 1 y otra de 3 de dos compradores más) y Gerencia las aprueba.
 *   2. Administración carga las tres OT de la primera y una de la tercera.
 *   3. En el monitor, con «Editar OT / cambiar cliente», pasa la OT de la
 *      unidad 2 a la de 1 unidad: allí es la unidad 1 y la venta anterior
 *      guarda la 2. Intenta pasar la de la unidad 1 a esa misma, ya con su OT:
 *      la ventana dice por qué no.
 *   4. En el teléfono pasa la OT de la unidad 3 a la otra de 3 unidades, que ya
 *      tenía una OT: allí es la unidad 2.
 *   5. Administración y Ventas ven en Cotización la de origen con la unidad 2 y
 *      la 3 que pasaron, cada una con su OT, y la de destino con su OT en la
 *      unidad 1 y la que llegó en la 2; Administración puede cargar la 3.
 *   6. Contabilidad, en Facturación, ve la unidad 2 de la de destino con el
 *      código y la OT que llegaron.
 *   7. La OT que se carga después en la de destino es la unidad 3.
 *
 * Capturas en teléfono (390) y monitor (1440). Arma sus datos ficticios
 * (QA-P8U-…) y las cuentas `*.p8u@banco.test` con la clave local. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_ARCHIVOS (el mismo del servidor del banco), CAPTURAS.
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

// ------------------------------------------------------------------ armazón
const sello = Date.now().toString().slice(-6)
const anio = (await uno(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY') as a`)).a
const CUENTAS = {
  ventas: ['VENDEDOR', 'GCO'],
  gerencia: ['GERENTE', 'GGE'],
  administracion: ['ADMINISTRACION', 'ADM'],
  contabilidad: ['CONTABILIDAD', 'CON'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.p8u@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, null) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco plan 8', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
      [fila.id, rol, correo, area],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
  ids[clave] = fila.id
}

/** Corre `sql` dentro de una transacción con la sesión de `quien` y el rol authenticated. */
async function como(quien, sql, valores = []) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [ids[quien]])
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

async function rucLibre() {
  return (await uno(`select n::text as ruc from generate_series(20990049000::bigint, 20990049999::bigint) n
                      where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text)
                      limit 1`)).ruc
}
const clientes = {}
for (const [clave, nombre] of [
  ['a', `QA PRIMER COMPRADOR P8U ${sello} S.A.C.`],
  ['b', `QA SEGUNDO COMPRADOR P8U ${sello} S.A.C.`],
  ['c', `QA TERCER COMPRADOR P8U ${sello} S.A.C.`],
]) {
  clientes[clave] = { nombre, id: (await uno(
    `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
    [await rucLibre(), nombre],
  )).id }
}
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

// 1. Ventas sube tres cotizaciones; Gerencia las aprueba.
const cot = {}
for (const [clave, cliente, unidades] of [['tres', 'a', 3], ['una', 'b', 1], ['otra', 'c', 3]]) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const numero = `QA-P8U-${sello}-${clave.toUpperCase()}`
  const ruta = `cot/${id}/${id}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${numero}`, `CLIENTE: ${clientes[cliente].nombre}`, `${unidades} semirremolque(s) de prueba`])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
                        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 45000, 'USD', $9)`,
  [id, numero, clientes[cliente].id, carroceria, `Cotización ${numero}.pdf`, ruta, contenido.length, ids.ventas, unidades])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.ventas, contenido.length])
  const [ap] = await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1 returning id`, [id])
  comprobar(Boolean(ap), `Gerencia aprueba ${numero} (con su rol)`)
  cot[clave] = { id, numero, unidades }
}

// 2. Administración carga las tres OT de la primera y una de la tercera.
const libres = (await consulta(`select n from generate_series(9100, 9999) n
                                 where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                                 order by random() limit 5`, [anio])).map((f) => String(f.n))
const ots = {}
async function cargarOt(clave, cotizacion, numero, codigo) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const ruta = `ot/${id}/orden.pdf`
  const contenido = pdfConTexto([`ORDEN DE TRABAJO N ${numero}-${anio}`, 'Archivo de prueba del banco local de Metal Work.'])
  const destino = join(ARCHIVOS, 'adjuntos-ot', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('adjuntos-ot', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.administracion, contenido.length])
  await como('administracion', `select public.cargar_codigo_y_ot_de_cotizacion($1, $2, $3, $4, 'SEMIRREMOLQUE',
                                  (now() at time zone 'America/Lima')::date + 30, $5, 'orden.pdf', $6)`,
  [cot[cotizacion].id, id, codigo, numero, ruta, contenido.length])
  ots[clave] = { id, numero: `${numero}-${anio}`, codigo }
}
for (const [clave, cotizacion, numero, codigo] of [
  ['a1', 'tres', libres[0], `QA_P8U_${sello}_A1`],
  ['a2', 'tres', libres[1], `QA_P8U_${sello}_A2`],
  ['a3', 'tres', libres[2], `QA_P8U_${sello}_A3`],
  ['c1', 'otra', libres[3], `QA_P8U_${sello}_C1`],
]) await cargarOt(clave, cotizacion, numero, codigo)
const dondeEsta = async (ot) => uno(`select o.cotizacion_pdf_id as cot, coalesce(o.numero_de_unidad, 1) as unidad from public.ordenes_trabajo o where o.id = $1`, [ot.id])
comprobar((await dondeEsta(ots.a2)).unidad === 2 && (await dondeEsta(ots.a3)).unidad === 3,
  `Las OT ${ots.a2.numero} y ${ots.a3.numero} son las unidades 2 y 3 de ${cot.tres.numero}`)

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []

async function entrar(clave, viewport = { width: 1440, height: 900 }) {
  const correo = `${clave}.p8u@banco.test`
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima', deviceScaleFactor: 2,
    ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
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

/**
 * «Editar OT / cambiar cliente» con clic real: elige la cotización del otro
 * comprador, confirma, escribe el motivo y guarda. Devuelve el aviso de error
 * de la ventana, o '' si se cerró con «OT actualizada».
 */
async function pasarConClic(pagina, ot, destino, captura) {
  await pagina.goto(`${BASE}/ordenes/${ot.id}`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Editar OT / cambiar cliente' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 10000 })
  await ventana.locator('#editar-cotizacion').selectOption(destino.id)
  await ventana.locator('input[name="confirmar_cambio"]').check()
  await ventana.locator('#editar-motivo').fill('El cliente cedió la unidad a otro comprador (banco)')
  await ventana.getByRole('button', { name: 'Guardar con historial' }).click()
  const listo = pagina.getByText('OT actualizada. El cambio quedó en su historial.')
  const error = ventana.locator('[role="alert"]')
  await Promise.race([listo.waitFor({ timeout: 20000 }), error.waitFor({ timeout: 20000 })]).catch(() => {})
  const texto = limpio(await error.textContent({ timeout: 500 }).catch(() => ''))
  if (captura) await pagina.screenshot({ path: join(CAPTURAS, captura) })
  return texto
}

/** La tarjeta de la cotización en Cotización, buscada por su número. */
async function laTarjeta(pagina, c) {
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(c.numero)}`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${c.id}"]`)
  await t.waitFor({ timeout: 15000 }).catch(() => {})
  return t
}
const filasDeUnidad = (t) => t.locator('ul[aria-label^="OT de las"] > li').evaluateAll((l) => l.map((e) => e.textContent.replace(/\s+/g, ' ').trim()))

// ------------------------------------------- 3. La unidad 2, a una de 1 unidad (monitor)
{
  const { pagina, contexto } = await entrar('administracion')
  const e1 = await pasarConClic(pagina, ots.a2, cot.una, 'unidad-libre-1440-1-la-unidad-2-pasa.png')
  const d1 = await dondeEsta(ots.a2)
  const dejo = await uno(`select numero_de_unidad from public.ot_ventas_anteriores where orden_id = $1 and cotizacion_pdf_id = $2`, [ots.a2.id, cot.tres.id])
  const desc = (await uno(`select descripcion from public.ordenes_trabajo where id = $1`, [ots.a2.id])).descripcion
  comprobar(desc.endsWith(`cotización ${cot.una.numero}`), `1440: la descripción de la OT dice su cotización nueva, sin «unidad 2 de 3» («${desc}»)`)
  comprobar(e1 === '' && d1.cot === cot.una.id && d1.unidad === 1 && dejo?.numero_de_unidad === 2,
    `1440: Administración pasa la OT ${ots.a2.numero} (unidad 2 de 3) a ${cot.una.numero}, de 1 unidad; allí es la unidad 1 y la venta anterior guarda la 2${e1 ? ` (dijo: ${e1})` : ''}`)

  // Una cotización que ya tiene su OT no recibe otra, y la ventana dice por qué.
  const e2 = await pasarConClic(pagina, ots.a1, cot.una, 'unidad-libre-1440-2-la-cotizacion-llena.png')
  const d2 = await dondeEsta(ots.a1)
  comprobar(e2.includes(`ya tiene su OT ${ots.a2.numero}`) && d2.cot === cot.tres.id && d2.unidad === 1,
    `1440: a la de 1 unidad que ya tiene su OT no entra otra, y la ventana lo dice («${e2}»)`)
  await contexto.close()
}

// ------------------------- 4. La unidad 3, a una de 3 que ya tiene una OT (teléfono)
{
  const { pagina, contexto } = await entrar('administracion', { width: 390, height: 844 })
  const e = await pasarConClic(pagina, ots.a3, cot.otra, 'unidad-libre-390-1-la-unidad-3-pasa.png')
  const d = await dondeEsta(ots.a3)
  comprobar(e === '' && d.cot === cot.otra.id && d.unidad === 2,
    `390: Administración pasa la OT ${ots.a3.numero} (unidad 3) a ${cot.otra.numero}, que ya tenía una OT; allí es la unidad 2${e ? ` (dijo: ${e})` : ''}`)
  const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(desliza <= 390, `390: la OT no se desliza de costado (${desliza} px)`)
  await contexto.close()
}

// ----------------------------------------- 5. Las tarjetas, como las ve cada puesto
for (const [quien, ancho, alto] of [['administracion', 1440, 900], ['administracion', 390, 844], ['ventas', 1440, 900]]) {
  const { pagina, contexto } = await entrar(quien, { width: ancho, height: alto })
  const tres = await laTarjeta(pagina, cot.tres)
  const fTres = await filasDeUnidad(tres)
  comprobar(fTres.length === 3 && fTres[0].startsWith('Unidad 1') && fTres[0].includes(ots.a1.codigo)
    && fTres[1].startsWith('Unidad 2') && fTres[1].includes(`OT ${ots.a2.numero}`) && fTres[1].includes('Pasó a otro comprador')
    && fTres[2].startsWith('Unidad 3') && fTres[2].includes(`OT ${ots.a3.numero}`) && fTres[2].includes('Pasó a otro comprador'),
  `${quien} ${ancho}: ${cot.tres.numero} dice que pasaron la unidad 2 y la 3, cada una con su OT (${fTres.join(' | ')})`)
  comprobar((await tres.getByRole('button', { name: /Cargar la OT|Dar código y cargar la OT/ }).count()) === 0,
    `${quien} ${ancho}: y no ofrece cargar otra OT`)
  await tres.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `unidad-libre-${quien}-${ancho}-2-la-de-origen.png`) })

  const otra = await laTarjeta(pagina, cot.otra)
  const fOtra = await filasDeUnidad(otra)
  comprobar(fOtra.length === 2 && fOtra[0].startsWith('Unidad 1') && fOtra[0].includes(ots.c1.codigo)
    && fOtra[1].startsWith('Unidad 2') && fOtra[1].includes(ots.a3.codigo),
  `${quien} ${ancho}: ${cot.otra.numero} lleva su OT en la unidad 1 y la que llegó en la 2 (${fOtra.join(' | ')})`)
  if (quien === 'administracion') {
    comprobar((await otra.getByRole('button', { name: 'Cargar la OT 3 de 3' }).count()) === 1,
      `${quien} ${ancho}: y ofrece cargar la que falta, la 3`)
  }
  await otra.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `unidad-libre-${quien}-${ancho}-3-la-de-destino.png`) })
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: la tarjeta no se desliza de costado (${desliza} px)`)
  }
  await contexto.close()
}

// ----------------------------------------- 6. Contabilidad, en Facturación
for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto } = await entrar('contabilidad', { width: ancho, height: alto })
  await pagina.goto(`${BASE}/contabilidad/facturacion#${cot.otra.id}`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`li[id="${cot.otra.id}"]`)
  await tarjeta.waitFor({ timeout: 15000 }).catch(() => {})
  const u2 = limpio(await tarjeta.locator('li[data-unidad="2"]').textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(u2.includes(`código ${ots.a3.codigo}`) && u2.includes(`OT ${ots.a3.numero}`),
    `contabilidad ${ancho}: en ${cot.otra.numero}, la unidad 2 se factura con el código y la OT que llegaron («${u2}»)`)
  await tarjeta.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `unidad-libre-contabilidad-${ancho}-4-facturacion-del-destino.png`) })
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: Facturación no se desliza de costado (${desliza} px)`)
  }
  await contexto.close()
}

// 7. La OT que falta en la de destino es la unidad 3, no la 2 que llegó.
await cargarOt('c3', 'otra', libres[4], `QA_P8U_${sello}_C3`)
comprobar((await dondeEsta(ots.c3)).unidad === 3, `La OT que Administración carga después en ${cot.otra.numero} es la unidad 3`)

await navegador.close()
await base.end()

if (errores.length) {
  console.log('\nErrores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)

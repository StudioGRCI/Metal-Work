/**
 * Recorre con clic real la ventana «Corregir la cotización» de Ventas después
 * de la migración 20261127160000 (fallas antiguas que encontraron los
 * auditores del PR 289): la cotización que ya tiene su OT, o cuya OT pasó a
 * otro comprador, no cambia de cliente, y su cantidad no baja de las unidades
 * que ya ocupó. Con la cuenta de Ventas, nunca ADMIN.
 *
 *   1. Ventas sube tres cotizaciones (una de 3 unidades, una de 1 y otra de 1
 *      sin OT) y Gerencia las aprueba.
 *   2. Administración carga las tres OT de la primera, pasa la de la unidad 3
 *      a la de 1 unidad con «Editar OT» y Gerencia anula la de la unidad 2.
 *   3. Ventas abre «Editar cotización» en la de 3: el cliente está fijo y dice
 *      por qué, y la cantidad no baja de 3 (una OT, una unidad que pasó y la
 *      mayor es la 3). Corrige con el mismo cliente y 3 unidades: entra.
 *   4. En la de 1 unidad que recibió la OT, el cliente también está fijo.
 *   5. En la que no tiene OT, el cliente se cambia y la corrección entra.
 *   6. Por la API, con la sesión de Ventas: otro cliente o 2 unidades en la de
 *      3, rechazado; y con la de Administración y Gerencia, el cliente de la
 *      OT por UPDATE directo, rechazado.
 *
 * Capturas en teléfono (390) y monitor (1440). Arma sus datos ficticios
 * (QA-CNF-…) y las cuentas `*.cnf@banco.test` con la clave local. Variables:
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
async function esperar(fn, ms) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await fn().catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

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
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.cnf@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, null) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco cliente fijo', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
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
/** Lo mismo, y devuelve el mensaje del rechazo, o '' si entró. */
async function rechazo(quien, sql, valores = []) {
  try {
    await como(quien, sql, valores)
    return ''
  } catch (e) {
    return e.message
  }
}

async function rucLibre() {
  return (await uno(`select n::text as ruc from generate_series(20990050000::bigint, 20990050999::bigint) n
                      where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text)
                      limit 1`)).ruc
}
const clientes = {}
for (const [clave, nombre] of [
  ['a', `QA PRIMER COMPRADOR CNF ${sello} S.A.C.`],
  ['b', `QA SEGUNDO COMPRADOR CNF ${sello} S.A.C.`],
  ['c', `QA TERCER COMPRADOR CNF ${sello} S.A.C.`],
]) {
  clientes[clave] = { nombre, id: (await uno(
    `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
    [await rucLibre(), nombre],
  )).id }
}
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

// 1. Ventas sube tres cotizaciones; Gerencia las aprueba.
const cot = {}
for (const [clave, cliente, unidades] of [['tres', 'a', 3], ['una', 'b', 1], ['libre', 'c', 1]]) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const numero = `QA-CNF-${sello}-${clave.toUpperCase()}`
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

// 2. Administración carga las tres OT de la primera; la 3 pasa a la de 1 unidad; Gerencia anula la 2.
const libres = (await consulta(`select n from generate_series(9100, 9999) n
                                 where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                                 order by random() limit 3`, [anio])).map((f) => String(f.n))
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
for (const [clave, numero] of [['a1', libres[0]], ['a2', libres[1]], ['a3', libres[2]]]) {
  await cargarOt(clave, 'tres', numero, `QA_CNF_${sello}_${clave.toUpperCase()}`)
}
await como('administracion', `select public.editar_ot_con_historial(o.id, o.actualizado_en, jsonb_build_object(
    'descripcion', o.descripcion, 'prioridad', o.prioridad, 'fecha_entrega_comprometida', o.fecha_entrega_comprometida::text,
    'codigo_interno', u.codigo_interno, 'marca', coalesce(u.marca, ''), 'modelo', coalesce(u.modelo, ''),
    'unidad_version', u.actualizado_en, 'cotizacion_nueva_id', $2::text),
    'El cliente cedió la unidad a otro comprador (banco)')
  from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.id = $1`, [ots.a3.id, cot.una.id])
await como('gerencia', `update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El cliente desistió de una unidad (banco)' where id = $1`, [ots.a2.id])
const enUna = await uno('select cotizacion_pdf_id as c, cliente_id from public.ordenes_trabajo where id = $1', [ots.a3.id])
comprobar(enUna.c === cot.una.id && enUna.cliente_id === clientes.b.id,
  `«Editar OT» sigue pasando la OT ${ots.a3.numero} a ${cot.una.numero}, con su cliente`)

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []

async function entrar(clave, viewport) {
  const correo = `${clave}.cnf@banco.test`
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

/** Abre «Editar cotización» en la tarjeta de la cotización y devuelve la ventana. */
async function abrirCorreccion(pagina, c) {
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(c.numero)}`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`li[id="${c.id}"]`)
  await tarjeta.waitFor({ timeout: 15000 })
  await tarjeta.getByRole('button', { name: /Editar cotización|Subir corrección/ }).click()
  const ventana = pagina.getByRole('dialog').first()
  await ventana.waitFor({ timeout: 20000 })
  return ventana
}
const ayudaDe = async (ventana, selector) =>
  limpio(await ventana.locator(selector).locator('xpath=ancestor::div[contains(@class,"space-y-1.5")][1]').innerText().catch(() => ''))

/** Llena lo que pide la corrección y guarda. Devuelve '' si la ventana se cerró, o su aviso. */
async function guardarCorreccion(pagina, ventana, c, motivo) {
  await ventana.locator(`#corregir-motivo-${c.id}`).fill(motivo)
  await ventana.locator(`#corregir-archivo-${c.id}`).setInputFiles({ name: `${c.numero}-v2.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${c.numero}`, 'Version 2']) })
  const boton = ventana.getByRole('button', { name: 'Guardar versión y enviar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await esperar(async () => !/Leyendo/.test(await ventana.innerText()) && !(await boton.isDisabled()), 30000)
  await ventana.locator('#corregir-monto').fill('45000')
  await ventana.locator('#corregir-moneda').selectOption('USD')
  await ventana.locator('#corregir-igv').selectOption('no')
  await boton.click()
  const cerro = await esperar(async () => (await pagina.getByRole('dialog').count()) === 0, 40000)
  return cerro ? '' : limpio((await ventana.locator('[role=alert]').allInnerTexts().catch(() => [])).join(' '))
}

for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto } = await entrar('ventas', { width: ancho, height: alto })

  // 3. La de 3 unidades: una OT, una que pasó, la 2 anulada.
  let v = await abrirCorreccion(pagina, cot.tres)
  const fijo = limpio(await v.locator('[data-cliente-fijo]').innerText().catch(() => ''))
  comprobar((await v.locator(`#corregir-cliente-${cot.tres.id}`).count()) === 0 && fijo.includes(clientes.a.nombre),
    `${ancho}: en ${cot.tres.numero} el cliente está fijo, con su razón social entera y sin lista que elegir`)
  comprobar(fijo.includes('Ya tiene su OT: el cliente no cambia'), `${ancho}: y dice por qué, a la vista («${fijo}»)`)
  const caja = await v.locator('[data-cliente-fijo] p').nth(1).evaluate((e) => e.scrollWidth <= e.clientWidth + 1)
  comprobar(caja, `${ancho}: la razón social no se corta`)
  const descripcion = limpio(await pagina.locator(`[id="${((await v.getAttribute('aria-describedby')) ?? '').split(' ')[0]}"]`).innerText().catch(() => ''))
  comprobar(descripcion.includes('El cliente no cambia.'), `${ancho}: la descripción de la ventana, que oye el lector, también lo dice`)
  const minimo = await v.locator('#corregir-unidades').getAttribute('min')
  const ayudaUnidades = await ayudaDe(v, '#corregir-unidades')
  comprobar(minimo === '3', `${ancho}: la cantidad no baja de 3 (min=${minimo})`)
  comprobar(ayudaUnidades.includes('Ya tiene una OT y una unidad que pasó a otro comprador, y la mayor es la unidad 3: no baja de 3.'),
    `${ancho}: y la ayuda lo dice («${ayudaUnidades}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, `cliente-fijo-ventas-${ancho}-1-con-ot.png`) })
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: la ventana no se desliza de costado (${desliza} px)`)
  }
  // Corrige con el mismo cliente y 3 unidades: entra.
  const version = (await uno('select version from public.cotizaciones_pdf where id = $1', [cot.tres.id])).version
  const e1 = await guardarCorreccion(pagina, v, cot.tres, `Se corrigió el PDF en el banco (${ancho})`)
  const tras = await uno('select version, cliente_id, cantidad_unidades from public.cotizaciones_pdf where id = $1', [cot.tres.id])
  comprobar(e1 === '' && tras.version === version + 1 && tras.cliente_id === clientes.a.id && tras.cantidad_unidades === 3,
    `${ancho}: la corrección con el mismo cliente y 3 unidades entra (versión ${tras.version}${e1 ? `, dijo: ${e1}` : ''})`)
  await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cot.tres.id])

  // 4. La de 1 unidad que recibió la OT.
  v = await abrirCorreccion(pagina, cot.una)
  comprobar((await v.locator(`#corregir-cliente-${cot.una.id}`).count()) === 0 && limpio(await v.locator('[data-cliente-fijo]').innerText()).includes(clientes.b.nombre),
    `${ancho}: en ${cot.una.numero}, que recibió la OT, el cliente también está fijo`)
  await pagina.keyboard.press('Escape')
  await esperar(async () => (await pagina.getByRole('dialog').count()) === 0, 5000)

  // 5. La que no tiene OT: el cliente se cambia y entra.
  v = await abrirCorreccion(pagina, cot.libre)
  const libre = v.locator(`#corregir-cliente-${cot.libre.id}`)
  const ayudaLibre = await ayudaDe(v, `#corregir-cliente-${cot.libre.id}`)
  comprobar(!(await libre.isDisabled()) && !ayudaLibre.includes('no cambia') && (await v.locator('[data-cliente-fijo]').count()) === 0,
    `${ancho}: en ${cot.libre.numero}, sin OT, el cliente se puede cambiar`)
  const otro = ancho === 1440 ? clientes.a : clientes.c
  await libre.selectOption(otro.id)
  await pagina.screenshot({ path: join(CAPTURAS, `cliente-fijo-ventas-${ancho}-2-sin-ot.png`) })
  const e2 = await guardarCorreccion(pagina, v, cot.libre, `El cliente es otro (banco ${ancho})`)
  const trasLibre = await uno('select cliente_id from public.cotizaciones_pdf where id = $1', [cot.libre.id])
  comprobar(e2 === '' && trasLibre.cliente_id === otro.id, `${ancho}: y la corrección con otro cliente entra${e2 ? ` (dijo: ${e2})` : ''}`)
  await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cot.libre.id])
  await contexto.close()
}

// 6. Por la API, saltándose la pantalla.
const rutaNueva = () => `cot/${cot.tres.id}/v${Date.now()}.pdf`
const r1 = await rechazo('ventas', `update public.cotizaciones_pdf set cliente_id = $2, ruta_storage = $3, nombre_archivo = 'v.pdf',
                                      motivo_correccion = 'Por la API (banco)', estado = 'POR_REVISAR' where id = $1`, [cot.tres.id, clientes.c.id, rutaNueva()])
comprobar(r1.includes('ya tiene su OT: una corrección no le cambia el cliente'), `API: Ventas no le cambia el cliente a ${cot.tres.numero} («${r1}»)`)
const r2 = await rechazo('ventas', `update public.cotizaciones_pdf set cantidad_unidades = 2, ruta_storage = $2, nombre_archivo = 'v.pdf',
                                      motivo_correccion = 'Por la API (banco)', estado = 'POR_REVISAR' where id = $1`, [cot.tres.id, rutaNueva()])
comprobar(r2.includes('La unidad 3 de la cotización') && r2.includes('pasó a otro comprador'), `API: ni la baja a 2 unidades («${r2}»)`)
for (const quien of ['administracion', 'gerencia']) {
  const r = await rechazo(quien, 'update public.ordenes_trabajo set cliente_id = $2 where id = $1', [ots.a1.id, clientes.c.id])
  comprobar(r.includes('cambia solo con «Editar OT / cambiar cliente»'), `API: ${quien} no le cambia el cliente a la OT ${ots.a1.numero} («${r}»)`)
}
const sigue = await uno('select cliente_id from public.ordenes_trabajo where id = $1', [ots.a1.id])
comprobar(sigue.cliente_id === clientes.a.id, `La OT ${ots.a1.numero} sigue siendo del primer comprador`)

await navegador.close()
await base.end()

if (errores.length) {
  console.log('\nErrores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)

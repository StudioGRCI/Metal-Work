/**
 * Recorre con clic real «una cotización de varias unidades, una OT por unidad»
 * (migración 20261126700000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Ventas sube una cotización de tres camabajas: el PDF dice «CANTIDAD : 03»
 *      y «Unidades» se llena con 3 (con otra cifra avisa en ámbar). La
 *      tarjeta dice «3 unidades» y el precio por unidad.
 *   2. Gerencia la aprueba con un toque, como siempre.
 *   3. Administración ve «Cargar la OT 1 de 3» y carga las tres OT, cada una con
 *      su código interno y su PDF: la ventana dice qué unidad es, un código que
 *      ya es de otra unidad de la misma cotización se rechaza en su campo (sin
 *      dejar el PDF suelto), y al terminar la tercera ya no hay botón.
 *   4. Diseño recibe el aviso de cada código y entra al de la unidad 2.
 *   5. Ventas ve las tres OT en su tarjeta, y sus avisos dicen cuántas faltan.
 *   6. La cotización de una unidad sigue igual: «Dar código y cargar la OT».
 *
 * En monitor (1440) y, con capturas, en teléfono (390). Arma sus propios datos
 * ficticios (QA-UNI-…) y las cuentas `*.uni@banco.test` con la clave local.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
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

/** Un PDF de una página con estas líneas de texto, para que los lectores lo lean. */
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
  diseno: ['DISENO', 'DIS'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.uni@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, null) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco unidades', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
      [fila.id, rol, correo, area],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
  ids[clave] = fila.id
}
await consulta(`insert into public.empresa (ruc, razon_social) select '20100000390', 'PRUEBAS COTIZACION S.A.C.' where not exists (select 1 from public.empresa)`)

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

// El cliente, registrado: la cotización lo trae por su RUC.
const ruc = (await uno(`select n::text as ruc from generate_series(20990040000::bigint, 20990049999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text) limit 1`)).ruc
const cliente = `QA TRANSPORTES UNIDADES ${sello}`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
  [ruc, cliente],
)).id

// El número de la cotización de tres, libre en la serie de prueba.
const nCot = (await uno(`select n from generate_series(9000, 9999) n
                          where not exists (select 1 from public.cotizaciones_pdf c where c.numero = n || '-' || $1)
                          order by random() limit 1`, [anio])).n
const numeroTres = `${nCot}-${anio}`
const PDF_COT = join(CAPTURAS, `COT-${numeroTres}-TRES-CAMABAJAS.pdf`)
writeFileSync(PDF_COT, pdfConTexto([
  `COTIZACION N° ${nCot}- ${anio}`,
  `Fecha : 26/11/${anio}`,
  `Señores : ${cliente}`,
  `RUC : ${ruc}`,
  'SEMIRREMOLQUE CAMA BAJA 3 EJES - SUSPENSION MECANICA',
  'CANTIDAD : 03 UNIDADES',
  'TOTAL US$ 135,000.00',
  'PRECIO NO INCLUYE IGV',
]))

// La de una unidad, para ver que sigue igual. Se siembra ya aprobada.
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id
const cotUna = { id: (await uno('select gen_random_uuid() as id')).id, numero: `QA-UNI-${sello}-1` }
{
  const ruta = `cot/${cotUna.id}/${cotUna.id}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${cotUna.numero}`, `CLIENTE: ${cliente}`, 'Furgon de prueba'])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 45000, 'USD')`,
  [cotUna.id, cotUna.numero, clienteId, carroceria, `Cotización ${cotUna.numero}.pdf`, ruta, contenido.length, ids.ventas])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.ventas, contenido.length])
  await como('ventas', `select public.confirmar_igv_cotizacion($1, false)`, [cotUna.id]).catch(() => {})
  await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cotUna.id])
}

// Tres números de OT libres y los tres PDF que los traen.
const libres = (await consulta(`select n from generate_series(9100, 9999) n
                                 where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                                 order by random() limit 3`, [anio])).map((f) => String(f.n))
const pdfOrden = (numero, dia) => {
  const ruta = join(CAPTURAS, `OT-${numero}.pdf`)
  writeFileSync(ruta, pdfConTexto([
    `ORDEN DE TRABAJO N ${numero}-${anio}`,
    `CLIENTE: ${cliente}`,
    'PRODUCTO: SEMIRREMOLQUE CAMA BAJA 3 EJES',
    `FECHA DE ENTREGA DE LA UNIDAD: ${dia} de diciembre de ${anio}`,
    'Esta orden de trabajo es un archivo de prueba del banco local de Metal Work.',
  ]))
  return ruta
}
const UNIDADES = libres.map((n, i) => ({ n, pdf: pdfOrden(n, 10 + i * 5), codigo: `QA_CB_${sello}/${i + 1}` }))

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []
const MONITOR = { width: 1440, height: 900 }
const TELEFONO = { width: 390, height: 844 }

async function entrar(clave, viewport = MONITOR) {
  const correo = `${clave}.uni@banco.test`
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima', acceptDownloads: true })
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

async function esperar(cond, ms = 30000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (await cond()) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
const desborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const huerfanosOt = () => consulta(`select name from storage.objects o where bucket_id = 'adjuntos-ot'
                                     and not exists (select 1 from public.ot_adjuntos a where a.ruta_storage = o.name)`)
const botones = async (tarjeta) => (await tarjeta.getByRole('button').allTextContents()).map(limpio)
const otsDe = (id) => consulta(`select o.id, o.numero, o.descripcion, u.codigo_interno from public.ordenes_trabajo o
                                  join public.unidades u on u.id = o.unidad_id
                                 where o.cotizacion_pdf_id = $1 and o.estado <> 'ANULADA' order by o.creado_en`, [id])

// ------------------------------------------------------------------ 1. Ventas
let cotTres
{
  const { pagina, contexto } = await entrar('ventas')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Subir cotización' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  comprobar((await v.locator('#cot-unidades').inputValue()) === '1', 'la ventana abre con «Unidades: 1», como siempre')
  await v.locator('#cot-archivo').setInputFiles(PDF_COT)
  await esperar(async () => (await v.locator('#cot-numero').inputValue()) === numeroTres, 30000)
  comprobar((await v.locator('#cot-numero').inputValue()) === numeroTres, `el número sale del PDF (${numeroTres})`)
  comprobar((await v.locator('#cot-cliente').inputValue()) === clienteId, 'y el cliente, por su RUC')
  await esperar(async () => (await v.locator('#cot-unidades').inputValue()) === '3', 10000)
  comprobar((await v.locator('#cot-unidades').inputValue()) === '3', '«Unidades» se llena con la cantidad que dice el PDF (03)')
  comprobar(limpio(await v.locator('[role="status"]').filter({ hasText: 'Leído del archivo' }).innerText()).includes('Cantidad 3 unidades'),
    'y «Leído del archivo» la muestra')
  // Si queda otra, se avisa en ámbar junto al campo; al volver a 3, el aviso se va.
  await v.locator('#cot-unidades').fill('2')
  comprobar(limpio(await v.innerText()).includes('El documento dice 3 unidades: revisa.'), 'con otra cantidad avisa lo que dice el documento')
  await v.locator('#cot-unidades').fill('3')
  comprobar(!limpio(await v.innerText()).includes('El documento dice 3 unidades'), 'y con la del documento, el aviso se va')
  if (!(await v.locator('#cot-carroceria').inputValue())) await v.locator('#cot-carroceria').selectOption({ index: 1 })
  if (!(await v.locator('#cot-moneda').inputValue())) await v.locator('#cot-moneda').selectOption('USD')
  if (!(await v.locator('#cot-igv').inputValue())) await v.locator('#cot-igv').selectOption('no')
  if (!(await v.locator('#cot-monto').inputValue())) await v.locator('#cot-monto').fill('135000.00')
  const ayuda = limpio(await v.locator('#cot-unidades').locator('xpath=ancestor::div[1]/..').innerText())
  comprobar(ayuda.includes('Leídas del documento'), `el campo dice que la cantidad salió del documento («${ayuda}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'unidades-1-ventas-sube-1440.png') })
  await v.getByRole('button', { name: 'Subir y mandar a Gerencia' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  comprobar(!(await v.isVisible()), 'la cotización se sube y la ventana se cierra')
  cotTres = await uno(`select id, numero, cantidad_unidades, monto_venta::text as monto, moneda from public.cotizaciones_pdf where numero = $1`, [numeroTres])
  comprobar(cotTres?.cantidad_unidades === 3 && cotTres.monto === '135000.00', `la base la guarda con 3 unidades y US$ 135 000 (${JSON.stringify(cotTres)})`)
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${cotTres?.id}"]`)
  const texto = limpio(await t.textContent())
  comprobar(texto.includes('· 3 unidades') && texto.includes('US$ 45,000.00 en promedio por unidad'), `la tarjeta dice «3 unidades» y el precio de cada una («${texto.slice(0, 200)}»)`)
  await contexto.close()
}
if (!cotTres) {
  console.log('\nNo se subió la cotización: no sigue.')
  process.exit(1)
}

// ---------------------------------------------------------------- 2. Gerencia
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=POR_REVISAR`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${cotTres.id}"]`)
  const ofrece = await botones(t)
  comprobar(ofrece.includes('Aprobar') && !ofrece.some((b) => /Cargar la OT|Dar código/.test(b)), `Gerencia ve «Aprobar», sin cargar OT (${ofrece.join(' · ')})`)
  await t.getByRole('button', { name: 'Aprobar', exact: true }).click()
  await esperar(async () => (await uno('select estado from public.cotizaciones_pdf where id = $1', [cotTres.id])).estado === 'APROBADA')
  await t.getByText(/Falta que Administración/).waitFor({ timeout: 30000 }).catch(() => {})
  const texto = limpio(await t.textContent())
  comprobar(texto.includes('Falta que Administración le dé a cada una de las 3 unidades su código interno y suba su OT.'),
    'aprobada, la tarjeta dice que faltan las tres OT')
  await contexto.close()
}

// ------------------------------------------------------------ 3. Administración
{
  const aviso = await uno(`select ruta from public.notificaciones where usuario_id = $1 and origen_id = $2 order by creado_en desc limit 1`,
    [ids.administracion, cotTres.id])
  const { pagina, contexto } = await entrar('administracion')
  await pagina.goto(`${BASE}${aviso?.ruta ?? '/cotizaciones/pdf?estado=APROBADA_SIN_OT'}`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${cotTres.id}"]`)
  const v = pagina.getByRole('dialog')

  for (const [i, u] of UNIDADES.entries()) {
    const cual = i + 1
    if (i > 0) await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`, { waitUntil: 'networkidle' })
    const boton = t.getByRole('button', { name: `Cargar la OT ${cual} de 3` })
    comprobar((await boton.count()) === 1, `la tarjeta ofrece «Cargar la OT ${cual} de 3» (${(await botones(t)).join(' · ')})`)
    if (cual === 2) {
      await pagina.setViewportSize(TELEFONO)
      await t.scrollIntoViewIfNeeded()
      comprobar((await desborde(pagina)) <= 0, 'en el teléfono la tarjeta con su OT cargada no se desborda')
      await t.screenshot({ path: join(CAPTURAS, 'unidades-3-administracion-tarjeta-390.png') })
    }
    await boton.click()
    await v.waitFor()
    const titulo = limpio(await v.locator('h2').first().textContent())
    comprobar(titulo === `Unidad ${cual} de 3 de la ${numeroTres}`, `la ventana dice qué unidad es («${titulo}»)`)
    if (cual > 1) {
      const otras = limpio(await v.getByText('Ya tienen código:').innerText().catch(() => ''))
      comprobar(UNIDADES.slice(0, i).every((x, k) => otras.includes(`unidad ${k + 1} ${x.codigo}`)),
        `la ventana muestra los códigos que ya tienen las otras unidades («${otras}»)`)
    }
    if (cual === 2) {
      // El código de la unidad 1, otra vez: se rechaza en su campo.
      await v.locator('input[name="codigo_interno"]').fill(UNIDADES[0].codigo.toLowerCase())
      await v.locator('input[type="file"]').setInputFiles(u.pdf)
      await v.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
      await v.getByRole('button', { name: 'Guardar código y OT' }).click()
      await v.getByText(/cada unidad lleva su propio código/).waitFor({ timeout: 30000 }).catch(() => {})
      const campo = v.locator('input[name="codigo_interno"]')
      const dice = limpio(await campo.locator('xpath=ancestor::div[1]/..').innerText())
      comprobar(dice.includes(`ya es de la OT ${UNIDADES[0].n}-${anio} de esta cotización: cada unidad lleva su propio código`)
        && (await campo.getAttribute('aria-invalid')) === 'true',
      `un código que ya es de la unidad 1 se rechaza en su campo («${dice}»)`)
      await esperar(async () => (await huerfanosOt()).length === 0, 10000)
      comprobar((await huerfanosOt()).length === 0, 'y el PDF de ese intento no quedó suelto')
      comprobar((await otsDe(cotTres.id)).length === 1, 'y no entró otra OT')
      await pagina.screenshot({ path: join(CAPTURAS, 'unidades-4-administracion-codigo-repetido-390.png') })
      await pagina.setViewportSize(MONITOR)
    } else {
      await v.locator('input[type="file"]').setInputFiles(u.pdf)
      await v.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
    }
    await v.locator('input[name="codigo_interno"]').fill(u.codigo)
    comprobar((await v.locator('input[name="numero"]').inputValue()) === `${u.n}-${anio}`, `el número de la OT ${cual} sale de su PDF`)
    if (!(await v.locator('select[name="tipo_unidad"]').inputValue())) await v.locator('select[name="tipo_unidad"]').selectOption('SEMIRREMOLQUE')
    if (cual === 1) await pagina.screenshot({ path: join(CAPTURAS, 'unidades-2-administracion-ot-1-1440.png') })
    await v.getByRole('button', { name: 'Guardar código y OT' }).click()
    await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
    const error = limpio(await v.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => ''))
    comprobar(!(await v.isVisible()), `la OT ${cual} entra${error ? ` (dijo: ${error})` : ''}`)
    await esperar(async () => (await otsDe(cotTres.id)).length === cual, 10000)
  }

  const ots = await otsDe(cotTres.id)
  comprobar(ots.length === 3 && ots.map((o) => o.codigo_interno).join(',') === UNIDADES.map((u) => u.codigo).join(','),
    `la base tiene las tres OT, cada una con su código (${ots.map((o) => `${o.numero} ${o.codigo_interno}`).join(' · ')})`)
  comprobar(ots.every((o, i) => o.descripcion.endsWith(`unidad ${i + 1} de 3`)), 'y cada OT dice qué unidad de la cotización es')
  comprobar((await huerfanosOt()).length === 0, 'sin archivos sueltos')

  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(500)
  const texto = limpio(await t.innerText())
  const ofrece = await botones(t)
  comprobar(UNIDADES.every((u, i) => texto.includes(`Unidad ${i + 1} ${u.codigo} · OT ${u.n}-${anio}`)),
    `la tarjeta lista las tres unidades con su código y su OT («${texto.slice(0, 400)}»)`)
  comprobar(!ofrece.some((b) => /Cargar la OT|Dar código/.test(b)) && !texto.includes('Falta'), 'y ya no ofrece cargar otra')
  await t.screenshot({ path: join(CAPTURAS, 'unidades-5-administracion-tres-ot-1440.png') })
  await pagina.setViewportSize(TELEFONO)
  await pagina.waitForTimeout(300)
  comprobar((await desborde(pagina)) <= 0, 'en el teléfono la tarjeta de tres OT no se desborda')
  await t.screenshot({ path: join(CAPTURAS, 'unidades-5-administracion-tres-ot-390.png') })
  await pagina.setViewportSize(MONITOR)

  // Se busca por el código de cualquiera de las tres.
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(UNIDADES[1].codigo)}`, { waitUntil: 'networkidle' })
  const halladas = await pagina.locator('li[id]').evaluateAll((l) => l.map((e) => e.id))
  comprobar(halladas.includes(cotTres.id), `la búsqueda por el código de la unidad 2 la encuentra (${halladas.length} tarjetas)`)

  // La de una unidad, como siempre.
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`, { waitUntil: 'networkidle' })
  const una = pagina.locator(`li[id="${cotUna.id}"]`)
  const ofreceUna = await botones(una)
  comprobar(ofreceUna.includes('Dar código y cargar la OT') && !limpio(await una.textContent()).includes('unidades'),
    `la de una unidad sigue con «Dar código y cargar la OT» (${ofreceUna.join(' · ')})`)
  await una.getByRole('button', { name: 'Dar código y cargar la OT' }).click()
  const tituloUna = limpio(await v.locator('h2').first().textContent())
  comprobar(tituloUna === `Código interno y OT de la ${cotUna.numero}`, `y su ventana, como antes («${tituloUna}»)`)
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await contexto.close()
}

// ------------------------------------------------------------------- 4. Diseño
{
  const avisos = await consulta(`select ruta, cuerpo from public.notificaciones where usuario_id = $1 and cuerpo like 'QA_CB_${sello}/%' order by creado_en`,
    [ids.diseno])
  comprobar(avisos.length === 3, `Diseño recibe un aviso por cada código (${avisos.length})`)
  const { pagina, contexto } = await entrar('diseno')
  const u2 = UNIDADES[1]
  const aviso = avisos.find((a) => a.cuerpo.startsWith(`${u2.codigo}:`))
  await pagina.goto(`${BASE}${aviso?.ruta ?? '/diseno'}`, { waitUntil: 'networkidle' })
  const titulo = limpio(await pagina.locator('h1').first().textContent())
  comprobar(titulo === u2.codigo, `el aviso de la unidad 2 lo lleva a su código («${titulo}»)`)
  const ot = pagina.locator('li', { hasText: `OT ${u2.n}-${anio}` }).first()
  comprobar((await ot.count()) === 1, 'y ahí está su OT, solo la suya')
  comprobar(!limpio(await pagina.locator('main').textContent()).includes(`OT ${UNIDADES[0].n}-${anio}`), 'sin la OT de la unidad 1')
  await pagina.screenshot({ path: join(CAPTURAS, 'unidades-6-diseno-1440.png') })
  await contexto.close()
}

// ------------------------------------------------------------------- 5. Ventas
{
  const avisos = (await consulta(`select cuerpo from public.notificaciones where usuario_id = $1 and origen_id = $2 and titulo = 'Tu cotización ya tiene su código'
                                   order by creado_en`, [ids.ventas, cotTres.id])).map((a) => a.cuerpo)
  comprobar(avisos.length === 3 && avisos[0].endsWith('Faltan 2.') && avisos[1].endsWith('Falta 1.') && avisos[2].endsWith('Ya están todas.'),
    `a Ventas le llega cada código y cuántas faltan (${avisos.join(' | ')})`)
  const { pagina, contexto } = await entrar('ventas', TELEFONO)
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${cotTres.id}"]`)
  const texto = limpio(await t.textContent())
  comprobar(UNIDADES.every((u) => texto.includes(u.codigo) && texto.includes(`OT ${u.n}-${anio}`)), 'Ventas ve en el teléfono las tres OT en su tarjeta')
  comprobar((await desborde(pagina)) <= 0, 'sin desborde')
  await t.screenshot({ path: join(CAPTURAS, 'unidades-7-ventas-390.png') })
  await contexto.close()
}

await navegador.close()
await base.end()

if (errores.length) {
  console.log('\nErrores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)

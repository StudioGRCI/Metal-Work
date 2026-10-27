/**
 * Recorre con clic real «Gerencia aprueba con un toque y Administración le da
 * el código interno y sube la OT» (migraciones 20261027200000 y
 * 20261027201000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Ventas sube dos cotizaciones y no las aprueba.
 *   2. Gerencia las aprueba con un toque: no se abre ninguna ventana, no le
 *      pide código, OT ni PDF, y no tiene cómo cargarlos. La tarjeta dice que
 *      falta Administración. «Descargar» baja la cotización con su nombre.
 *   3. A Administración le llega el aviso y lo cuenta su dashboard; entra por
 *      el aviso y le da código y OT a cada una: el código es obligatorio, sin
 *      el PDF no guarda, el número y la fecha de entrega al cliente salen del
 *      PDF, y un número de OT que ya existe se rechaza sin dejar el PDF suelto.
 *   4. Diseño recibe el aviso, entra por él al código y abre el PDF de la OT.
 *   5. Gerencia ve la cotización con su código y su OT, sin botones.
 *   6. Contabilidad la ve con su código, lista para facturar, y a Ventas le
 *      llegan los dos avisos: aprobada y con su código.
 *
 * Arma sus propios datos ficticios (QA-COT-…) y las cuentas `*.cot@banco.test`
 * con la clave local. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * BANCO_BASE (mw_demo), BANCO_ARCHIVOS (el mismo del servidor del banco),
 * CAPTURAS.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/** Un PDF de una página con estas líneas de texto, para que el lector de la OT lo lea. */
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
  contabilidad: ['CONTABILIDAD', 'CON'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.cot@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, null) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco cotización', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
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

const ruc = (await uno(`select n::text as ruc from generate_series(20990039000::bigint, 20990039999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text) limit 1`)).ruc
const cliente = `QA TRANSPORTES COT ${sello}`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
  [ruc, cliente],
)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

// Dos cotizaciones de Ventas, las dos por revisar. Se suben con su nombre: es
// el que tiene que salir al descargarlas.
const cot = {}
for (const letra of ['A', 'B']) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const numero = `QA-COT-${sello}-${letra}`
  const ruta = `cot/${id}/${id}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${numero}`, `CLIENTE: ${cliente}`, 'Semirremolque plataforma de prueba'])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 59000, 'USD')`,
  [id, numero, clienteId, carroceria, `Cotización ${numero}.pdf`, ruta, contenido.length, ids.ventas])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.ventas, contenido.length])
  cot[letra] = { id, numero }
}

// Dos números de OT libres y los dos PDF que los traen.
const libres = (await consulta(`select n from generate_series(9100, 9999) n
                                 where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                                 order by random() limit 2`, [anio])).map((f) => String(f.n))
const [N1, N2] = libres
const pdfOrden = (numero, dia) => {
  const ruta = join(CAPTURAS, `OT-${numero}.pdf`)
  writeFileSync(ruta, pdfConTexto([
    `ORDEN DE TRABAJO N ${numero}-${anio}`,
    `CLIENTE: ${cliente}`,
    'PRODUCTO: SEMIRREMOLQUE PLATAFORMA 3 EJES',
    `FECHA DE ENTREGA DE LA UNIDAD: ${dia} de noviembre de ${anio}`,
    'Esta orden de trabajo es un archivo de prueba del banco local de Metal Work.',
  ]))
  return ruta
}
const ARCHIVO_N1 = pdfOrden(N1, 20)
const ARCHIVO_N2 = pdfOrden(N2, 28)
const X1 = `QA_SR_${sello}/26`
const X2 = `QA_SR_${sello}/27`

// ------------------------------------------------------------------- navegador
// En UTF-8, como el equipo de la oficina: sin eso Chromium baja «Cotización….pdf» como «download».
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []

async function entrar(clave) {
  const correo = `${clave}.cot@banco.test`
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima', acceptDownloads: true })
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

/** Espera a que la ventana se cierre (salió bien) o muestre su error; devuelve el error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => ''))
}

/** Espera a que el lector del PDF termine de llenar los campos. */
async function esperarLectura(v) {
  await v.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
}

const huerfanosOt = () => consulta(`select name from storage.objects o where bucket_id = 'adjuntos-ot'
                                     and not exists (select 1 from public.ot_adjuntos a where a.ruta_storage = o.name)`)
const botones = async (tarjeta) => (await tarjeta.getByRole('button').allTextContents()).map(limpio)
const ESPERA_ADMINISTRACION = 'Falta que Administración le dé su código interno y suba la OT.'

// ------------------------------------------------------------------ 1. Ventas
{
  const { pagina, contexto } = await entrar('ventas')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const a = pagina.locator(`li[id="${cot.A.id}"]`)
  const textoA = limpio(await a.textContent())
  comprobar(textoA.includes(cot.A.numero) && textoA.includes('Por revisar'), 'Ventas ve su cotización nueva esperando a Gerencia')
  comprobar(!(await botones(a)).some((b) => /^Aprobar|Dar código/.test(b)), 'y no tiene cómo aprobarla ni darle código')
  await contexto.close()
}

// ---------------------------------------------------------------- 2. Gerencia
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const v = pagina.locator('[role="dialog"]')
  const darCodigo = () => pagina.getByRole('button', { name: 'Dar código y cargar la OT' }).count()

  // La B en «Vigentes» y la A en «Por revisar»: en los dos casos la tarjeta
  // aprobada se queda donde estaba, y bajo el dedo no queda el «Aprobar» de otra.
  for (const [letra, ruta] of [['B', '/cotizaciones/pdf'], ['A', '/cotizaciones/pdf?estado=POR_REVISAR']]) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const t = pagina.locator(`li[id="${cot[letra].id}"]`)
    const ofrece = await botones(t)
    comprobar(ofrece.includes('Aprobar') && ofrece.includes('Rechazar') && !ofrece.some((b) => /Dar código/.test(b)),
      `la ${cot[letra].numero} ofrece «Aprobar» y «Rechazar», sin cargar la OT (${ofrece.join(' · ')})`)
    const boton = t.getByRole('button', { name: 'Aprobar', exact: true })
    await boton.scrollIntoViewIfNeeded()
    const caja = await boton.boundingBox()
    const antes = (await t.boundingBox())?.y
    await boton.click()
    // Un toque: no se abre ninguna ventana que pida código, OT ni PDF.
    await pagina.waitForTimeout(300)
    comprobar((await v.count()) === 0 || !(await v.first().isVisible()), `al tocar «Aprobar» en la ${cot[letra].numero} no se abre ninguna ventana`)
    await t.getByText(ESPERA_ADMINISTRACION).waitFor({ timeout: 30000 }).catch(() => {})
    const texto = limpio(await t.textContent())
    comprobar(texto.includes('Aprobada') && texto.includes(ESPERA_ADMINISTRACION), 'la tarjeta queda «Aprobada» y dice que falta Administración')
    const despues = (await t.boundingBox())?.y
    const debajo = await pagina.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim() ?? '',
      { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 })
    comprobar(antes !== undefined && antes === despues && !/^Aprobar/.test(debajo),
      `en ${ruta === '/cotizaciones/pdf' ? '«Vigentes»' : '«Por revisar»'} la tarjeta no se mueve y bajo el dedo no queda otro «Aprobar» (${antes} → ${despues}; debajo: «${debajo}»)`)
  }
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  comprobar((await darCodigo()) === 0, 'Gerencia no tiene «Dar código y cargar la OT» en ninguna tarjeta')

  // «Descargar» baja la cotización con su nombre, no con el del almacenamiento.
  const a = pagina.locator(`li[id="${cot.A.id}"]`)
  const [descarga] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    a.getByRole('link', { name: 'Descargar' }).first().click(),
  ])
  const nombre = descarga?.suggestedFilename() ?? ''
  const contenido = descarga ? readFileSync(await descarga.path()).subarray(0, 5).toString() : ''
  comprobar(nombre === `Cotización ${cot.A.numero}.pdf` && contenido === '%PDF-', `«Descargar» la baja con su nombre («${nombre}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-1-gerencia-aprueba.png'), fullPage: true })

  const [f] = await consulta(
    `select c.estado, c.revisado_por, (select count(*) from public.ordenes_trabajo o where o.cotizacion_pdf_id = c.id)::int as ots
       from public.cotizaciones_pdf c where c.id = $1`, [cot.A.id])
  comprobar(f?.estado === 'APROBADA' && f.revisado_por === ids.gerencia && f.ots === 0, 'la base la guarda aprobada por Gerencia y todavía sin OT')
  await contexto.close()
}

// ------------------------------------------------------------ 3. Administración
const avisoAdministracion = await uno(
  `select titulo, cuerpo, ruta from public.notificaciones where usuario_id = $1 and origen_id = $2 order by creado_en desc limit 1`,
  [ids.administracion, cot.A.id])
comprobar(avisoAdministracion?.titulo === 'Cotización aprobada: falta su código y su OT'
  && avisoAdministracion.ruta === `/cotizaciones/pdf?estado=APROBADA_SIN_OT#${cot.A.id}`,
`a Administración le llega el aviso («${avisoAdministracion?.titulo ?? ''}»)`)
{
  const { pagina, contexto } = await entrar('administracion')
  const tablero = limpio(await pagina.locator('main').textContent())
  comprobar(/Aprobadas sin código/.test(tablero), 'su dashboard cuenta las aprobadas sin código')

  await pagina.goto(`${BASE}${avisoAdministracion?.ruta ?? '/cotizaciones/pdf?estado=APROBADA_SIN_OT'}`, { waitUntil: 'networkidle' })
  const v = pagina.locator('[role="dialog"]')
  const a = pagina.locator(`li[id="${cot.A.id}"]`)
  const ofrece = await botones(a)
  comprobar(ofrece.includes('Dar código y cargar la OT') && !ofrece.some((b) => /^Aprobar|^Rechazar/.test(b)),
    `el aviso la lleva a la cotización, con «Dar código y cargar la OT» y sin aprobar (${ofrece.join(' · ')})`)

  // La B: el número, la fecha y el tipo salen del PDF.
  const b = pagina.locator(`li[id="${cot.B.id}"]`)
  await b.getByRole('button', { name: 'Dar código y cargar la OT' }).click()
  const ventana = limpio(await v.textContent())
  comprobar(ventana.includes(`Código interno y OT de la ${cot.B.numero}`) && ventana.includes('Gerencia ya la aprobó'), 'abre «Código interno y OT»')
  // La ayuda corta se lee bajo el campo, sin tocar la «i».
  const ayudaFecha = v.getByText('El día prometido al cliente para entregarle la unidad, según la OT')
  comprobar(ventana.includes('Fecha de entrega al cliente') && (await ayudaFecha.isVisible()),
    'la fecha dice que es la de entrega al cliente, con su ayuda a la vista')
  await v.locator('input[name="codigo_interno"]').fill(X1)
  await v.locator('input[type="file"]').setInputFiles(ARCHIVO_N1)
  await esperarLectura(v)
  comprobar((await v.locator('input[name="numero"]').inputValue()) === `${N1}-${anio}`, `el número de la OT sale del PDF (${N1}-${anio})`)
  comprobar((await v.locator('input[name="fecha_entrega"]').inputValue()) === `${anio}-11-20`, 'la fecha de entrega sale del PDF')
  comprobar((await v.locator('select[name="tipo_unidad"]').inputValue()) === 'SEMIRREMOLQUE', 'y el tipo, del producto del PDF')
  await v.locator('input[name="marca"]').fill('Volvo')
  await v.locator('input[name="modelo"]').fill('FMX 8x4')
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  const eB = await esperarVentana(pagina)
  comprobar(eB === '', `la ${cot.B.numero} recibe su código y su OT${eB ? ` (dijo: ${eB})` : ''}`)
  // Al guardar lleva a su tarjeta, resaltada, con el código y la OT.
  await pagina.waitForURL((u) => u.hash === `#${cot.B.id}` && u.search === '', { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const textoB = limpio(await b.textContent().catch(() => ''))
  comprobar(textoB.includes(X1) && textoB.includes(`OT ${N1}-${anio}`) && (await b.evaluate((e) => e.matches(':target'))) && (await b.isVisible()),
    'y lleva a su tarjeta, resaltada, con el código y la OT')

  // La A, desde las aprobadas sin código: sin código el navegador no envía; sin PDF tampoco.
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`, { waitUntil: 'networkidle' })
  await a.getByRole('button', { name: 'Dar código y cargar la OT' }).click()
  await v.locator('input[name="numero"]').fill(N2)
  await v.locator('input[name="fecha_entrega"]').fill(`${anio}-11-28`)
  await v.locator('select[name="tipo_unidad"]').selectOption('SEMIRREMOLQUE')
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  const sinCodigo = await v.locator('input[name="codigo_interno"]').evaluate((e) => e.validity.valueMissing)
  comprobar(sinCodigo && (await v.isVisible()), 'sin código interno el navegador no envía')
  await v.locator('input[name="codigo_interno"]').fill(X2)
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  const campoPdf = v.locator('input[type="file"]')
  await pagina.waitForTimeout(300)
  const sinPdf = limpio(await campoPdf.locator('xpath=..').innerText())
  comprobar(sinPdf.includes('Falta el PDF de la OT') && (await campoPdf.getAttribute('aria-invalid')) === 'true'
    && (await campoPdf.evaluate((e) => e === document.activeElement)), `sin el PDF no guarda: su campo dice que falta y el foco queda ahí («${sinPdf}»)`)

  // Con el PDF, pero con el número de una OT que ya existe: se rechaza y el PDF no queda suelto.
  await v.locator('input[type="file"]').setInputFiles(ARCHIVO_N2)
  await esperarLectura(v)
  comprobar((await v.locator('input[name="numero"]').inputValue()) === `${N2}-${anio}`, 'el número se toma del PDF elegido')
  await v.locator('input[name="numero"]').fill(N1)
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  const repetida = await esperarVentana(pagina)
  comprobar(repetida.includes(`Ya hay una OT ${N1}-${anio}`), `un número de OT que ya existe se rechaza («${repetida}»)`)
  comprobar((await huerfanosOt()).length === 0, 'y el PDF de ese intento no quedó suelto en el almacenamiento')

  await v.locator('input[name="numero"]').fill(N2)
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  const eA = await esperarVentana(pagina)
  comprobar(eA === '', `Administración guarda el código y la OT${eA ? ` (dijo: ${eA})` : ''}`)
  await pagina.waitForURL((u) => u.hash === `#${cot.A.id}` && u.search === '', { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  comprobar(await a.evaluate((e) => e.matches(':target')).catch(() => false), 'y también lleva a su tarjeta')

  // Se busca por el código interno.
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(X2)}`, { waitUntil: 'networkidle' })
  const halladas = await pagina.locator('li[id]').evaluateAll((l) => l.map((e) => e.id))
  comprobar(halladas.includes(cot.A.id), `la búsqueda por el código ${X2} la encuentra (${halladas.length} tarjetas)`)

  // Si «Descargar» no puede, vuelve a la lista con el aviso en vez de bajar un archivo de error.
  await pagina.goto(`${BASE}/cotizaciones/pdf/archivo/00000000-0000-4000-8000-000000000000`, { waitUntil: 'networkidle' })
  const alerta = limpio(await pagina.locator('[role="alert"]').first().textContent().catch(() => ''))
  comprobar(new URL(pagina.url()).search === '?descarga=fallo' && alerta.startsWith('No se pudo bajar la cotización'), `una descarga que no puede vuelve con el aviso («${alerta}»)`)

  // En la lista completa, las dos con su código y su OT.
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  for (const [letra, X, N] of [['A', X2, N2], ['B', X1, N1]]) {
    const t = pagina.locator(`li[id="${cot[letra].id}"]`)
    const texto = limpio(await t.textContent())
    comprobar(texto.includes('Aprobada') && texto.includes(X) && texto.includes(`OT ${N}-${anio}`) && !texto.includes('Dar código'),
      `la ${cot[letra].numero} queda «Aprobada» con su código y su OT, sin el botón`)
  }
  const enlace = await pagina.locator(`li[id="${cot.A.id}"]`).getByRole('link', { name: X2 }).getAttribute('href').catch(() => null)
  comprobar(enlace === `/codigos-internos/detalle?codigo=${encodeURIComponent(X2)}`, 'y el código lleva a Códigos internos')
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-2-administracion-carga.png'), fullPage: true })

  const [f] = await consulta(
    `select c.estado, c.revisado_por, o.numero, o.estado as estado_ot, u.codigo_interno, u.cliente_id, a.ruta_storage, a.subido_por
       from public.cotizaciones_pdf c
       join public.ordenes_trabajo o on o.cotizacion_pdf_id = c.id
       join public.unidades u on u.id = o.unidad_id
       left join public.ot_adjuntos a on a.orden_id = o.id and a.tipo = 'ORDEN'
      where c.id = $1`, [cot.A.id])
  comprobar(f?.estado === 'APROBADA' && f.revisado_por === ids.gerencia, 'la cotización sigue aprobada por Gerencia')
  comprobar(f?.numero === `${N2}-${anio}` && f.estado_ot === 'APROBADA' && f.codigo_interno === X2 && f.cliente_id === clienteId,
    `con su OT ${N2}-${anio} aprobada en la unidad ${X2} del cliente`)
  comprobar(Boolean(f?.ruta_storage) && f.subido_por === ids.administracion && (await huerfanosOt()).length === 0,
    'el PDF de la OT lo subió Administración y quedó anotado en la orden, sin archivos sueltos')
  await contexto.close()
}

// ------------------------------------------------------------------- 4. Diseño
{
  const [aviso] = await consulta(`select ruta, cuerpo from public.notificaciones where usuario_id = $1 and cuerpo like $2 order by creado_en desc limit 1`,
    [ids.diseno, `${X2}:%`])
  comprobar(Boolean(aviso) && aviso.cuerpo.includes(`OT ${N2}-${anio}`), 'Diseño recibe el aviso del código nuevo con su OT')
  const { pagina, contexto } = await entrar('diseno')
  await pagina.goto(`${BASE}${aviso?.ruta ?? '/diseno'}`, { waitUntil: 'networkidle' })
  const titulo = limpio(await pagina.locator('h1').first().textContent())
  comprobar(titulo === X2, `el aviso lo lleva al código ${X2} («${titulo}»)`)
  const ot = pagina.locator('li', { hasText: `OT ${N2}-${anio}` }).first()
  const textoOt = limpio(await ot.textContent().catch(() => ''))
  comprobar(textoOt.includes('Aprobada') && textoOt.includes(cliente), 'arriba ve la OT del código, aprobada y con su cliente')
  const pdf = await ot.getByRole('link', { name: 'Abrir el PDF de la OT' }).getAttribute('href').catch(() => null)
  const respuesta = pdf ? await fetch(pdf) : null
  const cabeza = respuesta?.ok ? Buffer.from(await respuesta.arrayBuffer()).subarray(0, 5).toString() : ''
  comprobar(cabeza === '%PDF-', 'y abre el PDF de la OT')
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-3-diseno.png'), fullPage: true })
  await contexto.close()
}

// -------------------------------------------------------- 5. Gerencia, después
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const a = pagina.locator(`li[id="${cot.A.id}"]`)
  const texto = limpio(await a.textContent())
  const ofrece = await botones(a)
  comprobar(texto.includes(X2) && texto.includes(`OT ${N2}-${anio}`) && !texto.includes(ESPERA_ADMINISTRACION),
    'Gerencia ve la cotización con el código y la OT que cargó Administración')
  comprobar(!ofrece.some((t) => /Aprobar|Dar código/.test(t)), `y sin botones para cargarla (${ofrece.join(' · ') || 'sin botones'})`)
  await contexto.close()
}

// -------------------------------------------------------------- 6. Contabilidad
{
  const { pagina, contexto } = await entrar('contabilidad')
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`li[data-cotizacion="${cot.A.numero}"]`)
  const texto = limpio(await tarjeta.textContent().catch(() => ''))
  comprobar(texto.includes(`Código ${X2}`) && texto.includes('Por facturar'), 'Contabilidad ve la cotización por su código, por facturar')
  comprobar((await tarjeta.getByRole('button', { name: 'Registrar factura' }).count()) === 1, 'y ya puede registrar su factura')
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-4-contabilidad.png'), fullPage: true })
  await contexto.close()

  const avisos = await consulta(`select titulo, cuerpo from public.notificaciones where usuario_id = $1 and origen_id = $2 order by creado_en`,
    [ids.ventas, cot.A.id])
  const aprobada = avisos.find((n) => n.cuerpo.includes('Administración le da su código interno y sube su OT'))
  const conCodigo = avisos.find((n) => n.titulo === 'Tu cotización ya tiene su código')
  comprobar(Boolean(aprobada), `a Ventas le llega que está aprobada y que el código lo da Administración («${aprobada?.cuerpo ?? ''}»)`)
  comprobar(Boolean(conCodigo) && conCodigo.cuerpo.includes(`con el código interno ${X2} y la OT ${N2}-${anio}`),
    `y después, que ya tiene su código («${conCodigo?.cuerpo ?? ''}»)`)
}

await navegador.close()
await base.end()

if (errores.length) {
  console.log('\nErrores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)

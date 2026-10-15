/**
 * Recorre con clic real «la cotización se aprueba con su código interno y su
 * OT» (migración 20261016900000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Ventas sube la cotización y no la aprueba; la aprobada de antes que
 *      quedó sin OT le dice que la destraba Gerencia.
 *   2. Gerencia le da código y OT a la aprobada de antes, desde su tarjeta.
 *   3. Gerencia aprueba la nueva en una sola ventana: el código interno es
 *      obligatorio, sin el PDF no envía, el número y la fecha salen del PDF, y
 *      un número de OT que ya existe se rechaza sin dejar el PDF suelto.
 *      Aprobada, la tarjeta muestra el código y la OT.
 *   4. Diseño recibe el aviso, entra por él al código y abre el PDF de la OT.
 *   5. Administración ya no emite la OT: ve el código y ningún botón.
 *   6. Contabilidad ve la cotización con su código, lista para facturar, y
 *      Ventas recibe el aviso con el código.
 *
 * Arma sus propios datos ficticios (QA-COT-…) y las cuentas `*.cot@banco.test`
 * con la clave local; la cuenta ADMIN solo arma la aprobada de antes, como en
 * el check 391, y no entra a la aplicación. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_ARCHIVOS (el mismo del
 * servidor del banco), CAPTURAS.
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
  admin: ['ADMIN', 'ADM'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.cot@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    // La cuenta ADMIN no lleva clave: arma un dato y no entra a la aplicación.
    fila = await uno(
      `insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, $2) returning id`,
      [correo, null],
    )
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco cotización', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
      [fila.id, rol, correo, area],
    )
  }
  if (rol !== 'ADMIN') await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
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

// Dos cotizaciones de Ventas: la nueva espera a Gerencia; la de antes ya está
// aprobada y quedó sin OT (la arma ADMIN, como un dato viejo).
const cot = {}
for (const letra of ['A', 'B']) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const numero = `QA-COT-${sello}-${letra}`
  const ruta = `cot/${id}/${numero}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${numero}`, `CLIENTE: ${cliente}`, 'Semirremolque plataforma de prueba'])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 59000, 'USD')`,
  [id, numero, clienteId, carroceria, `${numero}.pdf`, ruta, contenido.length, ids.ventas])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.ventas, contenido.length])
  cot[letra] = { id, numero }
}
await como('admin', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cot.B.id])

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
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(clave) {
  const correo = `${clave}.cot@banco.test`
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
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

// ------------------------------------------------------------------ 1. Ventas
{
  const { pagina, contexto } = await entrar('ventas')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const a = pagina.locator(`li[id="${cot.A.id}"]`)
  const textoA = limpio(await a.textContent())
  comprobar(textoA.includes(cot.A.numero) && textoA.includes('Por revisar'), 'Ventas ve su cotización nueva esperando a Gerencia')
  comprobar(!(await botones(a)).some((b) => /^Aprobar/.test(b)), 'y no tiene cómo aprobarla')
  const b = limpio(await pagina.locator(`li[id="${cot.B.id}"]`).textContent())
  comprobar(b.includes('Falta que Gerencia le dé su código interno y cargue la OT'), 'la aprobada de antes sin OT le dice que la destraba Gerencia')
  await contexto.close()
}

// -------------------------------------------------------------- 2 y 3. Gerencia
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const v = pagina.locator('[role="dialog"]')

  // 2. La aprobada de antes: código y OT desde su tarjeta.
  const b = pagina.locator(`li[id="${cot.B.id}"]`)
  await b.getByRole('button', { name: 'Dar código y cargar la OT' }).click()
  comprobar(limpio(await v.textContent()).includes(`Código interno y OT de la ${cot.B.numero}`), 'la aprobada de antes abre «Código interno y OT»')
  await v.locator('input[name="codigo_interno"]').fill(X1)
  await v.locator('input[type="file"]').setInputFiles(ARCHIVO_N1)
  await esperarLectura(v)
  comprobar((await v.locator('input[name="numero"]').inputValue()) === `${N1}-${anio}`, `el número de la OT sale del PDF (${N1}-${anio})`)
  comprobar((await v.locator('input[name="fecha_entrega"]').inputValue()) === `${anio}-11-20`, 'la fecha de entrega sale del PDF')
  comprobar((await v.locator('select[name="tipo_unidad"]').inputValue()) === 'SEMIRREMOLQUE', 'y el tipo, del producto del PDF')
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  const eB = await esperarVentana(pagina)
  comprobar(eB === '', `la aprobada de antes recibe su código y su OT${eB ? ` (dijo: ${eB})` : ''}`)
  await b.getByText(X1).waitFor({ timeout: 30000 }).catch(() => {})
  const textoB = limpio(await b.textContent())
  comprobar(textoB.includes(X1) && textoB.includes(`OT ${N1}-${anio}`), 'su tarjeta muestra el código y la OT')

  // 3. La nueva: Aprobar abre la ventana; no hay aprobación suelta.
  const a = pagina.locator(`li[id="${cot.A.id}"]`)
  const ofrece = await botones(a)
  comprobar(ofrece.includes('Aprobar') && ofrece.includes('Rechazar') && !ofrece.includes('Aprobar la corrección'),
    `la nueva ofrece «Aprobar» y «Rechazar», sin aprobación suelta (${ofrece.join(' · ')})`)
  await a.getByRole('button', { name: 'Aprobar', exact: true }).click()
  comprobar(limpio(await v.textContent()).includes(`Aprobar la ${cot.A.numero}`), 'abre «Aprobar» con el código interno y la OT')

  // Sin código el navegador no envía; sin PDF tampoco.
  await v.locator('input[name="numero"]').fill(N2)
  await v.locator('input[name="fecha_entrega"]').fill(`${anio}-11-28`)
  await v.locator('select[name="tipo_unidad"]').selectOption('SEMIRREMOLQUE')
  await v.getByRole('button', { name: 'Aprobar con código y OT' }).click()
  const sinCodigo = await v.locator('input[name="codigo_interno"]').evaluate((e) => e.validity.valueMissing)
  comprobar(sinCodigo && (await v.isVisible()), 'sin código interno el navegador no envía')
  await v.locator('input[name="codigo_interno"]').fill(X2)
  await v.getByRole('button', { name: 'Aprobar con código y OT' }).click()
  const sinPdf = limpio(await v.locator('[role="alert"]').first().textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(sinPdf.includes('Elige el PDF de la orden de trabajo'), `sin el PDF no envía («${sinPdf}»)`)

  // Con el PDF, pero con el número de una OT que ya existe: se rechaza y el PDF no queda suelto.
  await v.locator('input[type="file"]').setInputFiles(ARCHIVO_N2)
  await esperarLectura(v)
  comprobar((await v.locator('input[name="numero"]').inputValue()) === `${N2}-${anio}`, 'el número se toma del PDF elegido')
  await v.locator('input[name="numero"]').fill(N1)
  await v.getByRole('button', { name: 'Aprobar con código y OT' }).click()
  const repetida = await esperarVentana(pagina)
  comprobar(repetida.includes(`Ya hay una OT ${N1}-${anio}`), `un número de OT que ya existe se rechaza («${repetida}»)`)
  comprobar((await huerfanosOt()).length === 0, 'y el PDF de ese intento no quedó suelto en el almacenamiento')
  const [sigue] = await consulta(`select estado from public.cotizaciones_pdf where id = $1`, [cot.A.id])
  comprobar(sigue?.estado === 'POR_REVISAR', 'la cotización sigue por revisar: no se aprueba a medias')

  await v.locator('input[name="numero"]').fill(N2)
  await v.getByRole('button', { name: 'Aprobar con código y OT' }).click()
  const eA = await esperarVentana(pagina)
  comprobar(eA === '', `Gerencia aprueba con el código y la OT${eA ? ` (dijo: ${eA})` : ''}`)
  await a.getByText(X2).waitFor({ timeout: 30000 }).catch(() => {})
  const textoA = limpio(await a.textContent())
  comprobar(textoA.includes('Aprobada') && textoA.includes(X2) && textoA.includes(`OT ${N2}-${anio}`), 'la tarjeta queda «Aprobada» con su código y su OT')
  const enlace = await a.getByRole('link', { name: X2 }).getAttribute('href').catch(() => null)
  comprobar(enlace === `/codigos-internos/detalle?codigo=${encodeURIComponent(X2)}`, 'y el código lleva a Códigos internos')
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-1-gerencia.png'), fullPage: true })

  const [f] = await consulta(
    `select c.estado, c.revisado_por, o.numero, o.estado as estado_ot, u.codigo_interno, u.cliente_id, a.ruta_storage
       from public.cotizaciones_pdf c
       join public.ordenes_trabajo o on o.cotizacion_pdf_id = c.id
       join public.unidades u on u.id = o.unidad_id
       left join public.ot_adjuntos a on a.orden_id = o.id and a.tipo = 'ORDEN'
      where c.id = $1`, [cot.A.id])
  comprobar(f?.estado === 'APROBADA' && f.revisado_por === ids.gerencia, 'la base la guarda aprobada por Gerencia')
  comprobar(f?.numero === `${N2}-${anio}` && f.estado_ot === 'APROBADA' && f.codigo_interno === X2 && f.cliente_id === clienteId,
    `con su OT ${N2}-${anio} aprobada en la unidad ${X2} del cliente`)
  comprobar(Boolean(f?.ruta_storage) && (await huerfanosOt()).length === 0, 'el PDF de la OT quedó anotado en la orden, sin archivos sueltos')
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
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-2-diseno.png'), fullPage: true })
  await contexto.close()
}

// ------------------------------------------------------------ 5. Administración
{
  const { pagina, contexto } = await entrar('administracion')
  await pagina.goto(`${BASE}/cotizaciones/pdf`, { waitUntil: 'networkidle' })
  const a = pagina.locator(`li[id="${cot.A.id}"]`)
  const texto = limpio(await a.textContent())
  const ofrece = await botones(a)
  comprobar(texto.includes(X2) && texto.includes(`OT ${N2}-${anio}`), 'Administración ve la cotización con su código y su OT')
  comprobar(!ofrece.some((t) => /Emitir|Aprobar|Dar código/.test(t)), `y ya no emite la OT ni aprueba (${ofrece.join(' · ') || 'sin botones'})`)
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
  await pagina.screenshot({ path: join(CAPTURAS, 'cotizacion-3-contabilidad.png'), fullPage: true })
  await contexto.close()

  const [aviso] = await consulta(`select cuerpo from public.notificaciones where usuario_id = $1 and cuerpo like $2 limit 1`,
    [ids.ventas, `%${cot.A.numero}%`])
  comprobar(Boolean(aviso) && aviso.cuerpo.includes(`con el código interno ${X2}`), `Ventas recibe el aviso con el código («${aviso?.cuerpo ?? ''}»)`)
}

await navegador.close()
await base.end()

if (errores.length) {
  console.log('\nErrores de consola:')
  for (const e of errores) console.log(`  ${e}`)
}
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)

/**
 * Recorre con clic real «Usar una OT ya registrada» (migración 20261127210000),
 * con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Administración registró dos OT sin cotización para el cliente (el taller
 *      empezó antes) y Gerencia las aprobó. Después Ventas sube la cotización de
 *      tres unidades y Gerencia la aprueba.
 *   2. Administración, a 1440, ve en la tarjeta «Usar una OT ya registrada»; la
 *      ventana lista las dos OT y las tres unidades libres. Elige la primera OT
 *      y la unidad 2, escribe el motivo y la engancha: la base la pone como la
 *      unidad 2, la bitácora lo dice, la tarjeta la lista y el encabezado lo dice.
 *   3. A 390, la ventana ofrece solo la otra OT y las dos unidades que quedan; sin
 *      tocar la unidad, entra como la 1.
 *   4. Ventas y Gerencia ven la tarjeta sin el botón: no enganchan.
 *
 * Lo que no entra (otro cliente, otra carrocería, la cotización llena, la
 * versión vieja, sin permiso) lo prueba el check 504 con el rol real.
 *
 * Arma sus propios datos ficticios (QA-ENG-…) y las cuentas `*.eng@banco.test`
 * con la clave local. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * BANCO_BASE (mw_demo), BANCO_ARCHIVOS (el mismo del servidor del banco), CAPTURAS.
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

/** Un PDF mínimo de una página, para que los archivos existan. */
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
  const correo = `${clave}.eng@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, null) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco enganche', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
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

const ruc = (await uno(`select n::text as ruc from generate_series(20990060000::bigint, 20990069999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text) limit 1`)).ruc
const cliente = `QA TRANSPORTES ENGANCHE ${sello}`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
  [ruc, cliente],
)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia, id limit 1`)).id
const sede = (await uno(`select id from public.sedes where activo order by nombre limit 1`)).id

// Las dos OT que Administración registró sin cotización, cada una con su unidad y su PDF.
const numeros = (await consulta(`select n from generate_series(9100, 9999) n
                                  where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                                  order by random() limit 3`, [anio])).map((f) => f.n)
const registradas = []
async function registrar(i, n) {
  const codigo = `QA-ENG ${sello}-${i + 1}`
  const unidad = (await uno(`insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
                             values ($1, $2, $3, 'SEMIRREMOLQUE') returning id`, [clienteId, codigo, `E${sello.slice(-4)}${i}`])).id
  const orden = (await uno('select gen_random_uuid() as id')).id
  const ruta = `ot/${orden}/orden.pdf`
  const contenido = pdfConTexto([`ORDEN DE TRABAJO N ${n}-${anio}`, `CLIENTE: ${cliente}`, 'Archivo de prueba del banco local.'])
  const destino = join(ARCHIVOS, 'adjuntos-ot', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('adjuntos-ot', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.administracion, contenido.length])
  await como('administracion', `select public.registrar_orden_sin_cotizacion($1, $2, $3, $4, $5, null, 'FABRICACION', 'NORMAL',
                                  $6, null, null, null, null, null, null, $7, 'orden.pdf', $8)`,
  [orden, String(n), clienteId, unidad, sede, `Furgón isotérmico que el taller empezó antes de la cotización (${i + 1})`, ruta, contenido.length])
  await como('gerencia', `update public.ordenes_trabajo set estado = 'APROBADA' where id = $1`, [orden])
  registradas.push({ id: orden, numero: `${n}-${anio}`, codigo })
}
await registrar(0, numeros[0])
await registrar(1, numeros[1])

// La cotización de tres unidades, aprobada.
const cot = { id: (await uno('select gen_random_uuid() as id')).id, numero: `QA-ENG-${sello}` }
{
  const ruta = `cot/${cot.id}/${cot.id}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${cot.numero}`, `CLIENTE: ${cliente}`, 'CANTIDAD : 03 UNIDADES'])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
                        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 135000, 'USD', 3)`,
  [cot.id, cot.numero, clienteId, carroceria, `Cotización ${cot.numero}.pdf`, ruta, contenido.length, ids.ventas])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.ventas, contenido.length])
  await como('ventas', `select public.confirmar_igv_cotizacion($1, false)`, [cot.id]).catch(() => {})
  await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cot.id])
}

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []
const MONITOR = { width: 1440, height: 900 }
const TELEFONO = { width: 390, height: 844 }

async function entrar(clave, viewport = MONITOR) {
  const correo = `${clave}.eng@banco.test`
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima', deviceScaleFactor: 2 })
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
const deLaCotizacion = () => consulta(`select o.id, o.numero, o.numero_de_unidad from public.ordenes_trabajo o
                                        where o.cotizacion_pdf_id = $1 and o.estado <> 'ANULADA' order by o.numero_de_unidad`, [cot.id])
const textos = async (lista) => (await lista.allTextContents()).map(limpio)

// ------------------------------------------------- 2. Administración, en el monitor
{
  const { pagina, contexto } = await entrar('administracion')
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(cot.numero)}`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${cot.id}"]`)
  const boton = t.getByRole('button', { name: 'Usar una OT ya registrada' })
  comprobar((await boton.count()) === 1, 'la tarjeta de la cotización ofrece «Usar una OT ya registrada»')
  comprobar((await t.getByRole('button', { name: 'Cargar la OT 1 de 3' }).count()) === 1, 'y sigue ofreciendo cargar una OT nueva')
  const avisoTarjeta = limpio(await t.locator('[data-aviso-ot-registrada]').textContent().catch(() => ''))
  comprobar(registradas.every((r) => avisoTarjeta.includes(r.numero)) && avisoTarjeta.includes('en vez de cargar otra'),
    `la tarjeta avisa que el cliente ya tiene OT registradas («${avisoTarjeta}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'enganchar-1-tarjeta-administracion-1440.png') })
  await boton.click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  const ots = await textos(v.locator('form select').first().locator('option'))
  comprobar(ots.length === 2 && registradas.every((r) => ots.some((o) => o.startsWith(`OT ${r.numero} · placa`))),
    `la ventana lista las dos OT registradas, con su placa (${ots.join(' | ')})`)
  const unidades = await textos(v.locator('select[name="unidad"] option'))
  comprobar(unidades.join(' · ') === 'Unidad 1 de 3 · Unidad 2 de 3 · Unidad 3 de 3', `y las tres unidades libres (${unidades.join(' · ')})`)
  await v.locator('form select').first().selectOption(registradas[0].id)
  const ficha = limpio(await v.locator('[data-ficha-ot]').textContent())
  comprobar(ficha.includes(`OT ${registradas[0].numero}`) && ficha.includes(registradas[0].codigo) && ficha.includes('Aprobada'),
    `debajo, la ficha de la OT elegida con su código y su estado («${ficha}»)`)
  await v.locator('select[name="unidad"]').selectOption('2')
  await v.locator('textarea[name="motivo"]').fill('El taller empezó el furgón antes de que se aprobara la cotización.')
  comprobar((await desborde(pagina)) <= 0, 'en el monitor la ventana no se desborda')
  await pagina.screenshot({ path: join(CAPTURAS, 'enganchar-2-ventana-administracion-1440.png') })
  await v.getByRole('button', { name: `Enganchar la OT ${registradas[0].numero}` }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => ''))
  comprobar(!(await v.isVisible()), `la OT entra${error ? ` (dijo: ${error})` : ''}`)
  await esperar(async () => (await deLaCotizacion()).length === 1, 10000)
  const ya = await deLaCotizacion()
  comprobar(ya.length === 1 && ya[0].id === registradas[0].id && ya[0].numero_de_unidad === 2,
    `la base la deja como la unidad 2 de la cotización (${JSON.stringify(ya)})`)
  const bitacora = await uno(`select descripcion, usuario_id from public.ot_bitacora where orden_id = $1 and datos->>'enganche_a_cotizacion' = 'true'`, [registradas[0].id])
  comprobar(bitacora?.usuario_id === ids.administracion && bitacora.descripcion.startsWith(`Enganchada a su cotización ${cot.numero} (unidad 2 de 3). Motivo: El taller empezó`),
    `la Trazabilidad de la OT lo dice, con quién («${bitacora?.descripcion}»)`)
  const aviso = await uno(`select cuerpo from public.notificaciones where usuario_id = $1 and origen_id = $2 and titulo = 'Tu cotización ya tiene su OT'`, [ids.ventas, cot.id])
  comprobar(Boolean(aviso?.cuerpo?.includes(registradas[0].numero)), `Ventas recibe el aviso («${aviso?.cuerpo}»)`)
  const estado = pagina.getByRole('status').filter({ hasText: 'quedó enganchada' })
  await estado.first().waitFor({ timeout: 10000 }).catch(() => {})
  comprobar((await estado.count()) > 0, `el encabezado dice que quedó («${limpio(await estado.first().textContent().catch(() => ''))}»)`)
  await esperar(async () => limpio(await t.innerText()).includes(`OT ${registradas[0].numero}`), 10000)
  comprobar(limpio(await t.innerText()).includes(`Unidad 2 ${registradas[0].codigo} · OT ${registradas[0].numero}`),
    'la tarjeta lista la unidad 2 con su código y su OT')
  await pagina.screenshot({ path: join(CAPTURAS, 'enganchar-3-tarjeta-tras-enganchar-1440.png') })

  // ---------------------------------------------- 3. Lo mismo en el teléfono
  await pagina.setViewportSize(TELEFONO)
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(cot.numero)}`, { waitUntil: 'networkidle' })
  comprobar((await desborde(pagina)) <= 0, 'en el teléfono la tarjeta no se desborda')
  await t.screenshot({ path: join(CAPTURAS, 'enganchar-4-tarjeta-administracion-390.png') })
  // La respuesta tarda: mientras va, la ventana no se cierra.
  let demorar = true
  await pagina.route('**/cotizaciones/pdf**', async (ruta) => {
    if (demorar && ruta.request().method() === 'POST') await new Promise((r) => setTimeout(r, 2500))
    await ruta.continue().catch(() => {})
  })
  await t.getByRole('button', { name: 'Usar una OT ya registrada' }).click()
  await v.waitFor()
  const quedan = await textos(v.locator('form select').first().locator('option'))
  comprobar(quedan.length === 1 && quedan[0].startsWith(`OT ${registradas[1].numero}`), `ofrece solo la otra OT (${quedan.join(' | ')})`)
  const libres = await textos(v.locator('select[name="unidad"] option'))
  comprobar(libres.join(' · ') === 'Unidad 1 de 3 · Unidad 3 de 3', `y las dos unidades que quedan (${libres.join(' · ')})`)
  await v.locator('textarea[name="motivo"]').fill('También empezó antes de la cotización.')
  comprobar((await desborde(pagina)) <= 0, 'en el teléfono la ventana no se desborda')
  await pagina.screenshot({ path: join(CAPTURAS, 'enganchar-5-ventana-administracion-390.png') })
  await v.getByRole('button', { name: `Enganchar la OT ${registradas[1].numero}` }).click()
  await pagina.waitForTimeout(400)
  comprobar(await v.getByRole('button', { name: 'Cancelar' }).isDisabled(), 'mientras envía, «Cancelar» no se puede')
  await pagina.keyboard.press('Escape')
  comprobar(await v.isVisible(), 'y Escape no cierra la ventana')
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  demorar = false
  const enTarjeta = t.locator('[data-enganche-en-la-tarjeta]')
  await enTarjeta.waitFor({ timeout: 10000 }).catch(() => {})
  await pagina.waitForTimeout(500)
  const dicho = limpio(await enTarjeta.textContent().catch(() => ''))
  const foco = await pagina.evaluate(() => document.activeElement?.hasAttribute('data-enganche-en-la-tarjeta') ?? false)
  const caja = await enTarjeta.boundingBox().catch(() => null)
  comprobar(dicho.includes(`OT ${registradas[1].numero}`) && foco && caja && caja.y >= 0 && caja.y + caja.height <= TELEFONO.height,
    `en el teléfono la tarjeta dice que quedó, a la vista y con el cursor («${dicho}», foco ${foco}, y=${caja?.y})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'enganchar-5b-tras-enganchar-390.png') })
  await esperar(async () => (await deLaCotizacion()).length === 2, 10000)
  const dos = await deLaCotizacion()
  comprobar(dos.length === 2 && dos.find((o) => o.id === registradas[1].id)?.numero_de_unidad === 1,
    `sin tocar la unidad, entra como la 1, la primera libre (${JSON.stringify(dos)})`)
  await esperar(async () => (await t.getByRole('button', { name: 'Usar una OT ya registrada' }).count()) === 0, 10000)
  comprobar((await t.getByRole('button', { name: 'Usar una OT ya registrada' }).count()) === 0, 'sin más OT registradas, el botón se va')
  await t.screenshot({ path: join(CAPTURAS, 'enganchar-6-tarjeta-tras-enganchar-390.png') })
  await contexto.close()
}

// --------------------------------------------- 4. Ventas y Gerencia no enganchan
{
  // Una tercera OT registrada: a Administración se le ofrecería para la unidad 3.
  await registrar(2, numeros[2])
  {
    const { pagina, contexto } = await entrar('administracion')
    await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(cot.numero)}`, { waitUntil: 'networkidle' })
    comprobar((await pagina.locator(`li[id="${cot.id}"]`).getByRole('button', { name: 'Usar una OT ya registrada' }).count()) === 1,
      'con una tercera OT registrada, a Administración se le vuelve a ofrecer')
    await contexto.close()
  }
  for (const [quien, viewport] of [['ventas', TELEFONO], ['gerencia', MONITOR]]) {
    const { pagina, contexto } = await entrar(quien, viewport)
    await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(cot.numero)}`, { waitUntil: 'networkidle' })
    const t = pagina.locator(`li[id="${cot.id}"]`)
    comprobar((await t.count()) === 1, `${quien} ve la tarjeta de la cotización`)
    comprobar((await t.getByRole('button', { name: 'Usar una OT ya registrada' }).count()) === 0, `${quien} no tiene «Usar una OT ya registrada»`)
    await contexto.close()
  }
}

await navegador.close()
await base.end()
if (errores.length) console.log(`\nErrores de consola:\n${errores.join('\n')}`)
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)

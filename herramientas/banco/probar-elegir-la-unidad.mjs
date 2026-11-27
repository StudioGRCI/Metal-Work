/**
 * Recorre con clic real «Administración elige la unidad al cargar la OT»
 * (migración 20261127010000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Gerencia ve en «Por decidir» que la cotización es de 3 unidades: el
 *      total es de todas.
 *   2. Administración abre «Cargar la OT 1 de 3» y la ventana trae «Unidad»
 *      con las tres libres y la primera elegida. Elige la 3: el título dice
 *      «Unidad 3 de 3» y la OT entra en la unidad 3, con su descripción.
 *   3. Al volver, la lista ofrece solo las dos que quedan libres, y la tarjeta
 *      lista la unidad 3 con su código y su OT.
 *
 * Elegir por la API una unidad que no existe o que ya tiene OT lo prueba el
 * check 498 (8d), con el rol de Administración.
 *
 * En monitor (1440) y, con capturas, en teléfono (390). Arma sus propios datos
 * ficticios (QA-ELU-…) y las cuentas `*.elu@banco.test` con la clave local.
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
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.elu@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, null) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco elegir unidad', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
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

const ruc = (await uno(`select n::text as ruc from generate_series(20990050000::bigint, 20990059999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text) limit 1`)).ruc
const cliente = `QA TRANSPORTES ELIGE ${sello}`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
  [ruc, cliente],
)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

/** Siembra una cotización de tres unidades con su PDF, como la sube Ventas. */
async function sembrarCotizacion(numero) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const ruta = `cot/${id}/${id}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${numero}`, `CLIENTE: ${cliente}`, 'CAMA BAJA 3 EJES', 'CANTIDAD : 03 UNIDADES'])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
                        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 135000, 'USD', 3)`,
  [id, numero, clienteId, carroceria, `Cotización ${numero}.pdf`, ruta, contenido.length, ids.ventas])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.ventas, contenido.length])
  await como('ventas', `select public.confirmar_igv_cotizacion($1, false)`, [id]).catch(() => {})
  return { id, numero }
}
const cot = await sembrarCotizacion(`QA-ELU-${sello}-1`)
const porRevisar = await sembrarCotizacion(`QA-ELU-${sello}-2`)
await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [cot.id])

const nOt = (await uno(`select n from generate_series(9100, 9999) n
                         where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                         order by random() limit 1`, [anio])).n
const PDF_OT = join(CAPTURAS, `OT-${nOt}-ELU.pdf`)
writeFileSync(PDF_OT, pdfConTexto([
  `ORDEN DE TRABAJO N ${nOt}-${anio}`,
  `CLIENTE: ${cliente}`,
  'PRODUCTO: SEMIRREMOLQUE CAMA BAJA 3 EJES',
  `FECHA DE ENTREGA DE LA UNIDAD: 20 de diciembre de ${anio}`,
  'Esta orden de trabajo es un archivo de prueba del banco local de Metal Work.',
]))
const CODIGO = `QA_ELU_${sello}/3`

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []
const MONITOR = { width: 1440, height: 900 }
const TELEFONO = { width: 390, height: 844 }

async function entrar(clave, viewport = MONITOR) {
  const correo = `${clave}.elu@banco.test`
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
const otsDe = (id) => consulta(`select o.numero, o.numero_de_unidad, o.descripcion, u.codigo_interno from public.ordenes_trabajo o
                                  join public.unidades u on u.id = o.unidad_id
                                 where o.cotizacion_pdf_id = $1 and o.estado <> 'ANULADA' order by o.creado_en`, [id])
const opciones = async (v) => (await v.locator('[data-elige-la-unidad] option').allTextContents()).map(limpio)

// ---------------------------------------------------------------- 1. Gerencia
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/por-decidir`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`[data-por-decidir="${porRevisar.id}"]`)
  const texto = limpio(await fila.innerText().catch(() => ''))
  comprobar(texto.includes('3 unidades') && texto.includes('US$ 135,000.00'), `«Por decidir» dice que son 3 unidades junto al total («${texto.slice(0, 200)}»)`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. Administración
{
  const { pagina, contexto } = await entrar('administracion')
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${cot.id}"]`)
  const v = pagina.getByRole('dialog')
  await t.getByRole('button', { name: 'Cargar la OT 1 de 3' }).click()
  await v.waitFor()
  const lista = v.locator('[data-elige-la-unidad]')
  comprobar((await lista.count()) === 1, 'la ventana trae «Unidad» para elegir')
  const ofrece = await opciones(v)
  comprobar(ofrece.join(' · ') === 'Unidad 1 de 3 · Unidad 2 de 3 · Unidad 3 de 3', `con las tres libres (${ofrece.join(' · ')})`)
  comprobar((await lista.inputValue()) === '1', 'y la primera elegida, como hasta ahora')
  await lista.selectOption('3')
  const titulo = limpio(await v.locator('h2').first().textContent())
  comprobar(titulo === `Unidad 3 de 3 de la ${cot.numero}`, `al elegir la 3, el título lo dice («${titulo}»)`)
  await v.locator('input[type="file"]').setInputFiles(PDF_OT)
  await v.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
  await v.locator('input[name="codigo_interno"]').fill(CODIGO)
  if (!(await v.locator('select[name="tipo_unidad"]').inputValue())) await v.locator('select[name="tipo_unidad"]').selectOption('SEMIRREMOLQUE')
  comprobar((await v.locator('input[name="numero"]').inputValue()) === `${nOt}-${anio}`, 'el número de la OT sale de su PDF')
  await pagina.screenshot({ path: join(CAPTURAS, 'elegir-unidad-1-administracion-1440.png') })
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => ''))
  comprobar(!(await v.isVisible()), `la OT entra${error ? ` (dijo: ${error})` : ''}`)
  await esperar(async () => (await otsDe(cot.id)).length === 1, 10000)
  const ots = await otsDe(cot.id)
  comprobar(ots.length === 1 && ots[0].numero_de_unidad === 3 && ots[0].codigo_interno === CODIGO,
    `la base la pone en la unidad 3, con su código (${JSON.stringify(ots)})`)
  comprobar(ots[0]?.descripcion?.endsWith('unidad 3 de 3'), `y su descripción dice «unidad 3 de 3» («${ots[0]?.descripcion}»)`)
  comprobar((await huerfanosOt()).length === 0, 'sin archivos sueltos')

  // Al volver: las dos que quedan, en el teléfono.
  await pagina.setViewportSize(TELEFONO)
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`, { waitUntil: 'networkidle' })
  const texto = limpio(await t.innerText())
  comprobar(texto.includes(`Unidad 3 ${CODIGO} · OT ${nOt}-${anio}`), `la tarjeta lista la unidad 3 con su código y su OT («${texto.slice(0, 300)}»)`)
  comprobar((await desborde(pagina)) <= 0, 'en el teléfono la tarjeta no se desborda')
  await t.screenshot({ path: join(CAPTURAS, 'elegir-unidad-2-tarjeta-390.png') })
  await t.getByRole('button', { name: 'Cargar la OT 1 de 3' }).click()
  await v.waitFor()
  const quedan = await opciones(v)
  comprobar(quedan.join(' · ') === 'Unidad 1 de 3 · Unidad 2 de 3', `la lista ofrece solo las dos libres (${quedan.join(' · ')})`)
  comprobar((await desborde(pagina)) <= 0, 'en el teléfono la ventana no se desborda')
  await pagina.screenshot({ path: join(CAPTURAS, 'elegir-unidad-3-ventana-390.png') })
  await pagina.keyboard.press('Escape')
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length) console.log(`\nErrores de consola:\n${errores.join('\n')}`)
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo en orden.')
process.exit(fallas.length || errores.length ? 1 : 0)

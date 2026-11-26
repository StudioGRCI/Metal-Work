/**
 * Recorre con clic real los pendientes de Administración en Órdenes de trabajo
 * (plan 8, entrega 8.1, migración 20261126330000), con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Ventas sube una cotización y Gerencia la aprueba.
 *   2. Administración entra a Órdenes de trabajo y arriba, en «Por completar»,
 *      ve la cotización «Sin OT» con sus días en espera y las OT sin código
 *      interno. «Cargar la OT» la lleva a la tarjeta de la cotización.
 *   3. Carga el código y la OT **sin fecha de entrega**: entra, y la OT vuelve
 *      a la lista de pendientes «Sin fecha de entrega».
 *   4. «Poner la fecha» la lleva a la OT con «Editar OT» ya abierta; le pone
 *      la fecha, sale de los pendientes, y la OT muestra el recorrido de su
 *      cotización.
 *   5. Gerencia ve la lista de OT sin la tarjeta (consulta, no completa).
 *
 * Capturas en teléfono (390) y monitor (1440). Arma sus datos ficticios
 * (QA-P8-…) y las cuentas `*.p8@banco.test` con la clave local. Variables:
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
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.p8@banco.test`
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

const ruc = (await uno(`select n::text as ruc from generate_series(20990048000::bigint, 20990048999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text) limit 1`)).ruc
const cliente = `QA TRANSPORTES P8 ${sello} S.A.C.`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
  [ruc, cliente],
)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

// 1. Ventas sube la cotización; Gerencia la aprueba.
const cot = { id: (await uno('select gen_random_uuid() as id')).id, numero: `QA-P8-${sello}` }
{
  const ruta = `cot/${cot.id}/${cot.id}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${cot.numero}`, `CLIENTE: ${cliente}`, 'Semirremolque plataforma de prueba'])
  const destino = join(ARCHIVOS, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                        values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, 59000, 'USD')`,
  [cot.id, cot.numero, clienteId, carroceria, `Cotización ${cot.numero}.pdf`, ruta, contenido.length, ids.ventas])
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.ventas, contenido.length])
  const [ap] = await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1 returning id`, [cot.id])
  comprobar(Boolean(ap), 'Gerencia aprueba la cotización (con su rol)')
  // Que lleve dos días esperando, para ver la cuenta de días: se corre la hora de su aprobación.
  // El disparador de la cotización conserva la hora de la revisión: se corre sin disparadores.
  await base.query('begin')
  await base.query(`set local session_replication_role = replica`)
  await base.query(`update public.cotizaciones_pdf set revisado_en = now() - interval '2 days' where id = $1`, [cot.id])
  await base.query('commit')
}

// Un número de OT libre y su PDF, sin fecha de entrega en el papel.
const N = String((await uno(`select n from generate_series(9100, 9999) n
                              where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                              order by random() limit 1`, [anio])).n)
const ARCHIVO_OT = join(CAPTURAS, `OT-${N}.pdf`)
writeFileSync(ARCHIVO_OT, pdfConTexto([
  `ORDEN DE TRABAJO N ${N}-${anio}`,
  `CLIENTE: ${cliente}`,
  'PRODUCTO: SEMIRREMOLQUE PLATAFORMA 3 EJES',
  'Esta orden de trabajo es un archivo de prueba del banco local de Metal Work.',
]))
const X = `QA_P8_${sello}/26`

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []

async function entrar(clave, viewport = { width: 1440, height: 900 }) {
  const correo = `${clave}.p8@banco.test`
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

async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').first().textContent({ timeout: 500 }).catch(() => ''))
}

const tarjeta = (pagina) => pagina.locator('[data-pendientes-ot]')
const fila = (pagina, numero) => pagina.locator(`[data-pendiente-ot="${numero}"]`)
/** La fila, a la vista: pasadas las primeras, va dentro de «Ver los … pendientes más». */
async function aLaVista(pagina, numero) {
  const f = fila(pagina, numero)
  if (!(await f.isVisible().catch(() => false))) await pagina.locator('[data-pendientes-ot-resto] summary').click().catch(() => {})
  return f
}

// ------------------------------------------------------------ 2. Administración ve lo que falta
let otId = null
{
  const { pagina, contexto } = await entrar('administracion')
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  const t = tarjeta(pagina)
  comprobar((await t.count()) === 1, 'arriba de la lista de OT está «Por completar»')
  const titulo = limpio(await t.locator('h2').first().textContent().catch(() => ''))
  comprobar(titulo === 'Por completar', `con su título («${titulo}»)`)
  const fc = fila(pagina, cot.numero)
  const textoFc = limpio(await fc.textContent().catch(() => ''))
  comprobar(textoFc.includes(`Cotización ${cot.numero}`) && textoFc.includes('Sin OT') && textoFc.includes(cliente.toUpperCase())
    && textoFc.includes('hace 2 días'), `la cotización aprobada sale «Sin OT», con su cliente y «hace 2 días» («${textoFc}»)`)
  const demo = await consulta(`select o.numero from public.ordenes_trabajo o left join public.unidades u on u.id = o.unidad_id
                                where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA') and o.tipo_trabajo not in ('MANTENIMIENTO', 'GARANTIA')
                                  and nullif(btrim(coalesce(u.codigo_interno, '')), '') is null`)
  for (const { numero } of demo) {
    const texto = limpio(await fila(pagina, numero).textContent().catch(() => ''))
    // Con su botón, o con el porqué si desde la OT no se puede (sin unidad, o la comparte).
    comprobar(texto.includes('Sin código interno') && (/Poner el código|Completar/.test(texto) || texto.includes('desde la OT no se puede poner')),
      `la OT ${numero} sale «Sin código interno», con su botón o con por qué no se puede ahí («${texto}»)`)
  }
  await pagina.screenshot({ path: join(CAPTURAS, '8-1-administracion-1440-1-por-completar.png'), fullPage: false })

  // «Cargar la OT» lleva a la tarjeta de la cotización.
  await (await aLaVista(pagina, cot.numero)).getByRole('link', { name: /Cargar la OT/ }).click()
  await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf', { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  const c = pagina.locator(`li[id="${cot.id}"]`)
  await c.waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(await c.isVisible().catch(() => false), 'y «Cargar la OT» lleva a la tarjeta de la cotización')

  // 3. Código y OT sin fecha de entrega.
  await c.getByRole('button', { name: 'Dar código y cargar la OT' }).click()
  const v = pagina.locator('[role="dialog"]')
  const fecha = v.locator('input[name="fecha_entrega"]')
  comprobar(!(await fecha.evaluate((e) => e.required)), 'la fecha de entrega ya no es obligatoria')
  const ayuda = limpio(await v.getByText('El día prometido al cliente, según la OT').textContent().catch(() => ''))
  comprobar(ayuda.includes('cárgala sin fecha'), `y su ayuda dice que se puede cargar sin ella («${ayuda}»)`)
  await v.locator('input[name="codigo_interno"]').fill(X)
  await v.locator('input[type="file"]').setInputFiles(ARCHIVO_OT)
  await v.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
  await v.locator('input[name="numero"]').fill(N)
  await v.locator('select[name="tipo_unidad"]').selectOption('SEMIRREMOLQUE')
  await fecha.fill('')
  await v.getByRole('button', { name: 'Guardar código y OT' }).click()
  const e = await esperarVentana(pagina)
  comprobar(e === '', `la OT entra sin fecha${e ? ` (dijo: ${e})` : ''}`)
  const ot = await uno(`select o.id, o.numero, o.fecha_entrega_comprometida from public.ordenes_trabajo o where o.cotizacion_pdf_id = $1 and o.estado <> 'ANULADA'`, [cot.id])
  otId = ot?.id ?? null
  comprobar(ot?.numero === `${N}-${anio}` && ot.fecha_entrega_comprometida === null, `en la base: OT ${ot?.numero} sin fecha de entrega`)
  const aviso = await uno(`select cuerpo from public.notificaciones where origen_id = $1 and titulo = 'Código nuevo con su OT' limit 1`, [otId])
  comprobar((aviso?.cuerpo ?? '').includes('Entrega prometida: por definir.'), `el aviso a Diseño dice «por definir» («${aviso?.cuerpo ?? ''}»)`)

  // Vuelve a la lista: la cotización salió; la OT queda «Sin fecha de entrega».
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  comprobar((await fila(pagina, cot.numero).count()) === 0, 'con su OT, la cotización sale de «Por completar»')
  const fo = fila(pagina, `${N}-${anio}`)
  const textoFo = limpio(await fo.textContent().catch(() => ''))
  comprobar(textoFo.includes('Sin fecha de entrega') && !textoFo.includes('Sin código') && textoFo.includes('Poner la fecha'),
    `y la OT queda «Sin fecha de entrega», con «Poner la fecha» («${textoFo}»)`)

  // 4. «Poner la fecha» lleva a la OT con «Editar OT» ya abierta, y le pone la fecha.
  await (await aLaVista(pagina, `${N}-${anio}`)).getByRole('link', { name: /Poner la fecha/ }).click()
  await pagina.waitForURL((u) => u.pathname === `/ordenes/${otId}`, { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  const ve = pagina.locator('[role="dialog"]')
  await ve.waitFor({ timeout: 15000 }).catch(() => {})
  const tituloVe = limpio(await ve.locator('h2').first().textContent().catch(() => ''))
  comprobar(tituloVe === `Editar OT ${N}-${anio}`, `y abre «Editar OT» sola («${tituloVe}»)`)
  comprobar(!new URL(pagina.url()).searchParams.has('editar'), 'y quita «editar» de la dirección, para no abrirla otra vez al recargar')
  await pagina.screenshot({ path: join(CAPTURAS, '8-1-administracion-1440-3-poner-la-fecha.png'), fullPage: false })
  const dia = (await uno(`select to_char((now() at time zone 'America/Lima')::date + 20, 'YYYY-MM-DD') as d`)).d
  await ve.locator('input[name="fecha_entrega_comprometida"]').fill(dia)
  await ve.locator('textarea[name="motivo"]').fill('El cliente confirmó la fecha de entrega')
  await ve.getByRole('button', { name: /Guardar/ }).click()
  const e2 = await esperarVentana(pagina)
  comprobar(e2 === '', `«Editar OT» guarda la fecha${e2 ? ` (dijo: ${e2})` : ''}`)
  const conFecha = await uno(`select fecha_entrega_comprometida::text as f from public.ordenes_trabajo where id = $1`, [otId])
  comprobar(conFecha?.f === dia, `en la base, la OT tiene su fecha (${conFecha?.f})`)

  // El recorrido de su cotización, en la misma OT.
  await pagina.reload({ waitUntil: 'networkidle' })
  const reabierta = limpio(await pagina.locator('[role="dialog"] h2').first().textContent({ timeout: 2000 }).catch(() => ''))
  comprobar(reabierta === '', `al recargar, «Editar OT» no se abre otra vez${reabierta ? ` (abrió «${reabierta}» en ${pagina.url()})` : ''}`)
  const r = pagina.locator('[data-recorrido-de-la-ot]')
  const textoR = limpio(await r.textContent().catch(() => ''))
  comprobar(textoR.includes('Recorrido de su cotización') && textoR.includes(`Cotización ${cot.numero}`), 'la OT muestra «Recorrido de su cotización»')
  await r.locator('summary').first().click()
  const pasos = await r.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => `${e.getAttribute('data-recorrido-paso')}:${e.getAttribute('data-situacion')}`))
  comprobar(pasos.includes('SUBIDA:HECHO') && pasos.includes('REVISION:HECHO') && pasos.includes('CODIGO_Y_OT:HECHO'),
    `con la subida, la revisión de Gerencia y el código y la OT hechos (${pasos.join(', ')})`)
  const textoPasos = limpio(await r.textContent())
  comprobar(textoPasos.includes(`OT ${N}-${anio}`) && !/\b\d{1,3}(,\d{3})*\.\d{2}\b/.test(textoPasos), 'dice el número de la OT y ningún importe')
  await pagina.screenshot({ path: join(CAPTURAS, '8-1-administracion-1440-2-recorrido-de-la-ot.png'), fullPage: true })
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  comprobar((await fila(pagina, `${N}-${anio}`).count()) === 0, 'y sale de «Por completar»')
  await contexto.close()
}

// Teléfono: la lista con lo que falta y la OT con su recorrido.
{
  // Otra cotización aprobada sin OT, para que el teléfono la muestre también.
  const id2 = (await uno('select gen_random_uuid() as id')).id
  await como('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                             mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                        values ($1, $2, $3, $4, 'c.pdf', $5, 'application/pdf', 100, $6, 30000, 'PEN')`,
  [id2, `QA-P8-${sello}-B`, clienteId, carroceria, `cot/${id2}/c.pdf`, ids.ventas])
  await como('gerencia', `update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [id2])
  const { pagina, contexto } = await entrar('administracion', { width: 390, height: 844 })
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono la lista no se desliza de costado (${ancho} px)`)
  comprobar(await (await aLaVista(pagina, `QA-P8-${sello}-B`)).isVisible().catch(() => false), 'en el teléfono se ve lo que falta')
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: join(CAPTURAS, '8-1-administracion-390-1-por-completar.png') })
  await pagina.goto(`${BASE}/ordenes/${otId}`, { waitUntil: 'networkidle' })
  const r = pagina.locator('[data-recorrido-de-la-ot]')
  await r.locator('summary').first().click()
  await r.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, '8-1-administracion-390-2-recorrido-de-la-ot.png') })
  await contexto.close()
}

// ------------------------------------------------------------ 5. Gerencia consulta
{
  const { pagina, contexto } = await entrar('gerencia')
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  const h1 = limpio(await pagina.locator('h1').first().textContent().catch(() => ''))
  comprobar(h1 === 'Órdenes de trabajo' && (await tarjeta(pagina).count()) === 0, `Gerencia ve la lista de OT sin «Por completar» («${h1}»)`)
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

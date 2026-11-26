/**
 * Recorre con clic real la venta cuya OT pasó a otro comprador (plan 8,
 * migración 20261126988000; DKS, 2026-11-26: «Cerrarla: no lleva otra OT»),
 * con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Ventas sube seis cotizaciones (tres del primer cliente, dos de una
 *      unidad y una de tres, y tres del otro comprador) y Gerencia las aprueba.
 *   2. Administración carga sus OT; Contabilidad factura una de las de una
 *      unidad; Administración pasa tres OT a otro comprador con la función de
 *      «Editar OT» (`editar_ot_con_historial`), con su rol.
 *   3. Administración, en Cotización: la de una unidad dice de qué OT fue la
 *      venta y ya no ofrece «Dar código y cargar la OT»; su recorrido dice
 *      «Pasó a otro comprador» y no espera a nadie. La de tres dice qué OT pasó
 *      y sigue ofreciendo cargar la que falta.
 *   4. En «Por completar» de Órdenes de trabajo la de una unidad ya no está; la
 *      de tres sale con «falta 1 de 3 OT» y la nota de la que pasó.
 *   5. Ventas ve lo mismo en su tarjeta, con el número de la OT.
 *   6. Contabilidad, en Facturación: la venta que facturó antes de que su OT
 *      pasara dice que pasó y que queda cobrar o anular la factura, sin pedirle
 *      la OT a Administración ni decir cuánto falta facturar.
 *   7. Tesorería, en Cuentas por cobrar, la ve como venta cerrada, sin el %
 *      de la cotización.
 *   8. La venta que se reabrió (su OT pasó a otro comprador y Gerencia la anuló
 *      allí): Administración la ve esperando su OT otra vez, sin botón de
 *      cancelar; Ventas, que la registró, la cancela con «Cancelar la venta»
 *      (motivo corto rechazado, tres toques, una anulación) y sale de «Por
 *      completar».
 *
 * Capturas en teléfono (390) y monitor (1440). Arma sus datos ficticios
 * (QA-P8V-…) y las cuentas `*.p8v@banco.test` con la clave local. Variables:
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
  tesoreria: ['TESORERIA', 'TES'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.p8v@banco.test`
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
for (const [clave, nombre] of [['a', `QA PRIMER COMPRADOR P8V ${sello} S.A.C.`], ['b', `QA OTRO COMPRADOR P8V ${sello} S.A.C.`]]) {
  clientes[clave] = { nombre, id: (await uno(
    `insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
    [await rucLibre(), nombre],
  )).id }
}
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

// 1. Ventas sube las once; Gerencia las aprueba.
const cot = {}
for (const [clave, cliente, unidades] of [['una', 'a', 1], ['tres', 'a', 3], ['nueva1', 'b', 1], ['nueva3', 'b', 1], ['facturada', 'a', 1], ['nuevaf', 'b', 1], ['reabierta', 'a', 1], ['nuevar', 'b', 1], ['otravez', 'a', 1], ['nuevao1', 'b', 1], ['nuevao2', 'b', 1]]) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const numero = `QA-P8V-${sello}-${clave.toUpperCase()}`
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

// 2. Administración carga las OT y pasa dos a otro comprador.
const libres = (await consulta(`select n from generate_series(9100, 9999) n
                                 where not exists (select 1 from public.ordenes_trabajo o where o.numero = n || '-' || $1)
                                 order by random() limit 7`, [anio])).map((f) => String(f.n))
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
  ots[clave] = { id, numero: `${numero}-${anio}` }
}
for (const [clave, cotizacion, numero, codigo] of [
  ['ot1', 'una', libres[0], `QA_P8V_${sello}_A`],
  ['ot2', 'tres', libres[1], `QA_P8V_${sello}_B`],
  ['ot3', 'tres', libres[2], `QA_P8V_${sello}_C`],
  ['ot4', 'facturada', libres[3], `QA_P8V_${sello}_D`],
  ['ot5', 'reabierta', libres[4], `QA_P8V_${sello}_E`],
  ['ot6', 'otravez', libres[5], `QA_P8V_${sello}_F`],
]) await cargarOt(clave, cotizacion, numero, codigo)
async function pasar(ot, cotizacion) {
  const v = await uno(`select o.actualizado_en::text as actualizado_en, o.descripcion, o.prioridad, o.fecha_entrega_comprometida::text as fecha,
                              u.codigo_interno, u.marca, u.modelo, u.actualizado_en::text as u_ver
                         from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.id = $1`, [ot.id])
  await como('administracion', `select public.editar_ot_con_historial($1, $2, $3::jsonb, 'El cliente cedió la unidad a otro comprador (banco)')`, [
    ot.id, v.actualizado_en, JSON.stringify({
      descripcion: v.descripcion, prioridad: v.prioridad, fecha_entrega_comprometida: v.fecha, codigo_interno: v.codigo_interno,
      marca: v.marca ?? '', modelo: v.modelo ?? '', unidad_version: v.u_ver, cotizacion_nueva_id: cotizacion.id,
    }),
  ])
}
// Contabilidad factura otra de una unidad antes de que su OT pase: con su rol y su PDF.
const factura = { id: (await uno('select gen_random_uuid() as id')).id, numero: `E001-${Number(sello)}` }
{
  const ruta = `${factura.id}/${factura.id}.pdf`
  const contenido = pdfConTexto([`FACTURA ${factura.numero}`, 'Archivo de prueba del banco local de Metal Work.'])
  const destino = join(ARCHIVOS, 'facturas-venta', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
                  values ('facturas-venta', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
  [ruta, ids.contabilidad, contenido.length])
  const [f] = await como('contabilidad', `select public.registrar_factura_venta($1, $2, $3, (now() at time zone 'America/Lima')::date,
                                           (now() at time zone 'America/Lima')::date + 30, 'USD', 26550, 'Inicial 50 %', $4, 'factura.pdf') as id`,
  [factura.id, cot.facturada.id, factura.numero, ruta])
  comprobar(f?.id === factura.id, `Contabilidad factura ${cot.facturada.numero} antes de que su OT pase (${factura.numero}, con su rol)`)
}
await pasar(ots.ot1, cot.nueva1)
await pasar(ots.ot2, cot.nueva3)
await pasar(ots.ot4, cot.nuevaf)
// La que se reabre: su OT pasa a otro comprador y Gerencia la anula allí.
await pasar(ots.ot5, cot.nuevar)
{
  const [an] = await como('gerencia', `update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (banco)'
                                        where id = $1 returning id`, [ots.ot5.id])
  comprobar(Boolean(an), `Gerencia anula la OT ${ots.ot5.numero}, que había pasado a otro comprador (con su rol)`)
  // Quien registró la venta se entera: un aviso con el camino a su tarjeta.
  const avisos = await consulta(`select n.ruta, n.cuerpo from public.notificaciones n
                                  where n.usuario_id = $1 and n.origen_id = $2 and n.titulo = 'Tu venta volvió a esperar su OT'`,
  [ids.ventas, cot.reabierta.id])
  comprobar(avisos.length === 1 && avisos[0].ruta === `/cotizaciones/pdf?estado=APROBADA_SIN_OT#${cot.reabierta.id}`
    && avisos[0].cuerpo.includes('cancélala con «Cancelar la venta»'),
  `Ventas recibe un aviso de que su venta volvió a esperar su OT («${avisos[0]?.cuerpo ?? ''}»)`)
}
// La que se cierra otra vez: se reabrió igual, Administración le cargó otra OT y esa también pasó a otro comprador.
await pasar(ots.ot6, cot.nuevao1)
{
  const [an] = await como('gerencia', `update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (banco)'
                                        where id = $1 returning id`, [ots.ot6.id])
  await cargarOt('ot7', 'otravez', libres[6], `QA_P8V_${sello}_G`)
  await pasar(ots.ot7, cot.nuevao2)
  const v = await uno(`select o.cotizacion_pdf_id from public.ordenes_trabajo o where o.id = $1`, [ots.ot7.id])
  comprobar(Boolean(an) && v.cotizacion_pdf_id === cot.nuevao2.id,
    `La venta ${cot.otravez.numero} se reabrió (OT ${ots.ot6.numero} anulada) y su OT nueva ${ots.ot7.numero} también pasó a otro comprador`)
}
const movidas = await consulta(`select o.id from public.ordenes_trabajo o where o.id = any($1::uuid[]) and o.cotizacion_pdf_id = any($2::uuid[])`,
  [[ots.ot1.id, ots.ot2.id], [cot.nueva1.id, cot.nueva3.id]])
comprobar(movidas.length === 2, `Administración pasa las OT ${ots.ot1.numero} y ${ots.ot2.numero} a otro comprador con «Editar OT»`)

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
const errores = []

async function entrar(clave, viewport = { width: 1440, height: 900 }) {
  const correo = `${clave}.p8v@banco.test`
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

/** La tarjeta de la cotización en Cotización, buscada por su número. */
async function laTarjeta(pagina, c, estado = '') {
  await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(c.numero)}${estado ? `&estado=${estado}` : ''}`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[id="${c.id}"]`)
  await t.waitFor({ timeout: 15000 }).catch(() => {})
  return t
}
const nota = async (t) => limpio(await t.locator('[data-paso-a-otro-comprador]').first().textContent({ timeout: 2000 }).catch(() => ''))
const pasos = (t) => t.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => `${e.getAttribute('data-recorrido-paso')}:${e.getAttribute('data-situacion')}`))
const fila = (pagina, numero) => pagina.locator(`[data-pendiente-ot="${numero}"]`)
async function aLaVista(pagina, numero) {
  const f = fila(pagina, numero)
  if (!(await f.isVisible().catch(() => false))) await pagina.locator('[data-pendientes-ot-resto] summary').click().catch(() => {})
  return f
}
/** Abre el recorrido de la tarjeta, si está plegado, para que salga en la captura. */
async function abrirRecorrido(t) {
  const s = t.locator('summary').filter({ hasText: /Recorrido/ }).first()
  if (await s.isVisible().catch(() => false)) await s.click().catch(() => {})
}

// ------------------------------------------------------------ 3 y 4. Administración
for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto } = await entrar('administracion', { width: ancho, height: alto })
  const una = await laTarjeta(pagina, cot.una)
  const textoUna = await nota(una)
  comprobar(textoUna === `Su OT ${ots.ot1.numero} pasó a otro comprador: esta venta ya no lleva otra OT.`,
    `${ancho}: la de una unidad dice de qué OT fue la venta («${textoUna}»)`)
  comprobar((await una.getByText('Pasó a otro comprador', { exact: true }).count()) >= 1,
    `${ancho}: y lo dice también junto a «Aprobada»`)
  comprobar((await una.getByRole('button', { name: 'Dar código y cargar la OT' }).count()) === 0,
    `${ancho}: y ya no ofrece «Dar código y cargar la OT»`)
  const pUna = await pasos(una)
  comprobar(pUna.includes('OTRO_COMPRADOR:HECHO') && !pUna.some((p) => p.endsWith(':AHORA')),
    `${ancho}: su recorrido dice que pasó a otro comprador y no espera a nadie (${pUna.join(', ')})`)
  const recorridoUna = limpio(await una.textContent())
  comprobar(recorridoUna.includes('Pasó a otro comprador') && recorridoUna.includes(`La OT ${ots.ot1.numero} ya no es de esta venta`),
    `${ancho}: con el paso en palabras y el número de la OT`)
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: la tarjeta no se desliza de costado (${desliza} px)`)
  }
  await abrirRecorrido(una)
  await una.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `venta-anterior-administracion-${ancho}-1-la-de-una-unidad.png`), fullPage: ancho === 1440 })

  const tres = await laTarjeta(pagina, cot.tres)
  const textoTres = await nota(tres)
  comprobar(textoTres.startsWith('Unidad 1') && textoTres.includes(`OT ${ots.ot2.numero}`) && textoTres.endsWith('Pasó a otro comprador: ya no lleva OT'),
    `${ancho}: la de tres dice, entre sus unidades, que la 1 pasó con su OT («${textoTres}»)`)
  const unidades = await tres.locator('ul[aria-label^="OT de las"] > li').evaluateAll((l) => l.map((e) => e.textContent.match(/Unidad \d/)?.[0]))
  comprobar(unidades.join(',') === 'Unidad 1,Unidad 2', `${ancho}: en orden de unidad (${unidades.join(', ')})`)
  // La unidad 1 pasó y la 2 tiene la suya: la que falta es la 3.
  comprobar((await tres.getByRole('button', { name: 'Cargar la OT 3 de 3' }).count()) === 1,
    `${ancho}: y ofrece cargar la que falta, la 3`)
  const pTres = await pasos(tres)
  comprobar(pTres.includes('OTRO_COMPRADOR:HECHO') && pTres.includes('CODIGO_Y_OT:AHORA'),
    `${ancho}: su recorrido dice que una pasó y espera la OT que falta (${pTres.join(', ')})`)
  const textoTresTodo = limpio(await tres.textContent())
  comprobar(textoTresTodo.includes('De 3 unidades, lleva 1 OT y 1 pasó a otro comprador: falta la de 1 unidad'),
    `${ancho}: el recorrido cuenta la que pasó y espera solo la que falta`)
  await abrirRecorrido(tres)
  await tres.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `venta-anterior-administracion-${ancho}-2-la-de-tres.png`), fullPage: ancho === 1440 })

  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  comprobar((await fila(pagina, cot.una.numero).count()) === 0, `${ancho}: la de una unidad ya no está en «Por completar»`)
  const fTres = await aLaVista(pagina, cot.tres.numero)
  const textoFila = limpio(await fTres.textContent().catch(() => ''))
  comprobar(textoFila.includes('falta 1 de 3 OT')
    && textoFila.includes(`La OT ${ots.ot2.numero} pasó a otro comprador: esa unidad ya no lleva OT.`),
  `${ancho}: la de tres sigue, con «falta 1 de 3 OT» y la nota de la que pasó («${textoFila}»)`)
  await fTres.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await pagina.screenshot({ path: join(CAPTURAS, `venta-anterior-administracion-${ancho}-3-por-completar.png`) })
  await contexto.close()
}

// ------------------------------------------------------------ 5. Ventas
for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto } = await entrar('ventas', { width: ancho, height: alto })
  const una = await laTarjeta(pagina, cot.una)
  const textoUna = await nota(una)
  comprobar(textoUna === `Su OT ${ots.ot1.numero} pasó a otro comprador: esta venta ya no lleva otra OT.`,
    `Ventas ${ancho}: su tarjeta dice de qué OT fue la venta («${textoUna}»)`)
  const tUna = limpio(await una.textContent())
  comprobar(!tUna.includes('Falta que Administración'), `Ventas ${ancho}: y no dice que la espera Administración`)
  const pUna = await pasos(una)
  comprobar(pUna.includes('OTRO_COMPRADOR:HECHO') && !pUna.some((p) => p.endsWith(':AHORA')),
    `Ventas ${ancho}: su recorrido no espera a nadie (${pUna.join(', ')})`)
  await abrirRecorrido(una)
  await una.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `venta-anterior-ventas-${ancho}-1-la-de-una-unidad.png`), fullPage: ancho === 1440 })

  const tres = await laTarjeta(pagina, cot.tres)
  const tTres = limpio(await tres.textContent())
  comprobar(tTres.includes('Falta 1 OT de 3'), `Ventas ${ancho}: la de tres dice que falta 1 OT de 3 («${tTres.match(/Falta[^.]*\./)?.[0] ?? ''}»)`)
  await contexto.close()
}

// ------------------------------------------------------------ 6. Contabilidad
for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto } = await entrar('contabilidad', { width: ancho, height: alto })
  await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`li[data-cotizacion="${cot.facturada.numero}"]`)
  await t.waitFor({ timeout: 15000 }).catch(() => {})
  const texto = limpio(await t.textContent().catch(() => ''))
  const frase = limpio(await t.locator('[data-paso-a-otro-comprador]').first().textContent({ timeout: 2000 }).catch(() => ''))
  comprobar(frase === `Su OT ${ots.ot4.numero} pasó a otro comprador: esta venta ya no lleva OT. Queda cobrar su factura, o anularla.`,
    `Contabilidad ${ancho}: la venta facturada dice que su OT pasó y que queda cobrar o anular la factura («${frase}»)`)
  comprobar(texto.startsWith('Venta cerrada') && texto.includes('Pasó a otro comprador') && texto.includes(factura.numero),
    `Contabilidad ${ancho}: con su estado y su factura ${factura.numero}`)
  comprobar(!texto.includes('Falta que Administración') && !/· falta /.test(texto),
    `Contabilidad ${ancho}: sin pedirle la OT a Administración ni decir que falta facturar`)
  comprobar((await t.getByRole('button', { name: /Registrar factura/ }).count()) === 0,
    `Contabilidad ${ancho}: y sin ofrecer otra factura`)
  const pendiente = await pagina.locator(`[data-por-facturar]`).filter({ hasText: cot.facturada.numero }).count()
  comprobar(pendiente === 0, `Contabilidad ${ancho}: no está entre las que esperan factura`)
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: Facturación no se desliza de costado (${desliza} px)`)
  }
  await t.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
  await pagina.evaluate(() => window.scrollBy(0, -80))
  await pagina.screenshot({ path: join(CAPTURAS, `venta-anterior-contabilidad-${ancho}-facturacion.png`) })
  await contexto.close()
}

// ------------------------------------------------------------ 7. Tesorería
for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto } = await entrar('tesoreria', { width: ancho, height: alto })
  await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`[data-cotizacion="${cot.facturada.numero}"]`).first()
  const texto = limpio(await t.textContent({ timeout: 15000 }).catch(() => ''))
  comprobar(texto.startsWith('Venta cerrada') && texto.includes('Pasó a otro comprador'),
    `Tesorería ${ancho}: la venta cerrada dice que pasó a otro comprador («${texto.slice(0, 120)}»)`)
  comprobar(!texto.includes('de la cotización') && !texto.includes('Falta cargar la OT'),
    `Tesorería ${ancho}: sin el % de la cotización ni «Falta cargar la OT»`)
  await t.evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
  await pagina.screenshot({ path: join(CAPTURAS, `venta-anterior-tesoreria-${ancho}-por-cobrar.png`) })
  await contexto.close()
}

// ------------------------------------------------------------ 8. La venta que se reabrió
// Administración la ve esperando su OT otra vez, sin botón para cancelarla.
{
  const { pagina, contexto } = await entrar('administracion')
  const t = await laTarjeta(pagina, cot.reabierta)
  const aviso = limpio(await t.locator('[data-venta-reabierta]').textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(aviso.includes(`Su OT ${ots.ot5.numero} pasó a otro comprador y allí se anuló: la venta volvió a esperar su OT.`)
    && aviso.includes('Antes de cargarle otra OT, confirma con') && aviso.includes('si la venta sigue'),
  `Administración: la venta reabierta dice qué OT se anuló y con quién confirmar antes de cargarla («${aviso}»)`)
  comprobar((await t.getByRole('button', { name: 'Cancelar la venta' }).count()) === 0, 'Administración: sin «Cancelar la venta»')
  comprobar((await t.getByRole('button', { name: 'Dar código y cargar la OT' }).count()) === 1, 'Administración: y puede cargarle su OT otra vez')
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  const f = await aLaVista(pagina, cot.reabierta.numero)
  const textoFila = limpio(await f.textContent().catch(() => ''))
  comprobar(textoFila.includes(`La OT ${ots.ot5.numero} había pasado a otro comprador y allí se anuló`) && textoFila.includes('confirma con Ventas si la venta sigue'),
    `Administración: vuelve a «Por completar» diciendo que la OT había pasado y se anuló («${textoFila}»)`)
  // La del otro comprador también espera su OT, con la nota de siempre: no son dos filas iguales.
  const otra = limpio(await (await aLaVista(pagina, cot.nuevar.numero)).textContent().catch(() => ''))
  comprobar(otra.includes(`Su OT ${ots.ot5.numero} se anuló`) && !otra.includes('había pasado'),
    `Administración: la del otro comprador dice «Su OT ${ots.ot5.numero} se anuló» («${otra}»)`)
  // La que se cerró otra vez no figura como reabierta ni vuelve a «Por completar».
  comprobar((await fila(pagina, cot.otravez.numero).count()) === 0, 'Administración: la que se cerró otra vez no está en «Por completar»')
  const cerrada = await laTarjeta(pagina, cot.otravez)
  comprobar((await cerrada.locator('[data-venta-reabierta]').count()) === 0
    && (await nota(cerrada)).includes(`Su OT ${ots.ot7.numero} pasó a otro comprador`)
    && (await cerrada.getByRole('button', { name: 'Dar código y cargar la OT' }).count()) === 0,
  `Administración: su tarjeta dice que la OT ${ots.ot7.numero} pasó a otro comprador, sin «volvió a esperar su OT» ni botón de carga`)
  await contexto.close()
}
// A Ventas le sale entre lo que le toca.
{
  const { pagina, contexto } = await entrar('ventas')
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const cuerpo = limpio(await pagina.locator('body').textContent())
  // Contra la base, con su rol: el banco lo comparten otras pruebas con esta cuenta.
  const [{ n }] = await como('ventas', `select count(*)::int as n from public.v_cotizaciones_pdf
                                         where estado = 'APROBADA' and registrado_por = $1 and reabierta_por_ot_anulada is not null`, [ids.ventas])
  const frase = n === 1 ? '1 venta tuya que volvió a esperar su OT: decide si sigue' : `${n} ventas tuyas que volvieron a esperar su OT: decide si siguen`
  comprobar(n >= 1 && cuerpo.includes(frase), `Ventas: en Inicio le sale «${frase}»`)
  // Su enlace lleva a las aprobadas suyas que esperan OT, con las reabiertas primero.
  await pagina.goto(`${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT&de=mias`, { waitUntil: 'networkidle' })
  const primeras = await pagina.locator('li.scroll-mt-20[id]').evaluateAll((l) => l.map((e) => Boolean(e.querySelector('[data-venta-reabierta]'))))
  comprobar(primeras.length >= n && primeras.slice(0, n).every(Boolean) && !primeras.slice(n).some(Boolean),
    `Ventas: en esa lista las ${n} reabiertas van primero (${primeras.slice(0, n + 2).join(', ')})`)
  await contexto.close()
}
// Ventas, que la registró, la cancela: en el teléfono mira, en el monitor cancela.
for (const [ancho, alto] of [[390, 844], [1440, 900]]) {
  const { pagina, contexto } = await entrar('ventas', { width: ancho, height: alto })
  const t = await laTarjeta(pagina, cot.reabierta)
  const aviso = limpio(await t.locator('[data-venta-reabierta]').textContent({ timeout: 3000 }).catch(() => ''))
  comprobar(aviso.includes(`Su OT ${ots.ot5.numero} pasó a otro comprador y allí se anuló`) && aviso.includes('cancélala con «Cancelar la venta»'),
    `Ventas ${ancho}: su venta reabierta dice qué pasó y que puede cancelarla («${aviso}»)`)
  // Una sola caja de aviso: la de la venta reabierta ya dice quién la destraba.
  comprobar(!limpio(await t.textContent()).includes('Falta que Administración le dé su código interno'),
    `Ventas ${ancho}: la reabierta no repite el aviso de la que espera su código`)
  const boton = t.getByRole('button', { name: 'Cancelar la venta', exact: true })
  comprobar((await boton.count()) === 1, `Ventas ${ancho}: ofrece «Cancelar la venta»`)
  await boton.click()
  const formulario = t.locator('form[data-cancelar-venta]')
  await formulario.waitFor({ timeout: 5000 }).catch(() => {})
  comprobar((await formulario.getByLabel('Por qué se cancela la venta').count()) === 1
    && limpio(await formulario.textContent()).includes('Al menos 10 caracteres'),
  `Ventas ${ancho}: el motivo lleva su etiqueta y dice el mínimo`)
  if (ancho === 390) {
    const desliza = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(desliza <= 390, `390: la tarjeta con el formulario abierto no se desliza de costado (${desliza} px)`)
    // El formulario se trae a la vista: sus dos botones quedan sobre la barra de abajo.
    await pagina.waitForTimeout(400)
    const aLaVistaLosDos = await formulario.evaluate((f) => {
      const barra = [...document.querySelectorAll('nav')].map((n) => n.getBoundingClientRect()).filter((r) => r.top > window.innerHeight / 2)
      const tope = barra.length ? Math.min(...barra.map((r) => r.top)) : window.innerHeight
      return [...f.querySelectorAll('button')].every((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= tope })
    })
    comprobar(aLaVistaLosDos, '390: «Sí, cancelar la venta» y «No cancelar» quedan a la vista, sobre la barra de abajo')
    await pagina.screenshot({ path: join(CAPTURAS, 'venta-anterior-ventas-390-2-cancelar-la-venta.png') })
    // «No cancelar» cierra y devuelve el cursor al botón.
    await formulario.getByRole('button', { name: 'No cancelar' }).click()
    const foco = await pagina.evaluate(() => (document.activeElement?.textContent ?? '').replace(/\s+/g, ' ').trim())
    comprobar(foco === 'Cancelar la venta', `390: «No cancelar» devuelve el cursor a «Cancelar la venta» («${foco}»)`)
  } else {
    await t.evaluate((e) => e.scrollIntoView({ block: 'start' }))
    await pagina.evaluate(() => window.scrollBy(0, -80))
    await pagina.screenshot({ path: join(CAPTURAS, 'venta-anterior-ventas-1440-2-cancelar-la-venta.png'), fullPage: true })
  }
  if (ancho === 1440) {
    // Sin el mínimo del navegador, un motivo corto lo rechaza el servidor y lo escrito queda.
    await formulario.locator('textarea[name="motivo"]').evaluate((e) => e.removeAttribute('minlength'))
    await formulario.locator('textarea[name="motivo"]').fill('corto')
    await formulario.getByRole('button', { name: 'Sí, cancelar la venta' }).click()
    const rechazo = limpio(await formulario.locator('[role="alert"]').textContent({ timeout: 10000 }).catch(() => ''))
    const campo = formulario.locator('textarea[name="motivo"]')
    comprobar(rechazo.includes('al menos 10 caracteres') && (await campo.inputValue()) === 'corto'
      && (await campo.getAttribute('aria-invalid')) === 'true'
      && (await campo.evaluate((e) => e === document.activeElement)),
    `Ventas: el motivo corto se rechaza en su campo, con el cursor ahí, y lo escrito queda («${rechazo}»)`)
    const sigue = await uno('select estado::text as estado from public.cotizaciones_pdf where id = $1', [cot.reabierta.id])
    comprobar(sigue.estado === 'APROBADA', 'Ventas: y la cotización sigue aprobada')
    // Tres toques: una sola anulación.
    const motivo = `El cliente desistió de la compra (banco ${sello})`
    await formulario.locator('textarea[name="motivo"]').fill(motivo)
    // Otra pestaña con el formulario abierto y otro motivo: se envía después de que esta cancele.
    const otra = await contexto.newPage()
    const tOtra = await laTarjeta(otra, cot.reabierta)
    await tOtra.getByRole('button', { name: 'Cancelar la venta', exact: true }).click()
    await tOtra.locator('form[data-cancelar-venta] textarea[name="motivo"]').fill('Otro motivo, escrito en la segunda pestaña')
    // Los envíos se cuentan: la función contesta «ok» al mismo motivo repetido, y la base sola no los distingue.
    let envios = 0
    pagina.on('request', (q) => { if (q.method() === 'POST' && q.headers()['next-action']) envios += 1 })
    const enviar = formulario.getByRole('button', { name: 'Sí, cancelar la venta' })
    await enviar.click()
    await enviar.click({ timeout: 1000 }).catch(() => {})
    await enviar.click({ timeout: 1000 }).catch(() => {})
    // Cancelada, la pantalla va sola a «Anuladas», a su tarjeta: no desaparece sin decir nada.
    await pagina.waitForURL((u) => u.searchParams.get('estado') === 'ANULADA', { timeout: 20000 }).catch(() => {})
    await pagina.waitForLoadState('networkidle')
    comprobar(envios === 1, `Ventas: tres toques, un solo envío (${envios})`)
    const quedo = await uno('select c.estado::text as estado, c.motivo_anulacion, c.anulado_por from public.cotizaciones_pdf c where c.id = $1', [cot.reabierta.id])
    comprobar(quedo.estado === 'ANULADA' && quedo.motivo_anulacion === motivo && quedo.anulado_por === ids.ventas,
      `Ventas: «Cancelar la venta» anula la cotización con su motivo y su nombre (${quedo.estado}, «${quedo.motivo_anulacion}»)`)
    const aqui = new URL(pagina.url())
    const anulada = pagina.locator(`li[id="${cot.reabierta.id}"]`)
    const texto = limpio(await anulada.textContent({ timeout: 10000 }).catch(() => ''))
    comprobar(aqui.searchParams.get('estado') === 'ANULADA' && aqui.hash === `#${cot.reabierta.id}`
      && texto.includes('Anulada') && texto.includes(motivo) && (await anulada.getByRole('button', { name: 'Cancelar la venta' }).count()) === 0,
    `Ventas: cancelada, la pantalla va a «Anuladas», a su tarjeta, con el motivo y sin más botón (${aqui.search}${aqui.hash})`)
    // El reenvío con otro motivo (la otra pestaña): el motivo no cambia, y la línea de arriba dice que lo de ahora no se guardó, con el camino a la tarjeta.
    await tOtra.locator('form[data-cancelar-venta]').getByRole('button', { name: 'Sí, cancelar la venta' }).click()
    const linea = otra.locator('[data-ida-que-no-salio="ya-habia-quedado"]')
    const dicho = limpio(await linea.textContent({ timeout: 20000 }).catch(() => ''))
    const sigue2 = await uno('select c.motivo_anulacion from public.cotizaciones_pdf c where c.id = $1', [cot.reabierta.id])
    comprobar(dicho.includes('ya estaba cancelada desde tu primer envío: el motivo que escribiste ahora no se guardó') && sigue2.motivo_anulacion === motivo,
      `Ventas: el reenvío con otro motivo dice que ya estaba cancelada y que lo de ahora no se guardó; el motivo no cambia («${dicho}»)`)
    await linea.getByRole('link', { name: 'Ver la anulada' }).click()
    await otra.waitForURL((u) => u.searchParams.get('estado') === 'ANULADA', { timeout: 20000 }).catch(() => {})
    const enOtra = limpio(await otra.locator(`li[id="${cot.reabierta.id}"]`).textContent({ timeout: 10000 }).catch(() => ''))
    comprobar(enOtra.includes('Anulada') && enOtra.includes(motivo), 'Ventas: y «Ver la anulada» lleva a su tarjeta, con el primer motivo')
    await otra.close()
    // Y ya no está entre las vigentes.
    await pagina.goto(`${BASE}/cotizaciones/pdf?q=${encodeURIComponent(cot.reabierta.numero)}`, { waitUntil: 'networkidle' })
    comprobar((await pagina.locator(`li[id="${cot.reabierta.id}"]`).count()) === 0, 'Ventas: y sale de la lista de las vigentes')
    await pagina.goto(`${BASE}/cotizaciones/pdf?estado=ANULADA&q=${encodeURIComponent(cot.reabierta.numero)}`, { waitUntil: 'networkidle' })
    await anulada.evaluate((e) => e.scrollIntoView({ block: 'start' }))
    await pagina.evaluate(() => window.scrollBy(0, -80))
    await pagina.screenshot({ path: join(CAPTURAS, 'venta-anterior-ventas-1440-3-venta-cancelada.png') })
  }
  await contexto.close()
}
// Cancelada, sale de «Por completar».
{
  const { pagina, contexto } = await entrar('administracion')
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-pendientes-ot-resto] summary').click().catch(() => {})
  comprobar((await fila(pagina, cot.reabierta.numero).count()) === 0, 'Administración: la venta cancelada ya no está en «Por completar»')
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

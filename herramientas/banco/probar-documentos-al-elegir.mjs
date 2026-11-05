/**
 * El mismo campo para elegir un archivo en todo lugar que pide un documento
 * (DKS, 2026-10-21: «aplica para todo lugar que pida documento»), también
 * donde el archivo se lee o se sube apenas se elige. Con la cuenta de cada
 * puesto (nunca ADMIN), sin enviar lo que no hace falta:
 *
 *   1. Ventas, «Subir cotización»: dice qué pide y el tope; un .txt queda en
 *      rojo con el motivo y no se lee; el PDF se lee y queda en verde.
 *   2. Ventas, «Editar cotización» de una suya: lo mismo con el archivo corregido.
 *   3. Gerencia la aprueba con un toque, y Administración, en «Dar código y
 *      cargar la OT», elige el PDF de la OT: un Word con nombre «.pdf» queda en
 *      rojo («no es un PDF de verdad») y no llega a la vista previa; el PDF sí.
 *      No guarda: la cotización queda aprobada sin OT para el borde.
 *   4. Administración, el PDF de una orden sin cotización: se sube apenas se
 *      elige. El falso no sale (ni fila ni archivo en Storage); el bueno queda
 *      en la lista y el campo vuelve a pedir.
 *   5. Diseño, «Subir cronograma»: el .xls y el .xlsx dañado dicen por qué en
 *      el campo; la plantilla se lee.
 *   6. Almacén, la planilla sin internet: la foto de cada salida es el mismo
 *      campo; un GIF queda en rojo y no cuenta, la foto JPG sí.
 *   7. En el teléfono y en el monitor, sin desbordar y sin errores de consola.
 *
 * Arma sus datos ficticios (QA-DOC-…) en la base del banco. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
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
const uno = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
async function esperar(fn, ms = 15000) {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    try {
      if (await fn()) return true
    } catch {
      // Todavía no está.
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

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
const id = async (correo) => (await uno('select id from public.usuarios where correo = $1', [correo])).id
const ventas = await id('ventas.local@metalwork.test')

async function como(usuario, sql, valores = []) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [usuario])
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// Una cotización de Ventas que espera a Gerencia: se corrige y se aprueba sin enviar.
const numeroCot = `QA-DOC-${sello}`
const cliente = (await uno(`select id from public.clientes order by creado_en limit 1`)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id
const cotId = (await uno('select gen_random_uuid() as id')).id
await como(ventas, `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                                          mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                     values ($1, $2, $3, $4, $5, $6, 'application/pdf', 1000, $7, 1000, 'PEN')`,
[cotId, numeroCot, cliente, carroceria, `${numeroCot}.pdf`, `cot/${cotId}/${numeroCot}.pdf`, ventas])

// Una orden sin cotización y abierta: ahí van el PDF de la orden
// (Administración) y el cronograma (Diseño). Siempre la misma de las de
// demostración, la primera, para no ir gastando otras en cada vuelta: el PDF
// se puede subir aunque ya tenga uno.
const orden = await uno(`select id, numero, plan_etapas_manual from public.ordenes_trabajo
                          where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR')
                          order by numero limit 1`)
if (!orden) {
  console.error('FALLA · no hay ninguna orden abierta sin cotización en el banco: corre preparar.sh.')
  process.exit(1)
}
// El cronograma es de las órdenes de antes del plan manual: toda orden nueva
// nace manual y la base no deja cambiarlo. En el banco, y solo aquí, esa
// orden vuelve a ser «de antes» con los disparadores apagados.
if (orden.plan_etapas_manual) {
  await base.query('begin')
  await base.query(`set local session_replication_role = replica`)
  await base.query(`update public.ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
  await base.query('commit')
}

// Archivos.
const PDF = join(CAPTURAS, `COTIZACION-${numeroCot}.pdf`)
writeFileSync(PDF, pdfConTexto([`COTIZACION ${numeroCot}`, 'CLIENTE: BANCO', 'TOTAL S/ 1,180.00']))
const PDF_OT = join(CAPTURAS, `OT-DOC-${sello}.pdf`)
writeFileSync(PDF_OT, pdfConTexto([`ORDEN DE TRABAJO N ${sello}`, 'Reparación de tolva']))
const pdfDeLaOrden = (tam) => {
  const ruta = join(CAPTURAS, `OT-DOC-${sello}-${tam}.pdf`)
  writeFileSync(ruta, pdfConTexto([`ORDEN DE TRABAJO N ${sello}`, `Subida a ${tam}`]))
  return ruta
}
const TXT = join(CAPTURAS, `NOTAS-DE-LA-COTIZACION-${sello}.txt`)
writeFileSync(TXT, 'Esto es texto, no una cotización.\n')
const WORD_COMO_PDF = { name: `OT-FALSA-${sello}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('PK\u0003\u0004 un Word con otro nombre') }
const XLS = { name: 'cronograma-viejo.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('D0CF11E0 libro viejo') }
const XLSX_DANADO = { name: 'cronograma-danado.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK esto no es un zip') }
const PLANTILLA = join(process.cwd(), 'public/plantillas/cronograma-actividades.xlsx')
const GIF = { name: 'salida.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }
const JPG = { name: `salida-${sello}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64') }

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(correo, viewport) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima', acceptDownloads: true })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'load' })
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
async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'load' })
  await quieta(pagina)
}
/** Lo que dice la caja del campo (el padre del `<input>`). */
const caja = (input) => input.locator('xpath=..')
const dice = async (input) => limpio(await caja(input).innerText())
/** Espera a que la caja diga algo. Con `innerText`: lo de `getByText` incluye el «toca» escondido. */
const esperarQueDiga = async (input, patron, ms = 15000) => {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    const texto = await dice(input).catch(() => '')
    if (typeof patron === 'string' ? texto.includes(patron) : patron.test(texto)) return
    await new Promise((r) => setTimeout(r, 200))
  }
}
const invalido = async (input) => (await input.getAttribute('aria-invalid')) === 'true'
const desborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
/** Que el control del navegador no se vea: transparente y tapando la caja. */
const oculto = (input) => input.evaluate((e) => getComputedStyle(e).opacity === '0')

// La salida de Almacén necesita un material con saldo de los que lista su
// planilla (activos y con su unidad). En una base recién armada no hay ninguno:
// se ingresa como Almacén, con su permiso, como en probar-documentos-en-el-borde.mjs.
if (!(await uno(`select 1 as hay from public.v_existencias_materiales e join public.materiales m on m.id = e.material_id
                  where e.disponible >= 2 and m.activo and not m.unidad_pendiente limit 1`))) {
  const material = await uno(`select id from public.materiales where activo and not unidad_pendiente order by codigo limit 1`)
  const { id: almacenero } = await uno(`select id from public.usuarios where lower(correo) = 'almacen.local@metalwork.test'`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [almacenero])
    await base.query('set local role authenticated')
    await base.query(`select public.registrar_ingreso_almacen(gen_random_uuid(), $1, 10, 'INGRESO_GENERAL', 'Ingreso del banco', 1, 'PEN')`, [material.id])
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const movil = viewport.width < 500
  const tam = movil ? '390' : '1440'
  // El campo dice «toca» en el teléfono y «haz clic» con ratón.
  const accion = movil ? 'toca' : 'haz clic'
  const listo = new RegExp(`${accion} para cambiarlo`)
  console.log(movil ? '\nTeléfono, 390 × 844' : '\nMonitor, 1440 × 900')

  // ------------------------------------------------ 1 y 2. Ventas
  {
    const { pagina, contexto } = await entrar('ventas.local@metalwork.test', viewport)
    await ir(pagina, '/cotizaciones/pdf')
    await pagina.getByRole('button', { name: 'Subir cotización' }).click()
    const v = pagina.getByRole('dialog')
    await v.waitFor()
    const campo = v.locator('#cot-archivo')
    comprobar(await oculto(campo), `[Ventas ${tam}] el botón del navegador no se ve`)
    comprobar((await dice(campo)).includes('Elegir el PDF o el Word') && (await dice(campo)).includes('PDF o Word, hasta 20 MB'),
      `[Ventas ${tam}] «Subir cotización» dice qué pide y el tope: «${await dice(campo)}»`)
    // Con todo vacío, el navegador revisa en el orden en que se ve: primero la cotización.
    await v.getByRole('button', { name: 'Subir y mandar a Gerencia' }).click()
    await esperarQueDiga(campo, 'Falta', 5000)
    comprobar((await dice(campo)).includes('Falta la cotización') || (await dice(campo)).includes('Falta el PDF o el Word'),
      `[Ventas ${tam}] sin nada, lo primero que dice que falta es la cotización, en su campo: «${await dice(campo)}»`)
    comprobar(await campo.evaluate((e) => e === document.activeElement) && (await invalido(campo)), `[Ventas ${tam}] y el foco queda ahí`)
    await campo.setInputFiles(TXT)
    await esperarQueDiga(campo, `No es un PDF ni un Word: ${accion} para elegir otro`, 5000)
    comprobar((await dice(campo)).includes(`NOTAS-DE-LA-COTIZACION-${sello}.txt`) && (await dice(campo)).includes('No es un PDF ni un Word'),
      `[Ventas ${tam}] el .txt se ve entero y dice por qué no sirve`)
    comprobar(await invalido(campo), `[Ventas ${tam}] y queda marcado`)
    comprobar(!limpio(await v.innerText()).includes('Leído del archivo'), `[Ventas ${tam}] y no se intenta leer`)
    await campo.setInputFiles({ name: `VACIA-${sello}.pdf`, mimeType: 'application/pdf', buffer: Buffer.alloc(0) })
    await esperarQueDiga(campo, 'Está vacío', 5000)
    comprobar((await dice(campo)).includes(`Está vacío: ${accion} para elegir otro`) && (await invalido(campo)),
      `[Ventas ${tam}] un PDF de 0 bytes dice que está vacío: «${await dice(campo)}»`)
    await campo.setInputFiles(PDF)
    await esperarQueDiga(campo, listo, 60000)
    comprobar((await dice(campo)).includes(`COTIZACION-${numeroCot}.pdf`) && new RegExp(`\\d+(\\.\\d)? (KB|MB) · ${accion} para cambiarlo`).test(await dice(campo)),
      `[Ventas ${tam}] el PDF se lee y queda con su peso: «${await dice(campo)}»`)
    comprobar(!(await invalido(campo)), `[Ventas ${tam}] y ya no queda marcado`)
    comprobar((await v.locator('#cot-monto').inputValue()) === '1180.00', `[Ventas ${tam}] y lo leyó: el total sale del PDF`)
    comprobar((await desborde(pagina)) <= 0, `[Ventas ${tam}] sin desborde`)
    await pagina.screenshot({ path: `${CAPTURAS}/doc-ventas-subir-${tam}.png` })
    await v.getByRole('button', { name: 'Cancelar' }).click()
    await v.waitFor({ state: 'hidden' })

    // La suya, que espera a Gerencia.
    const tarjeta = pagina.locator('li').filter({ hasText: numeroCot }).first()
    await tarjeta.getByRole('button', { name: 'Editar cotización' }).click()
    const c = pagina.getByRole('dialog')
    await c.waitFor()
    const corregido = c.locator('[id^="corregir-archivo-"]')
    comprobar((await dice(corregido)).includes('Elegir el archivo corregido') && (await dice(corregido)).includes('PDF o Word, hasta 20 MB'),
      `[Ventas ${tam}] «Editar cotización» dice qué pide y el tope`)
    await corregido.setInputFiles(TXT)
    comprobar((await dice(corregido)).includes('No es un PDF ni un Word') && (await invalido(corregido)), `[Ventas ${tam}] el .txt corregido queda en rojo con el motivo`)
    await corregido.setInputFiles(PDF)
    await esperarQueDiga(corregido, listo, 60000)
    comprobar(listo.test(await dice(corregido)) && !(await invalido(corregido)), `[Ventas ${tam}] el PDF corregido se lee y queda en verde`)
    await pagina.screenshot({ path: `${CAPTURAS}/doc-ventas-corregir-${tam}.png` })
    await contexto.close()
  }

  // ------------------------------------------------ 3. Gerencia aprueba; Administración carga la OT
  if ((await uno('select estado from public.cotizaciones_pdf where id = $1', [cotId])).estado === 'POR_REVISAR') {
    const { pagina, contexto } = await entrar('gerencia.local@metalwork.test', viewport)
    await ir(pagina, '/cotizaciones/pdf')
    const tarjeta = pagina.locator('li').filter({ hasText: numeroCot }).first()
    await tarjeta.getByRole('button', { name: 'Aprobar', exact: true }).click()
    await esperar(async () => (await uno('select estado from public.cotizaciones_pdf where id = $1', [cotId])).estado === 'APROBADA', 15000)
    comprobar((await uno('select estado from public.cotizaciones_pdf where id = $1', [cotId])).estado === 'APROBADA' && (await pagina.getByRole('dialog').count()) === 0,
      `[Gerencia ${tam}] «Aprobar» la aprueba con un toque, sin pedir el PDF de la OT`)
    await contexto.close()
  }
  {
    const { pagina, contexto } = await entrar('administracion.local@metalwork.test', viewport)
    await ir(pagina, '/cotizaciones/pdf?estado=APROBADA_SIN_OT')
    const tarjeta = pagina.locator('li').filter({ hasText: numeroCot }).first()
    await tarjeta.getByRole('button', { name: 'Dar código y cargar la OT' }).click()
    const v = pagina.getByRole('dialog')
    await v.waitFor()
    const campo = v.locator('[id^="aprobar-pdf-"]')
    comprobar((await dice(campo)).includes('Elegir el PDF de la OT') && (await dice(campo)).includes('Solo PDF, hasta 20 MB'),
      `[Administración ${tam}] «Dar código y cargar la OT» dice qué pide y el tope: «${await dice(campo)}»`)
    await campo.setInputFiles(WORD_COMO_PDF)
    await esperarQueDiga(campo, 'Está dañado o no es un PDF de verdad', 5000)
    comprobar((await dice(campo)).includes(`OT-FALSA-${sello}.pdf`) && (await dice(campo)).includes('Está dañado o no es un PDF de verdad'),
      `[Administración ${tam}] un Word con nombre «.pdf» se ve y dice por qué no sirve`)
    comprobar(await invalido(campo), `[Administración ${tam}] y queda marcado`)
    comprobar(limpio(await v.innerText()).includes('El PDF aparecerá aquí al seleccionarlo.'), `[Administración ${tam}] y no llega a la vista previa`)
    await campo.setInputFiles(PDF_OT)
    await esperarQueDiga(campo, listo, 60000)
    comprobar((await dice(campo)).includes(`OT-DOC-${sello}.pdf`) && !(await invalido(campo)), `[Administración ${tam}] el PDF de la OT queda en verde`)
    comprobar(!limpio(await v.innerText()).includes('El PDF aparecerá aquí al seleccionarlo.'), `[Administración ${tam}] y se ve en la vista previa`)
    comprobar((await desborde(pagina)) <= 0, `[Administración ${tam}] sin desborde`)
    await pagina.screenshot({ path: `${CAPTURAS}/doc-administracion-cargar-ot-${tam}.png` })
    await contexto.close()
  }

  // ------------------------------------------------ 4. Administración, el PDF de la orden
  {
    const { pagina, contexto } = await entrar('administracion.local@metalwork.test', viewport)
    await ir(pagina, `/ordenes/${orden.id}`)
    const campo = pagina.locator(`#subir-pdf-${orden.id}`)
    const cambiar = pagina.getByRole('button', { name: 'Cambiar el PDF' })
    const yaTiene = async () =>
      (await uno(`select count(*)::int as n from public.ot_adjuntos where orden_id = $1 and tipo = 'ORDEN'`, [orden.id])).n > 0
    // Con el PDF ya puesto no hay un campo vacío que parezca decir que falta:
    // «Cambiar el PDF» lo abre y «No cambiarlo» lo cierra.
    const tenia = await yaTiene()
    if (tenia) {
      await cambiar.waitFor({ timeout: 30000 }).catch(() => {})
      comprobar((await campo.count()) === 0 && (await cambiar.count()) === 1,
        `[Administración ${tam}] la orden ${orden.numero} ya tiene su PDF: no pide otro, ofrece «Cambiar el PDF»`)
      await cambiar.click()
      await campo.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
      comprobar(await campo.evaluate((e) => e === document.activeElement).catch(() => false), `[Administración ${tam}] «Cambiar el PDF» lleva el foco al campo`)
      await pagina.getByRole('button', { name: 'No cambiarlo' }).click()
      comprobar((await campo.count()) === 0, `[Administración ${tam}] «No cambiarlo» lo vuelve a cerrar`)
      comprobar(await cambiar.evaluate((e) => e === document.activeElement).catch(() => false), `[Administración ${tam}] y el foco vuelve a «Cambiar el PDF»`)
      await cambiar.click()
    }
    await campo.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {})
    const pide = tenia ? 'Subir el PDF corregido' : 'Subir el PDF de la orden'
    comprobar((await dice(campo)).includes(pide) && (await dice(campo)).includes('Solo PDF, hasta 20 MB'),
      `[Administración ${tam}] la orden ${orden.numero} pide su PDF en el mismo campo: «${await dice(campo)}»`)
    const cuantos = async () => ({
      archivos: (await uno(`select count(*)::int as n from storage.objects where bucket_id = 'adjuntos-ot' and name like $1`, [`ot/${orden.id}/%`])).n,
      filas: (await uno(`select count(*)::int as n from public.ot_adjuntos where orden_id = $1`, [orden.id])).n,
    })
    const antes = await cuantos()
    await campo.setInputFiles(WORD_COMO_PDF)
    await esperarQueDiga(campo, 'Está dañado o no es un PDF de verdad', 5000)
    await pagina.waitForTimeout(800)
    comprobar((await dice(campo)).includes('Está dañado o no es un PDF de verdad') && (await invalido(campo)),
      `[Administración ${tam}] el falso queda en rojo con el motivo`)
    const despues = await cuantos()
    comprobar(despues.archivos === antes.archivos && despues.filas === antes.filas, `[Administración ${tam}] y no se sube: ni archivo en Storage ni fila`)
    const bueno = pdfDeLaOrden(tam)
    const nombre = `OT-DOC-${sello}-${tam}.pdf`
    await campo.setInputFiles(bueno)
    await pagina.locator('ul').getByText(nombre).waitFor({ timeout: 30000 }).catch(() => {})
    const fila = await uno(`select count(*)::int as n from public.ot_adjuntos where orden_id = $1 and tipo = 'ORDEN' and nombre_archivo = $2`, [orden.id, nombre])
    comprobar(fila.n === 1, `[Administración ${tam}] el bueno se sube apenas se elige y queda en la orden`)
    await cambiar.waitFor({ timeout: 15000 }).catch(() => {})
    comprobar((await campo.count()) === 0 && (await cambiar.count()) === 1, `[Administración ${tam}] y el campo se cierra: queda «Cambiar el PDF»`)
    if (tenia) {
      await pagina.getByText('Vigente', { exact: true }).waitFor({ timeout: 15000 }).catch(() => {})
      const filaNueva = pagina.locator('li').filter({ hasText: nombre })
      // La lista va en su propia zona, y la nota debajo: se lee el cuerpo de la tarjeta.
      const tarjeta = limpio(await pagina.locator('ul').filter({ hasText: nombre }).locator('xpath=../..').innerText())
      comprobar((await filaNueva.getByText('Vigente', { exact: true }).count()) === 1 && /Quita (el anterior|los anteriores)/.test(tarjeta),
        `[Administración ${tam}] el corregido sale «Vigente» y dice qué quitar: «${(tarjeta.match(/Vale el marcado[^.]*\./) ?? [''])[0]}»`)
    }
    comprobar((await desborde(pagina)) <= 0, `[Administración ${tam}] sin desborde`)
    await pagina.locator('ul').getByText(nombre).evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await pagina.screenshot({ path: `${CAPTURAS}/doc-administracion-pdf-orden-${tam}.png` })
    await contexto.close()
  }

  // ------------------------------------------------ 5. Diseño, el cronograma
  {
    const { pagina, contexto } = await entrar('diseno.local@metalwork.test', viewport)
    await ir(pagina, `/ordenes/${orden.id}?vista=actividades`)
    const boton = pagina.getByRole('button', { name: 'Subir cronograma' })
    comprobar((await boton.count()) > 0, `[Diseño ${tam}] la orden ofrece «Subir cronograma»`)
    if (await boton.count()) {
      await boton.click()
      const v = pagina.getByRole('dialog')
      await v.waitFor()
      const campo = v.locator(`#cronograma-${orden.id}`)
      comprobar((await dice(campo)).includes('Elegir el Excel del cronograma') && (await dice(campo)).includes('Solo Excel (.xlsx), hasta 20 MB'),
        `[Diseño ${tam}] dice qué pide y el tope: «${await dice(campo)}»`)
      await campo.setInputFiles(XLS)
      comprobar((await dice(campo)).includes('Es un .xls: guárdalo como «Libro de Excel» (.xlsx)') && (await invalido(campo)),
        `[Diseño ${tam}] el .xls dice cómo arreglarlo`)
      await campo.setInputFiles(XLSX_DANADO)
      await esperarQueDiga(campo, 'No se pudo leer')
      comprobar((await dice(campo)).includes('No se pudo leer') && (await invalido(campo)), `[Diseño ${tam}] el .xlsx dañado dice que no se pudo leer`)
      await campo.setInputFiles(PLANTILLA)
      await esperarQueDiga(campo, listo)
      const texto = limpio(await v.innerText())
      comprobar((await dice(campo)).includes('cronograma-actividades.xlsx') && listo.test(await dice(campo)),
        `[Diseño ${tam}] la plantilla se lee: «${await dice(campo)}»`)
      comprobar(/\d+ actividad/.test(texto) || texto.includes('Falta'), `[Diseño ${tam}] y muestra lo que se va a cargar`)
      comprobar((await desborde(pagina)) <= 0, `[Diseño ${tam}] sin desborde`)
      await pagina.screenshot({ path: `${CAPTURAS}/doc-diseno-cronograma-${tam}.png` })

      // Diseño carga uno y guarda su Excel en la orden (migración 20261022113000):
      // antes el cronograma entraba y el Excel no, con «revisa la señal».
      const libroCronograma = new ExcelJS.Workbook()
      const hoja = libroCronograma.addWorksheet('Cronograma')
      hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
      hoja.addRow(['Acabados', `Banco ${sello} ${tam}`, null, 0, null, null])
      const propio = join(CAPTURAS, `cronograma-${sello}-${tam}.xlsx`)
      await libroCronograma.xlsx.writeFile(propio)
      const guardadosAntes = (await uno(`select count(*)::int as n from public.ot_adjuntos where orden_id = $1 and tipo = 'CRONOGRAMA'`, [orden.id])).n
      await campo.setInputFiles(propio)
      const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
      await cargar.waitFor({ timeout: 15000 }).catch(() => {})
      comprobar(await v.getByLabel('Guardar también el Excel en la orden').isChecked(), `[Diseño ${tam}] «Guardar también el Excel» viene marcado`)
      await cargar.click()
      await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
      await pagina.waitForTimeout(1500)
      const avisoCarga = limpio(await pagina.locator('main').innerText())
      const guardado = await uno(
        `select count(*)::int as n from public.ot_adjuntos a join public.usuarios u on u.id = a.subido_por
          where a.orden_id = $1 and a.tipo = 'CRONOGRAMA' and u.correo = 'diseno.local@metalwork.test'`, [orden.id])
      const totalDespues = (await uno(`select count(*)::int as n from public.ot_adjuntos where orden_id = $1 and tipo = 'CRONOGRAMA'`, [orden.id])).n
      comprobar(totalDespues === guardadosAntes + 1 && guardado.n >= 1 && !avisoCarga.includes('no quedó guardado'),
        `[Diseño ${tam}] carga el cronograma y su Excel queda guardado en la orden${avisoCarga.includes('no quedó guardado') ? `: «${avisoCarga.match(/El Excel no quedó[^.]*\.[^.]*\./)?.[0]}»` : ''}`)
      await pagina.screenshot({ path: `${CAPTURAS}/doc-diseno-cronograma-guardado-${tam}.png` })
    }

    // Un campo que la pantalla no guarda (el plano de un código) también mira por dentro.
    const conCodigo = await uno(`select u.codigo_interno from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id
                                  where o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA', 'BORRADOR') and u.codigo_interno is not null
                                  order by o.numero limit 1`)
    await ir(pagina, `/diseno/codigo?codigo=${encodeURIComponent(conCodigo?.codigo_interno ?? '')}`)
    const plano = pagina.locator('#plano-pdf')
    if (await plano.count()) {
      await plano.setInputFiles(WORD_COMO_PDF)
      await esperarQueDiga(plano, 'Está dañado o no es un PDF de verdad', 5000)
      comprobar((await dice(plano)).includes('Está dañado o no es un PDF de verdad') && (await invalido(plano)),
        `[Diseño ${tam}] el plano: un Word con nombre «.pdf» queda en rojo, no en verde: «${await dice(plano)}»`)
      await plano.setInputFiles(PDF_OT)
      await esperarQueDiga(plano, listo, 5000)
      comprobar(listo.test(await dice(plano)) && !(await invalido(plano)), `[Diseño ${tam}] y un PDF de verdad queda en verde`)
    } else {
      // Una orden abierta con código la deja, en una base recién armada, probar-gerencia-aprueba-y-administracion-carga-la-ot.mjs.
      comprobar(false, `[Diseño ${tam}] el código ${conCodigo?.codigo_interno ?? '(ninguna orden abierta tiene código: corre antes probar-gerencia-aprueba-y-administracion-carga-la-ot.mjs)'} ofrece cargar un plano`)
    }
    await contexto.close()
  }

  // ------------------------------------------------ 6. Almacén, la foto de cada salida
  {
    const { pagina, contexto } = await entrar('almacen.local@metalwork.test', viewport)
    await ir(pagina, '/almacen/kardex')
    // La planilla que baja Almacén, con una salida anotada.
    const respuesta = await pagina.request.get(`${BASE}/almacen/kardex/planilla`)
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.load(await respuesta.body())
    const materiales = libro.getWorksheet('Materiales')
    let codigo = null
    materiales.eachRow((fila, n) => {
      if (n > 1 && !codigo && Number(fila.getCell(5).value) >= 1) codigo = String(fila.getCell(1).value)
    })
    let unidad = null
    libro.getWorksheet('Unidades')?.eachRow((fila, n) => {
      if (n > 1 && !unidad && fila.getCell(1).value) unidad = String(fila.getCell(1).value)
    })
    comprobar(Boolean(codigo && unidad), `[Almacén ${tam}] la planilla trae un material con saldo (${codigo}) y una unidad (${unidad})`)
    const salidas = libro.getWorksheet('Salidas')
    // El día de Lima, no el del contenedor (UTC): de 19:00 a 24:00 de Lima ya es mañana y la fila sale con error.
    const [anio, mes, dia] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
    salidas.getCell(5, 1).value = new Date(Date.UTC(anio, mes - 1, dia))
    salidas.getCell(5, 3).value = codigo
    salidas.getCell(5, 6).value = 1
    salidas.getCell(5, 7).value = `Banco ${sello}`
    salidas.getCell(5, 8).value = unidad
    salidas.getCell(5, 9).value = 'Banco'
    const llena = join(CAPTURAS, `planilla-almacen-${sello}-${tam}.xlsx`)
    await libro.xlsx.writeFile(llena)

    await pagina.getByRole('button', { name: /sin internet/i }).first().click()
    await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
    const v = pagina.getByRole('dialog')
    await v.waitFor()
    await v.locator('#planilla-archivo').setInputFiles(llena)
    const foto = v.locator('input[aria-label$="de la salida de la fila 5"]')
    await foto.waitFor({ state: 'attached', timeout: 60000 }).catch(() => {})
    comprobar((await foto.count()) === 1, `[Almacén ${tam}] la salida pide su foto`)
    if (await foto.count()) {
      comprobar((await dice(foto)).includes('Elegir la foto de la salida') && (await dice(foto)).includes('JPG, PNG o WEBP, hasta 10 MB'),
        `[Almacén ${tam}] con el mismo campo: «${await dice(foto)}»`)
      await foto.setInputFiles(GIF)
      comprobar((await dice(foto)).includes('No es una foto JPG, PNG o WEBP') && (await invalido(foto)), `[Almacén ${tam}] un GIF queda en rojo con el motivo`)
      comprobar((await v.getByRole('button', { name: /^Registrar/ }).isDisabled()), `[Almacén ${tam}] y no cuenta para registrar`)
      await foto.setInputFiles(JPG)
      comprobar((await dice(foto)).includes(`salida-${sello}.jpg`) && !(await invalido(foto)), `[Almacén ${tam}] la foto JPG queda en verde con su nombre entero`)
      comprobar(limpio(await v.getByRole('button', { name: /^Registrar/ }).innerText()) === 'Registrar 1 movimiento', `[Almacén ${tam}] y la salida ya cuenta`)
      await foto.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    }
    comprobar((await desborde(pagina)) <= 0, `[Almacén ${tam}] sin desborde`)
    await pagina.screenshot({ path: `${CAPTURAS}/doc-almacen-foto-salida-${tam}.png` })
    await contexto.close()
  }
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo en orden.')
process.exit(fallas.length ? 1 : 0)

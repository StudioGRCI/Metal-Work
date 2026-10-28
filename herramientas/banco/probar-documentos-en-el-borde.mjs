/**
 * Los bordes del campo de documentos que encontró la tercera revisión
 * (2026-10-22), con la cuenta de cada puesto (nunca ADMIN), en el teléfono y
 * en el monitor:
 *
 *   1. Almacén, planilla sin internet: si la foto de una salida no sube, queda
 *      «Registrar lo que falta» junto a «Cerrar»; con la foto otra vez, la
 *      salida entra y el ingreso no se duplica.
 *   2. Almacén, conteo inicial con el reloj del equipo un día adelantado: el
 *      rechazo del servidor va a la fecha, con el día del sistema, y el foco
 *      también; al cerrar y abrir, la fecha ya no sale en rojo.
 *   3. Administración, el PDF corregido con el mismo nombre: la nota nombra el
 *      anterior por su hora, los dos «Quitar» se distinguen, quitar el vigente
 *      avisa cuál queda, y al quitar el foco vuelve a «Cambiar el PDF». En la
 *      tarjeta, el PDF va antes que el Excel del cronograma y la hora no se parte.
 *   4. Ventas y Administración: con un archivo que no sirve, al enviar el navegador
 *      se queda en el archivo y no salta al primer campo vacío de abajo.
 *   5. Diseño, el Excel del cronograma: sin señal dice cómo volver a
 *      intentarlo; si se pierde la respuesta, no afirma que no quedó.
 *
 * Arma lo suyo con el sello QA-BORDE-… en la base del banco. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import ExcelJS from 'exceljs'
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
const uno = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]
const filas = async (sql, valores = []) => (await base.query(sql, valores)).rows

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
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

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
const TELEFONO = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 900 }
const nombreDe = (v) => (v.width < 500 ? '390' : '1440')

async function entrar(correo, viewport) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
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
/** Lo que dice la caja del campo. Con `innerText`: el «toca» escondido no cuenta. */
const dice = async (input) => limpio(await input.locator('xpath=..').innerText())
const enfocado = (pagina) => pagina.evaluate(() => {
  const e = document.activeElement
  return e ? { id: e.id, etiqueta: limpiar(e.getAttribute('aria-label') ?? e.innerText ?? '') } : null
  function limpiar(t) { return t.replace(/\s+/g, ' ').trim().slice(0, 80) }
})
const botones = async (zona) => (await zona.getByRole('button').allInnerTexts()).map(limpio).filter(Boolean)

const sello = Date.now().toString().slice(-6)
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
const PDF_MINIMO = (relleno) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n${' '.repeat(relleno)}`, 'latin1')
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const diaCorto = (iso) => iso.split('-').reverse().join('/')

// ------------------------------------------------- 1. la foto que no subió
async function fotoQueNoSubio(viewport, caso = 'no sube') {
  const tam = nombreDe(viewport) + (caso === 'no sube' ? '' : '-sin-foto')
  const { pagina: p, contexto } = await entrar('almacen.local@metalwork.test', viewport)
  await ir(p, '/almacen/kardex')
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await p.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  let codigo = null
  libro.getWorksheet('Materiales').eachRow((f, n) => {
    if (n > 1 && !codigo && Number(f.getCell(5).value) >= 2) codigo = String(f.getCell(1).value)
  })
  let unidad = null
  libro.getWorksheet('Unidades')?.eachRow((f, n) => {
    if (n > 1 && !unidad && f.getCell(1).value) unidad = String(f.getCell(1).value)
  })
  if (!codigo || !unidad) {
    comprobar(false, `[Almacén ${tam}] el banco tiene un material con saldo y una unidad para la salida`)
    await contexto.close()
    return
  }
  const [a, m, d] = hoyLima().split('-').map(Number)
  const guia = `GR QA-BORDE ${sello}-${tam}`
  const vale = `Vale QA-BORDE ${sello}-${tam}`
  const salidas = libro.getWorksheet('Salidas')
  salidas.getCell(5, 1).value = new Date(Date.UTC(a, m - 1, d))
  salidas.getCell(5, 3).value = codigo
  salidas.getCell(5, 6).value = 1
  salidas.getCell(5, 7).value = vale
  salidas.getCell(5, 8).value = unidad
  salidas.getCell(5, 9).value = 'Prueba del banco'
  const ingresos = libro.getWorksheet('Ingresos')
  let encabezado = 0
  ingresos.eachRow((f, n) => {
    if (!encabezado && String(f.getCell(1).value ?? '').toLowerCase() === 'fecha') encabezado = n
  })
  ingresos.getCell(encabezado + 1, 3).value = codigo
  ingresos.getCell(encabezado + 1, 6).value = 1
  ingresos.getCell(encabezado + 1, 8).value = guia
  const llena = join(CAPTURAS, `planilla-borde-${sello}-${tam}.xlsx`)
  await libro.xlsx.writeFile(llena)

  await p.getByRole('button', { name: /sin internet/i }).first().click()
  await p.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = p.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  const foto = v.locator('input[type=file][aria-label^="Elegir la foto de la salida"]').first()
  await foto.waitFor({ state: 'attached', timeout: 30000 })
  const estado = v.locator('[role=status]').filter({ hasText: /Se registr|No se registr/ })
  if (caso === 'sin foto') {
    // Se registra el ingreso y la salida se queda sin foto: no se cierra en verde.
    await v.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
    await esperar(async () => (await estado.count()) > 0, 30000)
    comprobar(limpio(await estado.innerText()) === 'Se registró 1 movimiento; falta la foto de 1 salida.',
      `[Almacén ${tam}] no termina en verde con una salida sin foto: «${limpio(await estado.innerText())}»`)
    comprobar((await estado.getAttribute('class')).includes('text-aviso'), `[Almacén ${tam}] en tono de aviso`)
    // El del pie, con su texto: la X de la ventana también se llama «Cerrar».
    const cerrar = v.getByRole('button').filter({ hasText: /^Cerrar$/ })
    comprobar(!(await cerrar.getAttribute('class')).includes('bg-acento'), `[Almacén ${tam}] y «Cerrar» no es el botón principal`)
    await foto.setInputFiles({ name: `salida-${sello}.jpg`, mimeType: 'image/jpeg', buffer: JPG })
    await v.getByRole('button', { name: 'Registrar lo que falta (1)' }).click()
    await esperar(async () => limpio(await estado.innerText()).startsWith('Se registraron 2'), 30000)
    comprobar(limpio(await estado.innerText()) === 'Se registraron 2 movimientos.', `[Almacén ${tam}] con la foto, la salida entra`)
    comprobar((await cerrar.getAttribute('class')).includes('bg-acento'), `[Almacén ${tam}] y ahora sí «Cerrar» es el principal`)
    await contexto.close()
    return
  }
  await foto.setInputFiles({ name: `salida-${sello}.jpg`, mimeType: 'image/jpeg', buffer: JPG })
  // La foto no sube: sin señal justo en ese momento.
  const storage = /\/storage\/v1\/object\/evidencias-almacen\//
  await p.route(storage, (r) => (r.request().method() === 'POST' ? r.abort('failed') : r.continue()))
  await v.getByRole('button', { name: 'Registrar 2 movimientos' }).click()
  await esperar(async () => (await estado.count()) > 0, 30000)
  comprobar(limpio(await estado.innerText()) === 'Se registró 1 movimiento; 1 no: revisa el mensaje de cada uno.',
    `[Almacén ${tam}] entró el ingreso y la salida no: «${limpio(await estado.innerText())}»`)
  comprobar((await dice(foto)).includes('No se pudo cargar el archivo. Revisa la señal'), `[Almacén ${tam}] la foto que no subió lo dice en su campo: «${await dice(foto)}»`)
  const pie = await botones(v)
  comprobar(pie.includes('Registrar lo que falta (1)') && pie.includes('Cerrar'),
    `[Almacén ${tam}] queda «Registrar lo que falta (1)» junto a «Cerrar»: ${JSON.stringify(pie.filter((b) => /Registrar|Cerrar/.test(b)))}`)
  await p.screenshot({ path: join(CAPTURAS, `borde-kardex-falta-${tam}.png`) })

  // Vuelve la señal y se elige la foto otra vez: sigue faltando, y lo dice.
  await p.unroute(storage)
  await foto.setInputFiles({ name: `salida-${sello}-b.jpg`, mimeType: 'image/jpeg', buffer: JPG })
  await esperar(async () => (await dice(foto)).includes(`salida-${sello}-b.jpg`), 5000)
  comprobar(limpio(await estado.innerText()) === 'Se registró 1 movimiento; falta 1.',
    `[Almacén ${tam}] con la foto otra vez no dice que terminó: «${limpio(await estado.innerText())}»`)
  comprobar((await estado.getAttribute('class')).includes('text-aviso'), `[Almacén ${tam}] y no en verde`)
  await v.getByRole('button', { name: 'Registrar lo que falta (1)' }).click()
  await esperar(async () => limpio(await estado.innerText()).startsWith('Se registraron 2'), 30000)
  comprobar(limpio(await estado.innerText()) === 'Se registraron 2 movimientos.', `[Almacén ${tam}] la salida entra: «${limpio(await estado.innerText())}»`)
  comprobar(JSON.stringify((await botones(v)).filter((b) => /Registrar|Cerrar/.test(b))) === '["Cerrar"]', `[Almacén ${tam}] y queda solo «Cerrar»`)
  const enLaBase = await filas(`select tipo, count(*)::int as n from public.movimientos_materiales
                                 where documento_referencia in ($1, $2) group by tipo order by tipo`, [guia, vale])
  comprobar(JSON.stringify(enLaBase) === JSON.stringify([{ tipo: 'INGRESO', n: 1 }, { tipo: 'SALIDA', n: 1 }]),
    `[Almacén ${tam}] en la base, un ingreso y una salida, sin duplicar: ${JSON.stringify(enLaBase)}`)
  await p.screenshot({ path: join(CAPTURAS, `borde-kardex-registrada-${tam}.png`) })
  await contexto.close()
}

// ---------------------------------------------- 2. la fecha del conteo inicial
async function relojAdelantado(viewport) {
  const tam = nombreDe(viewport)
  const manana = new Date(Date.now() + 24 * 3600 * 1000)
  const { pagina: p, contexto } = await entrar('almacen.local@metalwork.test', viewport)
  // Ya adentro: el equipo cree que es mañana; el servidor sabe que no.
  await p.clock.setFixedTime(manana)
  await ir(p, '/almacen/kardex')
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await p.request.get(`${BASE}/almacen/kardex/conteo-inicial`)).body())
  const hoja = libro.getWorksheet('Conteo')
  let encabezado = 0
  hoja.eachRow((f, n) => {
    if (!encabezado && f.values.includes('Cantidad contada')) encabezado = n
  })
  hoja.getCell(encabezado + 1, 5).value = Number(hoja.getCell(encabezado + 1, 4).value) || 0
  const lleno = join(CAPTURAS, `conteo-borde-${sello}-${tam}.xlsx`)
  await libro.xlsx.writeFile(lleno)

  await p.getByRole('button', { name: 'Conteo inicial' }).click()
  const v = p.getByRole('dialog')
  await v.waitFor()
  const fecha = v.locator('#conteo-inicial-fecha')
  const archivo = v.locator('#conteo-inicial-archivo')
  await archivo.focus()
  await archivo.setInputFiles(lleno)
  const alerta = v.locator('p[role=alert]')
  await esperar(async () => (await alerta.count()) > 0, 30000)
  const hoy = hoyLima()
  comprobar(limpio(await alerta.first().innerText()) === `La fecha del conteo es posterior a hoy, ${diaCorto(hoy)}.`,
    `[Almacén ${tam}] el servidor rechaza «mañana» en la fecha, con el día del sistema: «${limpio(await alerta.first().innerText())}»`)
  comprobar((await enfocado(p))?.id === 'conteo-inicial-fecha', `[Almacén ${tam}] y el foco va a la fecha: ${JSON.stringify(await enfocado(p))}`)
  await p.screenshot({ path: join(CAPTURAS, `borde-conteo-fecha-${tam}.png`) })
  await p.keyboard.press('Escape')
  comprobar(await esperar(async () => (await v.count()) === 0 || !(await v.isVisible()), 5000), `[Almacén ${tam}] Escape cierra la ventana`)
  await p.getByRole('button', { name: 'Conteo inicial' }).click()
  await v.waitFor()
  await p.waitForTimeout(300)
  comprobar((await alerta.count()) === 0 && !(await archivo.isDisabled()),
    `[Almacén ${tam}] al abrirla otra vez, la fecha no sigue en rojo y el Excel se puede elegir`)
  await contexto.close()
}

// ---------------------------------------------- 3. el corregido con el mismo nombre
const tarjetaOrden = (p) => p.getByRole('heading', { name: 'Orden de trabajo' }).first().locator('xpath=ancestor::div[contains(@class,"rounded")][1]')

/**
 * Una orden abierta sin cotización que ya tenga su PDF, como la que se corrige.
 * El banco recién preparado no trae ninguna: se registra una como lo hace
 * Administración, con `registrar_orden_sin_cotizacion` y su PDF en
 * `adjuntos-ot`, con la cuenta del puesto y no como ADMIN.
 */
async function ordenConUnPdf() {
  const ya = await uno(`select o.id, o.numero from public.ordenes_trabajo o
                         where o.cotizacion_pdf_id is null and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR')
                           and (select count(*) from public.ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') = 1
                         order by o.numero limit 1`)
  if (ya) return ya
  const admin = await uno(`select id from public.usuarios where correo = 'administracion.local@metalwork.test'`)
  const cliente = await uno(`select id from public.clientes order by creado_en limit 1`)
  const sede = await uno(`select id from public.sedes where codigo = 'PRIN'`)
  if (!admin || !cliente || !sede) return null
  const id = randomUUID()
  const ruta = `ot/${id}/${randomUUID()}.pdf`
  const pdf = PDF_MINIMO(800)
  const destino = join(ARCHIVOS, 'adjuntos-ot', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, pdf)
  await base.query(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('adjuntos-ot', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [ruta, admin.id, pdf.length],
  )
  // Un número libre: con solo tres cifras del sello, una tanda vieja ya lo había usado
  // («Ya hay una orden de trabajo 8062-2026»), y su orden ya no tiene un solo PDF.
  const usados = new Set((await filas(`select split_part(numero, '-', 1) as n from public.ordenes_trabajo where numero like '8___-%'`)).map((f) => f.n))
  const libre = Array.from({ length: 1000 }, (_, i) => `8${String((Number(sello.slice(-3)) + i) % 1000).padStart(3, '0')}`).find((n) => !usados.has(n))
  if (!libre) return null
  const numero = `${libre}-2026`
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: admin.id, role: 'authenticated' }), admin.id])
    await base.query('set local role authenticated')
    await base.query(
      `select public.registrar_orden_sin_cotizacion($1, $2, $3, null, $4, null, 'FABRICACION', 'NORMAL',
              'Tolva del banco para corregir su PDF', null, null, null, null, null, null, $5, 'orden-del-banco.pdf', $6)`,
      [id, numero, cliente.id, sede.id, ruta, pdf.length],
    )
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    // El PDF ya estaba en Storage: sin su orden quedaba suelto y otras suites lo contaban.
    await base.query(`delete from storage.objects where bucket_id = 'adjuntos-ot' and name = $1`, [ruta])
    console.log(`  (no se pudo registrar la orden del banco: ${e.message})`)
    return null
  }
  return { id, numero }
}

async function mismoNombre(viewport) {
  const tam = nombreDe(viewport)
  const orden = await ordenConUnPdf()
  if (!orden) {
    comprobar(false, `[Administración ${tam}] hay una orden abierta con un solo PDF`)
    return
  }
  const pdfs = () => filas(`select id, nombre_archivo, creado_en from public.ot_adjuntos where orden_id = $1 and tipo = 'ORDEN' order by creado_en`, [orden.id])
  const [original] = await pdfs()
  const { pagina: p, contexto } = await entrar('administracion.local@metalwork.test', viewport)
  await ir(p, `/ordenes/${orden.id}`)
  const cambiar = p.getByRole('button', { name: 'Cambiar el PDF' })
  await cambiar.waitFor({ timeout: 20000 })
  await cambiar.click()
  const campo = p.locator(`#subir-pdf-${orden.id}`)
  await campo.setInputFiles({ name: original.nombre_archivo, mimeType: 'application/pdf', buffer: PDF_MINIMO(1500 + Number(sello.slice(-3))) })
  await esperar(async () => (await pdfs()).length === 2, 30000)
  await esperar(async () => (await p.getByText(/Vale el marcado/).count()) > 0, 20000)
  const [anterior, nuevo] = await pdfs()
  const cuando = (fila) => p.evaluate((iso) => {
    const d = new Date(iso)
    // El mismo formato que `fechaHora`, para buscarlo en la pantalla.
    return d.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\s/g, ' ')
  }, fila.creado_en.toISOString())
  const cuandoAnterior = await cuando(anterior)
  const nota = limpio(await p.getByText(/Vale el marcado/).innerText())
  comprobar(nota.includes(`(${original.nombre_archivo}, del ${cuandoAnterior})`),
    `[Administración ${tam}] la nota nombra el anterior por su hora: «${nota}»`)
  // Los de los dos PDF: la orden puede llevar además su cronograma, con su propio «Quitar».
  const quitar = (await tarjetaOrden(p).getByRole('button', { name: /^Quitar / }).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))))
    .filter((l) => l.startsWith(`Quitar ${original.nombre_archivo},`))
  comprobar(quitar.length === 2 && quitar[0] !== quitar[1] && quitar[0].endsWith(', el vigente') && quitar[1].includes(cuandoAnterior),
    `[Administración ${tam}] los dos «Quitar» se distinguen: ${JSON.stringify(quitar)}`)
  // La hora entera en su renglón: «p. m.» no se parte.
  const partida = await tarjetaOrden(p).locator('li span.whitespace-nowrap').first().evaluate((e) => e.getClientRects().length)
  comprobar(partida === 1, `[Administración ${tam}] la fecha con la hora va en un solo renglón`)

  // Quitar el vigente avisa cuál queda; se dice que no, con el teclado.
  const filaVigente = tarjetaOrden(p).locator('li').filter({ hasText: 'Vigente' }).first()
  const tachoVigente = filaVigente.getByRole('button', { name: /el vigente$/ })
  await tachoVigente.focus()
  await p.keyboard.press('Enter')
  await p.waitForTimeout(200)
  comprobar((await enfocado(p))?.etiqueta === 'No', `[Administración ${tam}] la pregunta lleva el foco a «No», lo seguro: ${JSON.stringify(await enfocado(p))}`)
  const describe = await p.evaluate(() => {
    const id = document.activeElement?.getAttribute('aria-describedby')
    return id ? document.getElementById(id)?.innerText ?? '' : ''
  })
  comprobar(describe.startsWith('Es el vigente'), `[Administración ${tam}] y la pregunta se lee con él`)
  const aviso = limpio(await filaVigente.locator('form span').first().innerText())
  comprobar(aviso === `Es el vigente: si lo quitas, vuelve a valer el del ${cuandoAnterior} ¿Quitarlo igual?`, `[Administración ${tam}] quitar el vigente avisa cuál queda: «${aviso}»`)
  await p.screenshot({ path: join(CAPTURAS, `borde-pdf-vigente-${tam}.png`) })
  await p.keyboard.press('Enter')
  await p.waitForTimeout(200)
  comprobar(((await enfocado(p))?.etiqueta ?? '').endsWith(', el vigente'), `[Administración ${tam}] al decir que no, el foco vuelve al tacho: ${JSON.stringify(await enfocado(p))}`)

  // Se quita el anterior, como dice la nota.
  const filaAnterior = tarjetaOrden(p).locator('li').filter({ hasNotText: 'Vigente' }).filter({ hasText: original.nombre_archivo }).first()
  await filaAnterior.getByRole('button', { name: new RegExp(`del ${cuandoAnterior.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click()
  comprobar(limpio(await filaAnterior.locator('form span').first().innerText()) === '¿Quitar este archivo de la orden?', `[Administración ${tam}] el anterior se quita sin aviso de más`)
  await filaAnterior.getByRole('button', { name: 'Sí, quitar' }).click()
  await esperar(async () => (await pdfs()).length === 1, 30000)
  const quedo = await pdfs()
  comprobar(quedo.length === 1 && quedo[0].id === nuevo.id, `[Administración ${tam}] queda el corregido, el más nuevo`)
  await esperar(async () => (await p.locator('[role=status]').filter({ hasText: 'Se quitó' }).count()) > 0, 10000)
  const seQuito = limpio(await p.locator('[role=status]').filter({ hasText: 'Se quitó' }).innerText())
  comprobar(seQuito === `Se quitó ${original.nombre_archivo}, del ${cuandoAnterior}`.replace(/\.?$/, '.'),
    `[Administración ${tam}] dice cuál se quitó, con su hora: «${seQuito}»`)
  comprobar((await enfocado(p))?.etiqueta === 'Cambiar el PDF', `[Administración ${tam}] y el foco vuelve a «Cambiar el PDF»: ${JSON.stringify(await enfocado(p))}`)
  await p.screenshot({ path: join(CAPTURAS, `borde-pdf-quitado-${tam}.png`) })

  // En una orden con el Excel del cronograma guardado, el PDF de la orden va primero.
  const conExcel = await uno(`select o.id from public.ordenes_trabajo o
                               where exists (select 1 from public.ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN')
                                 and exists (select 1 from public.ot_adjuntos a where a.orden_id = o.id and a.tipo = 'CRONOGRAMA')
                               order by o.numero limit 1`)
  if (conExcel) {
    await ir(p, `/ordenes/${conExcel.id}`)
    await tarjetaOrden(p).waitFor({ timeout: 20000 })
    const tipos = (await tarjetaOrden(p).locator('li p.text-\\[11px\\]').allInnerTexts()).map((t) => (t.startsWith('Cronograma') ? 'C' : 'O')).join('')
    comprobar(/^O+C*$/.test(tipos), `[Administración ${tam}] el PDF de la orden va antes que el Excel del cronograma: ${tipos}`)
  }
  const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  comprobar(desborde <= 0, `[Administración ${tam}] sin desborde (${desborde} px)`)
  await contexto.close()
}

// ---------------------------------------------- 4. el archivo que no sirve, al enviar
async function noSirveAlEnviar(viewport) {
  const tam = nombreDe(viewport)
  const TXT = { name: `NOTAS-${sello}.txt`, mimeType: 'text/plain', buffer: Buffer.from('hola') }
  const WORD = { name: `OT-FALSA-${sello}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('PK\u0003\u0004 esto es un word') }
  {
    const { pagina: p, contexto } = await entrar('ventas.local@metalwork.test', viewport)
    await ir(p, '/cotizaciones/pdf')
    await p.getByRole('button', { name: 'Subir cotización' }).click()
    const v = p.getByRole('dialog')
    await v.waitFor()
    const campo = v.locator('#cot-archivo')
    await campo.setInputFiles(TXT)
    await esperar(async () => (await dice(campo)).startsWith('No es'), 5000)
    await v.getByRole('button', { name: 'Subir y mandar a Gerencia' }).click()
    await p.waitForTimeout(400)
    comprobar((await enfocado(p))?.id === 'cot-archivo', `[Ventas ${tam}] con un .txt, el envío se queda en el archivo y no salta al número: ${JSON.stringify(await enfocado(p))}`)
    comprobar((await campo.evaluate((e) => e.validationMessage)) === 'No es un PDF ni un Word: elige otro.', `[Ventas ${tam}] el globo dice por qué: «${await campo.evaluate((e) => e.validationMessage)}»`)
    comprobar((await v.locator('#cot-numero').evaluate((e) => e.matches(':focus'))) === false, `[Ventas ${tam}] el número no se marca`)
    await p.screenshot({ path: join(CAPTURAS, `borde-ventas-txt-${tam}.png`) })
    await campo.setInputFiles(WORD)
    await esperar(async () => (await dice(campo)).includes('dañado'), 5000)
    await v.getByRole('button', { name: 'Subir y mandar a Gerencia' }).click()
    await p.waitForTimeout(400)
    comprobar((await enfocado(p))?.id === 'cot-archivo', `[Ventas ${tam}] con un Word llamado .pdf, también`)
    comprobar((await campo.evaluate((e) => e.validationMessage)) === 'Está dañado o no es un PDF de verdad: elige otro.', `[Ventas ${tam}] y el globo lo dice`)
    await contexto.close()
  }
  {
    // Una cotización que Gerencia aprobó y espera su código y su OT, de las que
    // deja la prueba de documentos.
    const cot = await uno(`select c.id, c.numero from public.cotizaciones_pdf c
                            where c.numero like 'QA-DOC-%' and c.estado = 'APROBADA'
                              and not exists (select 1 from public.ordenes_trabajo o where o.cotizacion_pdf_id = c.id)
                            order by c.creado_en desc limit 1`)
    if (!cot) {
      console.log('  -- sin cotización QA-DOC aprobada sin OT: corre antes probar-documentos-al-elegir.mjs para la parte de Administración')
      return
    }
    const { pagina: p, contexto } = await entrar('administracion.local@metalwork.test', viewport)
    await ir(p, '/cotizaciones/pdf?estado=APROBADA_SIN_OT')
    await p.locator('li').filter({ hasText: cot.numero }).first().getByRole('button', { name: 'Dar código y cargar la OT' }).click()
    const v = p.getByRole('dialog')
    await v.waitFor()
    const campo = v.locator(`#aprobar-pdf-${cot.id}`)
    // El código va antes que el PDF: con él lleno, el siguiente que revisa el navegador es el PDF.
    await v.locator('input[name="codigo_interno"]').fill(`QA-BORDE-${sello}`)
    await campo.setInputFiles(WORD)
    await esperar(async () => (await dice(campo)).includes('dañado'), 5000)
    await v.locator('button[type=submit]').last().click()
    await p.waitForTimeout(400)
    comprobar((await enfocado(p))?.id === `aprobar-pdf-${cot.id}`, `[Administración ${tam}] con un Word llamado .pdf, el envío se queda en el PDF de la OT: ${JSON.stringify(await enfocado(p))}`)
    await contexto.close()
  }
}

// ---------------------------------------------- 5. el Excel del cronograma que no quedó
async function excelQueNoQuedo(viewport) {
  const tam = nombreDe(viewport)
  const orden = await uno(`select id, numero from public.ordenes_trabajo
                            where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR')
                              and not plan_etapas_manual
                            order by numero limit 1`)
  if (!orden) {
    console.log('  -- sin orden de antes del plan manual: corre antes probar-documentos-al-elegir.mjs')
    return
  }
  for (const caso of ['sin señal', 'sin respuesta']) {
    const { pagina: p, contexto } = await entrar('diseno.local@metalwork.test', viewport)
    await ir(p, `/ordenes/${orden.id}?vista=actividades`)
    await p.getByRole('button', { name: 'Subir cronograma' }).click()
    const v = p.getByRole('dialog')
    await v.waitFor()
    const libro = new ExcelJS.Workbook()
    const hoja = libro.addWorksheet('Cronograma')
    hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
    hoja.addRow(['Acabados', `QA-BORDE ${sello} ${tam}`, null, 0, null, null])
    const nombre = `cronograma-borde-${sello}-${tam}-${caso === 'sin señal' ? 'senal' : 'respuesta'}.xlsx`
    const ruta = join(CAPTURAS, nombre)
    await libro.xlsx.writeFile(ruta)
    await v.locator(`#cronograma-${orden.id}`).setInputFiles(ruta)
    const cargar = v.getByRole('button', { name: /^Cargar 1 actividad/ })
    await cargar.waitFor({ timeout: 15000 })
    if (caso === 'sin señal') {
      await p.route(/\/storage\/v1\/object\/adjuntos-ot\//, (r) => (r.request().method() === 'POST' ? r.abort('failed') : r.continue()))
    } else {
      // El Excel sube y la acción lo anota, pero la respuesta no llega.
      let subio = false
      p.on('requestfinished', (r) => {
        if (/\/storage\/v1\/object\/adjuntos-ot\//.test(r.url()) && r.method() === 'POST') subio = true
      })
      await p.route((url) => url.pathname.startsWith('/ordenes/'), async (r) => {
        if (subio && r.request().method() === 'POST' && r.request().headers()['next-action']) {
          // Llega al servidor y la respuesta se pierde. Si el servidor tarda,
          // igual se corta: que la página no se quede esperando para siempre.
          await r.fetch({ timeout: 60000 }).catch(() => {})
          await r.abort('failed').catch(() => {})
        } else await r.continue().catch(() => {})
      })
    }
    await cargar.click()
    await v.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
    const estado = p.locator('[role=status]').filter({ hasText: 'cronograma' }).first()
    await esperar(async () => /Excel/.test(await estado.innerText()), 20000)
    const texto = limpio(await estado.innerText())
    const fila = await uno(`select count(*)::int as n from public.ot_adjuntos where orden_id = $1 and nombre_archivo = $2`, [orden.id, nombre])
    if (caso === 'sin señal') {
      comprobar(texto.endsWith('El Excel no quedó guardado en la orden. Revisa la señal y sube otra vez el cronograma con el mismo Excel; las actividades no se duplican.'),
        `[Diseño ${tam}] sin señal dice cómo volver a intentarlo, sin repetirse: «${texto}»`)
      comprobar(fila.n === 0, `[Diseño ${tam}] y de verdad no quedó`)
    } else {
      comprobar(texto.endsWith('No se sabe si el Excel quedó guardado: míralo en Resumen antes de volver a subirlo.'),
        `[Diseño ${tam}] sin respuesta no afirma que no quedó: «${texto}»`)
      comprobar(fila.n === 1, `[Diseño ${tam}] (sí quedó, y se ve en Resumen)`)
      comprobar((await estado.getByRole('link', { name: 'míralo en Resumen' }).count()) === 1, `[Diseño ${tam}] con el enlace a Resumen`)
    }
    await p.screenshot({ path: join(CAPTURAS, `borde-cronograma-${caso === 'sin señal' ? 'senal' : 'respuesta'}-${tam}.png`) })
    await p.unrouteAll({ behavior: 'ignoreErrors' })
    if (fila.n === 1) {
      // Lo de la prueba no se queda en la orden.
      await ir(p, `/ordenes/${orden.id}?vista=resumen`)
      const suya = tarjetaOrden(p).locator('li').filter({ hasText: nombre }).first()
      await suya.getByRole('button', { name: /^Quitar / }).click()
      await suya.getByRole('button', { name: 'Sí, quitar' }).click()
      await esperar(async () => (await uno(`select count(*)::int as n from public.ot_adjuntos where orden_id = $1 and nombre_archivo = $2`, [orden.id, nombre])).n === 0, 20000)
    }
    await contexto.close()
  }
}

// La salida del kardex necesita un material con saldo libre, de los que lista la
// planilla de Almacén (activos y con su unidad). En una base recién armada no hay
// ninguno: se ingresa como Almacén, con su permiso.
if (!(await uno(`select 1 as hay from public.v_existencias_materiales e join public.materiales m on m.id = e.material_id
                  where e.disponible >= 6 and m.activo and not m.unidad_pendiente limit 1`))) {
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

for (const viewport of [TELEFONO, MONITOR]) {
  console.log(`\n=========== ${nombreDe(viewport)}`)
  await fotoQueNoSubio(viewport)
  await fotoQueNoSubio(viewport, 'sin foto')
  await relojAdelantado(viewport)
  await mismoNombre(viewport)
  await noSirveAlEnviar(viewport)
  await excelQueNoQuedo(viewport)
}

const propios = errores.filter((e) => !/Failed to load resource|net::ERR_FAILED|Failed to fetch|fetch failed/i.test(e))
comprobar(propios.length === 0, `sin errores de consola${propios.length ? `: ${JSON.stringify(propios.slice(0, 5))}` : ''}`)
writeFileSync(join(CAPTURAS, `borde-${sello}.txt`), fallas.join('\n'))
await base.end()
await navegador.close()
console.log(fallas.length ? `\n${fallas.length} FALLAN` : '\nTodo en verde.')
process.exit(fallas.length ? 1 : 0)

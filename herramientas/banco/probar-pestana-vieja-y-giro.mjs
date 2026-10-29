/**
 * Lo que dejó la vigesimoctava pasada del PR #148, con clic real y la cuenta de
 * cada puesto (nunca ADMIN):
 *
 *   1. La pestaña de antes del último despliegue. Cada compilación cambia el id
 *      de cada acción de servidor, y el servidor contesta 404 con
 *      `x-nextjs-action-not-found` al id viejo (aquí, la cabecera `next-action`
 *      se cambia por CDP por uno que no existe; la respuesta es la del servidor
 *      de verdad). La acción no corrió: se dice que hay que recargar, no
 *      «revisa la conexión», no se reintenta, y nada queda suelto en Storage.
 *      a. «Reportar» un trabajo sin orden (Supervisión de Maestranza) con la
 *         ventana abierta: la foto se quita y la ventana pide elegirla otra vez.
 *         Antes quedaba «en duda», suelta para siempre.
 *      b. Lo mismo cerrada en vuelo: «… no se registró: el sistema se
 *         actualizó…» junto al botón. Mientras sigue, el botón apunta con
 *         `aria-describedby` a una región que ya estaba montada (la que nace con
 *         su texto no la lee el lector).
 *      c. Otra versión del contrato de un subcontrato (Administración): una
 *         sola llamada, sin la pausa ni el segundo intento, y el archivo se
 *         quita. Antes decía «No quedó registrado: no llegó la respuesta».
 *      d. El conteo inicial del kardex (Almacén): al leer el Excel y al
 *         registrar, el motivo es recargar.
 *   2. La anulación de un vehículo (Requerimientos) cerrada en vuelo: la fila
 *      entera gira y no abre otra ventana; lo que conteste se dice en la fila.
 *      Antes «Anular» no era parte del estado de la fila, y al contestar cerraba
 *      la ventana de la salida abierta entretanto.
 *   3. «Reportar día» de una OT al girar el teléfono (una cuenta OPERARIO del
 *      banco, sembrada como las de probar-administracion): la orden pinta cada
 *      actividad dos veces, y la que aparece al girar sabe del envío en camino
 *      y de su desenlace. Y el reporte entra: el banco mandaba `[]` como `{}` a
 *      la columna jsonb y ck_materiales_usados_array lo rechazaba.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 * SOLO=1a,2 corre solo esas partes.
 */
import ExcelJS from 'exceljs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  mtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
  almacen: process.env.ALMACEN ?? 'almacen.local@metalwork.test',
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  diseno: process.env.DISENO ?? 'diseno.local@metalwork.test',
  operario: 'operario.giro@banco.test',
}
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
const existe = async (bucket, ruta) =>
  (await consulta(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, ruta ?? ''])).length === 1

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
async function hasta(leer, cumple, ms = 20000) {
  const fin = Date.now() + ms
  let ultimo = await Promise.resolve().then(leer).catch(() => null)
  while (!cumple(ultimo) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    ultimo = await Promise.resolve().then(leer).catch(() => null)
  }
  return ultimo
}
const esperarSubidas = (pagina) => pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })

const SE_ACTUALIZO = 'El sistema se actualizó mientras tenías la pantalla abierta'
const SIN_RESPUESTA = /No llegó la respuesta|Revisa la conexión|revisa la conexión/
const ID_VIEJO = 'f'.repeat(42)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }
const GIRADO = { width: 844, height: 390 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    // El 404 de la acción vieja y el error que Next anota por él son lo que se prueba.
    if (m.type() === 'error' && !/Failed to fetch|net::|404|UnrecognizedActionError|Server Action/.test(t)) errores.push(t.slice(0, 300))
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)

  // `despliegue`: desde ahora cada acción sale con un id que el servidor no
  // conoce, como desde una pestaña vieja. `marca`: la acción cuyo cuerpo la
  // lleva se detiene antes de salir hasta `soltar()`; sale con el id que diga
  // `despliegue` en ese momento.
  const cdp = await contexto.newCDPSession(pagina)
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  const corte = { despliegue: false, marca: null, retenidas: 0, esperan: [], acciones: 0 }
  corte.soltar = () => {
    for (const listo of corte.esperan.splice(0)) listo()
  }
  const cuerpo = (r) =>
    r.postDataEntries?.length ? r.postDataEntries.map((x) => Buffer.from(x.bytes ?? '', 'base64').toString()).join('') : (r.postData ?? '')
  cdp.on('Fetch.requestPaused', async (e) => {
    const seguir = (extra = {}) => cdp.send('Fetch.continueRequest', { requestId: e.requestId, ...extra }).catch(() => {})
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    if (e.request.method !== 'POST' || !h['next-action']) return seguir()
    corte.acciones++
    if (corte.marca && cuerpo(e.request).includes(corte.marca)) {
      corte.marca = null
      corte.retenidas++
      await new Promise((listo) => corte.esperan.push(listo))
    }
    if (!corte.despliegue) return seguir()
    const headers = Object.entries(e.request.headers).map(([name, value]) => ({ name, value: name.toLowerCase() === 'next-action' ? ID_VIEJO : value }))
    return seguir({ headers })
  })
  return { pagina, contexto, errores, corte }
}

/** Las regiones `role="status"` montadas ahora, por id: la del botón tiene que estar desde antes. */
const regionesMontadas = (pagina) =>
  pagina.evaluate(() => [...document.querySelectorAll('[role="status"][id]')].map((e) => e.id))
/** El texto de lo que nombra `aria-describedby` del botón, o null. */
const loQueDescribe = (boton) =>
  boton.evaluate((b) => {
    const ids = b.getAttribute('aria-describedby')
    if (!ids) return null
    return ids.split(' ').map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? `(${id} no existe)`).join(' | ')
  })
const idsQueDescribe = (boton) => boton.evaluate((b) => (b.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean))

const sello = Date.now().toString().slice(-6)
const archivos = join(CAPTURAS, 'pestana-vieja')
mkdirSync(archivos, { recursive: true })
const fotos = {}
{
  const p = await (await navegador.newContext()).newPage()
  for (const [n, color] of [['a', '#7a4b2a'], ['b', '#3a3f44'], ['c', '#2a5a7a'], ['d', '#5a7a2a']]) {
    const b64 = await p.evaluate(async (color) => {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = 480
      const g = c.getContext('2d')
      g.fillStyle = color
      g.fillRect(0, 0, 640, 480)
      g.fillStyle = '#fff'
      g.fillText(String(Math.random()), 20, 40)
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
      const b = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(s)
    }, color)
    fotos[n] = join(archivos, `vieja-${n}-${sello}.jpg`)
    writeFileSync(fotos[n], Buffer.from(b64, 'base64'))
  }
  await p.context().close()
}
const SOLO = process.env.SOLO?.split(',')
const corre = (parte) => !SOLO || SOLO.some((s) => parte === s || parte.startsWith(s))

// ------------------------------------------- 1a y 1b. «Reportar» un trabajo sin orden (Maestranza)
if (corre('1a') || corre('1b')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz)
  await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await pagina.fill('#descripcion', `Tolva de la pestaña vieja ${sello}`)
  await pagina.fill('#trabajo', 'Cambio de compuerta')
  await Promise.all([
    pagina.waitForURL((u) => /^\/avance\/trabajos\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }),
    pagina.getByRole('button', { name: 'Registrar el trabajo' }).click(),
  ])
  await quieta(pagina)
  const flotaId = new URL(pagina.url()).pathname.split('/').pop()
  const enStorage = async () =>
    (await consulta(`select name from storage.objects where bucket_id = 'fotos-avance' and name like $1 order by created_at`, [`flota/${flotaId}/%`])).map((x) => x.name)
  const reportes = async () => Number((await consulta(`select count(*) n from flota_avances where flota_id = $1`, [flotaId]))[0].n)
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#rf-descripcion') })
  const reportar = pagina.getByRole('button', { name: 'Reportar', exact: true })
  const abrir = async (foto) => {
    await reportar.click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.locator('input[type="file"]:not([capture])').setInputFiles(foto)
    await esperarSubidas(pagina)
  }

  if (corre('1a')) {
    await abrir(fotos.a)
    const [ruta] = await enStorage()
    await ventana.locator('#rf-descripcion').fill(`1a ${sello}: se cortó la compuerta`)
    const a0 = corte.acciones
    corte.despliegue = true
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    const dice = limpio(await hasta(() => ventana.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => t?.includes(SE_ACTUALIZO)))
    const quitada = !(await hasta(() => existe('fotos-avance', ruta), (v) => v === false, 10000))
    const miniaturas = await ventana.locator('img').count()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1a-ventana.png') })
    comprobar(dice.includes(SE_ACTUALIZO) && dice.includes('elige las fotos otra vez') && !SIN_RESPUESTA.test(dice) && corte.acciones - a0 === 1,
      `[Maestranza 1280] 1a. ventana abierta, pestaña vieja: dice que hay que recargar y elegir las fotos otra vez, sin «revisa la conexión», en una sola llamada («${dice}», ${corte.acciones - a0} llamada)`)
    comprobar(Boolean(ruta) && quitada && miniaturas === 0 && (await reportes()) === 0,
      `[Maestranza 1280] 1a. la foto se quita de Storage y de la ventana, sin esperar a «Cancelar», y no hay reporte (quitada ${quitada}, miniaturas ${miniaturas})`)
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    corte.despliegue = false
  }

  if (corre('1b')) {
    const antes = new Set(await regionesMontadas(pagina))
    await abrir(fotos.b)
    const [ruta] = (await enStorage()).slice(-1)
    const marca = `1b ${sello}`
    await ventana.locator('#rf-descripcion').fill(`${marca}: se soldaron los refuerzos`)
    corte.marca = marca
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    const cerro = (await hasta(() => ventana.count(), (n) => n === 0, 5000)) === 0
    const ocupado = (await reportar.getAttribute('aria-disabled')) === 'true'
    const describe = await hasta(() => loQueDescribe(reportar), (t) => Boolean(t), 5000)
    const [idEstado] = await idsQueDescribe(reportar)
    comprobar(retenido && cerro && ocupado && describe === 'El reporte se sigue enviando: lo que conteste se dice aquí.' && antes.has(idEstado),
      `[Maestranza 1280] 1b. cerrada en vuelo, «Reportar» gira y su aria-describedby nombra «se sigue enviando», en una región montada desde antes (retenido ${retenido}, ocupado ${ocupado}, «${describe}», de antes ${antes.has(idEstado)})`)
    corte.despliegue = true
    corte.soltar()
    const desenlace = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const libre = await hasta(() => reportar.getAttribute('aria-disabled'), (v) => v === null, 5000)
    const quitada = !(await hasta(() => existe('fotos-avance', ruta), (v) => v === false, 10000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1b-fila.png') })
    comprobar(desenlace === 'El reporte que se estaba enviando no se registró: el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y envíalo otra vez.',
      `[Maestranza 1280] 1b. al contestar el servidor que la acción no existe, junto al botón: «${desenlace}»`)
    comprobar(libre === null && (await reportar.getAttribute('aria-describedby')) === null && quitada && (await reportes()) === 0,
      `[Maestranza 1280] 1b. el botón se libera y deja de nombrar el estado, la foto se quita y no hay reporte (quitada ${quitada})`)
    corte.despliegue = false
  }
  comprobar(errores.length === 0, `[Maestranza 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1c. Otra versión del contrato de un subcontrato (Administración)
if (corre('1c')) {
  const [sc] = await consulta(`select id, numero from subcontratos where numero = 'SC-0001-2026'`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'subcontratos' and o.name like $1
        and not exists (select 1 from subcontrato_contratos c where c.archivo_ruta = o.name)
        and not exists (select 1 from recibos_honorarios r where r.archivo_ruta = o.name)`, [`${sc?.id}/%`])).length
  const contratos = async () => Number((await consulta(`select count(*) n from subcontrato_contratos where subcontrato_id = $1`, [sc?.id]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/subcontratos/${sc?.id}`)
  const sueltosAntes = await sueltos()
  const n0 = await contratos()
  await pagina.locator('[data-adjuntar-contrato]').first().click()
  const v = pagina.locator('[role="dialog"]').filter({ hasText: `contrato de ${sc?.numero}` })
  await v.waitFor({ timeout: 30000 })
  const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%vieja ${sello} ${'x'.repeat(1500)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
  await v.locator('input[type=file]').first().setInputFiles({ name: `contrato-vieja-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdf })
  await pagina.waitForTimeout(1200)
  const a0 = corte.acciones
  corte.despliegue = true
  const t0 = Date.now()
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  const dice = limpio(await hasta(() => v.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => t?.includes(SE_ACTUALIZO) || SIN_RESPUESTA.test(t ?? ''), 30000))
  const tardo = Date.now() - t0
  const sueltosDespues = await hasta(sueltos, (n) => n === sueltosAntes, 10000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1c-contrato.png') })
  comprobar(dice.includes(SE_ACTUALIZO) && !SIN_RESPUESTA.test(dice) && corte.acciones - a0 === 1,
    `[Administración 1280] 1c. el contrato desde la pestaña vieja dice que hay que recargar, en una sola llamada, sin la pausa (${tardo} ms; «${dice}»; ${corte.acciones - a0} llamada)`)
  comprobar(sueltosDespues === sueltosAntes && (await contratos()) === n0,
    `[Administración 1280] 1c. el archivo subido se quita y no hay contrato nuevo (sueltos ${sueltosAntes} → ${sueltosDespues})`)
  corte.despliegue = false
  await v.getByRole('button', { name: 'Cancelar' }).click().catch(() => {})
  comprobar(errores.length === 0, `[Administración 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1d. El conteo inicial del kardex (Almacén)
if (corre('1d')) {
  // Un material propio, como en probar-fotos-al-cerrar: contar uno del catálogo le quitaría la salida a otras suites.
  const codigo = `QA-VIEJA-${sello}`
  const [{ id: materialId }] = await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, `Trapo de la pestaña vieja ${sello}`],
  )
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
     select gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Compra de banco', u.id, 2, 'PEN', now() - interval '1 hour'
     from public.usuarios u where u.correo = $2`,
    [materialId, CUENTAS.almacen],
  )
  const movimientos = async () => Number((await consulta(`select count(*) n from movimientos_materiales where material_id = $1`, [materialId]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/conteo-inicial`)).body())
  const hoja = libro.getWorksheet('Conteo')
  let encabezado = 0
  hoja.eachRow((f, n) => {
    if (!encabezado && f.values.includes('Cantidad contada')) encabezado = n
  })
  for (let n = encabezado + 1; n <= hoja.rowCount; n++) {
    if (String(hoja.getCell(n, 1).value) === codigo) hoja.getCell(n, 5).value = Number(hoja.getCell(n, 4).value) + 1
    else hoja.getCell(n, 5).value = null
  }
  const lleno = join(archivos, `conteo-vieja-${sello}.xlsx`)
  await libro.xlsx.writeFile(lleno)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  // Al leer el Excel.
  corte.despliegue = true
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const alLeer = limpio(await hasta(() => v.innerText(), (t) => t?.includes(SE_ACTUALIZO) || /No se pudo leer/.test(t ?? ''), 20000))
  comprobar(alLeer.includes(SE_ACTUALIZO) && !/revisa la conexión/.test(alLeer),
    `[Almacén 1280] 1d. leer el conteo desde la pestaña vieja dice que hay que recargar, no «revisa la conexión y elígelo otra vez»`)
  // Al registrar: la ventana otra vez, con el mismo Excel.
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  await hasta(() => v.count(), (n) => n === 0, 5000)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  await v.waitFor()
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const boton = v.getByRole('button', { name: 'Registrar 1 material' })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const a0 = corte.acciones
  corte.despliegue = true
  await boton.click()
  const alRegistrar = limpio(await hasta(() => v.innerText(), (t) => t?.includes(SE_ACTUALIZO) || /No se confirmó/.test(t ?? ''), 20000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1d-conteo.png') })
  comprobar(alRegistrar.includes(SE_ACTUALIZO) && !/No se confirmó/.test(alRegistrar) && corte.acciones - a0 === 1 && (await movimientos()) === m0,
    `[Almacén 1280] 1d. registrar el conteo desde la pestaña vieja dice que hay que recargar, en una sola llamada, y no registra nada (${corte.acciones - a0} llamada)`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Almacén 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 2. La anulación de un vehículo, cerrada en vuelo (Requerimientos)
if (corre('2')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/vehiculos`)
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#veh-motivo') })
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  await ventana.waitFor({ timeout: 10000 })
  await ventana.locator('#veh-motivo').selectOption('COCHERA')
  await ventana.locator('#veh-placa').fill(`V${sello.slice(-1)}A-${sello.slice(0, 3)}`)
  await ventana.locator('#veh-unidad').fill('Camioneta del cliente')
  const empresa = `EMPRESA VIEJA ${sello}`
  await ventana.locator('#veh-empresa').fill(empresa)
  await ventana.locator('input[type="file"]:not([capture])').setInputFiles(fotos.c)
  await esperarSubidas(pagina)
  await ventana.getByRole('button', { name: 'Registrar ingreso' }).click()
  const [reg] = await hasta(() => consulta(`select id from registro_vehiculos where empresa = $1`, [empresa]), (r) => r.length === 1)
  await ir(pagina, `${BASE}/vehiculos/${reg?.id}`)
  const anular = pagina.getByRole('button', { name: /^Anular el ingreso de/ })
  const fila = pagina.locator('div', { has: anular }).last()
  const anulado = async () => (await consulta(`select anulado_en is not null as a from registro_vehiculos where id = $1`, [reg?.id]))[0]?.a
  const v = pagina.locator('[role="dialog"]', { has: pagina.locator('textarea[name="motivo"]') })

  await anular.click()
  await v.waitFor({ timeout: 10000 })
  const marca = `Anulada ${sello}`
  await v.locator('textarea[name="motivo"]').fill(`${marca}: se anotó la placa de otro vehículo`)
  corte.marca = marca
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
  await pagina.keyboard.press('Escape')
  const cerro = (await hasta(() => v.count(), (n) => n === 0, 5000)) === 0
  const botones = await fila.getByRole('button').all()
  const ocupados = await Promise.all(botones.map(async (b) => `${limpio(await b.innerText())}:${(await b.getAttribute('aria-disabled')) ?? (await b.isDisabled() ? 'apagado' : 'libre')}`))
  const sigue = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'se sigue enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 5000))
  const describe = await loQueDescribe(anular)
  // Con aria-disabled, Playwright no lo da por tocable: se toca igual, como un dedo.
  await anular.click({ force: true })
  await pagina.waitForTimeout(800)
  const abrioOtra = await pagina.getByRole('dialog').count()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-2-fila.png') })
  comprobar(retenido && cerro && ocupados.every((o) => /:(true|apagado)$/.test(o)) && sigue === 'La anulación se sigue enviando: lo que conteste se dice aquí.' && abrioOtra === 0,
    `[Requerimientos 1280] 2. la anulación cerrada en vuelo: la fila entera gira, dice que sigue enviándose y no abre otra ventana (${ocupados.join(', ')}; «${sigue}»; ventanas ${abrioOtra})`)
  comprobar(describe === 'La anulación se sigue enviando: lo que conteste se dice aquí.',
    `[Requerimientos 1280] 2. «Anular» nombra con aria-describedby lo que sigue («${describe}»)`)
  corte.despliegue = true
  corte.soltar()
  const desenlace = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean))
  const libre = await hasta(() => anular.getAttribute('aria-disabled'), (x) => x === null, 5000)
  comprobar(desenlace === 'La anulación que se estaba enviando no se registró: el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y envíalo otra vez.' && libre === null && !(await anulado()),
    `[Requerimientos 1280] 2. desde la pestaña vieja, en la fila: «${desenlace}»; el botón se libera y el ingreso sigue sin anular`)
  corte.despliegue = false
  // Ya sin la pestaña vieja, la anulación entra y la fila deja de ofrecerla.
  await anular.click()
  await v.waitFor({ timeout: 10000 })
  await v.locator('textarea[name="motivo"]').fill(`${marca} otra vez: se anotó la placa de otro vehículo`)
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  const entro = await hasta(anulado, Boolean, 15000)
  const cerrada = (await hasta(() => v.count(), (n) => n === 0, 10000)) === 0
  comprobar(Boolean(entro) && cerrada, `[Requerimientos 1280] 2. después, la anulación entra y la ventana se cierra (anulado ${entro})`)
  comprobar(errores.length === 0, `[Requerimientos 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 3. «Reportar día» al girar el teléfono (OPERARIO del banco)
if (corre('3')) {
  // La cuenta y la actividad, como postgres lo que no tiene pantalla en el banco
  // (no hay cuentas OPERARIO) y con la sesión de Diseño la actividad, que pasa
  // por su disparador. Peso 0: no mueve el avance de la orden.
  const [orden] = await consulta(`select id from ordenes_trabajo where numero = '0001-2026'`)
  let [yo] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.operario])
  if (!yo) {
    ;[yo] = await consulta(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [CUENTAS.operario])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, 'Operario', 'Banco del giro', $2, (select id from roles where codigo = 'OPERARIO'), (select id from areas where codigo = 'PRD')`,
      [yo.id, CUENTAS.operario],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [CUENTAS.operario, CLAVE])
  const nombre = `Soldar refuerzos ${sello}`
  await consulta('begin')
  await consulta(`select set_config('request.jwt.claims', json_build_object('sub', (select id from usuarios where correo = $1), 'role', 'authenticated')::text, true)`, [CUENTAS.diseno])
  await consulta('set local role authenticated')
  const [act] = await consulta(
    `insert into ot_actividades (orden_id, area_id, nombre, referencia, peso_pct) values ($1, (select id from areas where codigo = 'PRD'), $2, 'GIRO', 0) returning id`,
    [orden?.id, nombre],
  )
  await consulta('commit')
  const avances = async () => (await consulta(`select nota, avance_pct, materiales_usados from ot_actividad_avances where actividad_id = $1 order by creado_en`, [act.id]))

  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.operario, CELULAR)
  await ir(pagina, `${BASE}/ordenes/${orden?.id}?vista=actividades`)
  const deLaActividad = (sel) => pagina.locator(`#actividad-${act.id}:visible`).locator(sel)
  const boton = () => deLaActividad('button').filter({ hasText: 'Reportar día' })
  const ventana = pagina.locator('[role="dialog"]').filter({ hasText: nombre })
  const aLaVista = async () => limpio((await deLaActividad('[role="status"], [role="alert"]').allInnerTexts()).join(' | '))
  const enDom = await pagina.locator(`[id="actividad-${act.id}"]`).count()

  await boton().click()
  await ventana.waitFor({ timeout: 10000 })
  await ventana.getByRole('button', { name: '25 %' }).click()
  const marca = `Giro ${sello}`
  await ventana.locator('input[name="nota"]').fill(marca)
  corte.marca = marca
  await ventana.getByRole('button', { name: 'Reportar', exact: true }).click()
  const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await hasta(() => ventana.count(), (n) => n === 0, 5000)
  const ocupado390 = await boton().getAttribute('aria-disabled')
  const dice390 = await hasta(aLaVista, (t) => t.includes('se sigue enviando'), 5000)

  await pagina.setViewportSize(GIRADO)
  await pagina.waitForTimeout(800)
  const ocupadoGiro = await boton().getAttribute('aria-disabled')
  const diceGiro = await aLaVista()
  const describeGiro = await loQueDescribe(boton())
  await boton().click({ force: true })
  await pagina.waitForTimeout(800)
  const abrio = await ventana.count()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-girado.png') })
  comprobar(enDom === 2 && retenido && ocupado390 === 'true' && dice390.includes('El reporte se sigue enviando'),
    `[Operario 390] 3. la actividad está dos veces en la página; cerrada en vuelo, «Reportar día» gira y dice que sigue (${enDom} copias, «${dice390}»)`)
  comprobar(ocupadoGiro === 'true' && diceGiro.includes('El reporte se sigue enviando') && describeGiro === 'El reporte se sigue enviando: lo que conteste se dice aquí.' && abrio === 0,
    `[Operario girado a 844] 3. el «Reportar día» que aparece sabe del envío: gira, lo dice y no abre otra ventana (aria-disabled ${ocupadoGiro}, «${diceGiro}», describe «${describeGiro}», ventanas ${abrio})`)

  corte.despliegue = true
  corte.soltar()
  const desenlaceGiro = await hasta(aLaVista, (t) => t.includes('que se estaba enviando'))
  await pagina.setViewportSize(CELULAR)
  await pagina.waitForTimeout(800)
  const desenlace390 = await aLaVista()
  corte.despliegue = false
  comprobar(desenlaceGiro.includes('El reporte que se estaba enviando no se registró: el sistema se actualizó') && desenlace390 === desenlaceGiro && (await boton().getAttribute('aria-disabled')) === null && (await avances()).length === 0,
    `[Operario] 3. el desenlace sale en la copia a la vista, girado y de vuelta, y el botón se libera («${desenlaceGiro}»; a 390 «${desenlace390}»)`)

  // Y el reporte entra: el banco ya manda `[]` a la columna jsonb.
  await ir(pagina, `${BASE}/ordenes/${orden?.id}?vista=actividades`)
  await boton().click()
  await ventana.waitFor({ timeout: 10000 })
  await ventana.getByRole('button', { name: '25 %' }).click()
  await ventana.locator('input[name="nota"]').fill(`${marca} entra`)
  await ventana.getByRole('button', { name: 'Reportar', exact: true }).click()
  const [fila] = await hasta(avances, (r) => r.length === 1, 15000)
  // El aviso verde vive en el «Reportar día» de hoy, que al ponerse al día la
  // página se vuelve «Otro día»: lo que queda es «Reportado hoy» o «Corregir».
  const verde = limpio(await hasta(() => deLaActividad('*').allInnerTexts().then((t) => t.join(' ').match(/Avance del día reportado|Reportado hoy: \+25|Corregir el de hoy/)?.[0] ?? ''), Boolean, 10000))
  comprobar(fila && Number(fila.avance_pct) === 25 && Array.isArray(fila.materiales_usados) && fila.materiales_usados.length === 0 && Boolean(verde),
    `[Operario 390] 3. el reporte del día entra, con materiales_usados [] (${JSON.stringify(fila?.materiales_usados)}), y lo dice («${verde}»)`)
  comprobar(errores.length === 0, `[Operario] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

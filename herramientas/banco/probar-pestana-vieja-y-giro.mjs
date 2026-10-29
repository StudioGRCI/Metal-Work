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
 * Y lo que dejó la vigesimonovena:
 *
 *   1b. El «Reporte registrado» que llega con la ventana ya cerrada sale en una
 *       región montada desde antes: la que nace con su texto no la lee el lector.
 *   1d. El conteo inicial cortado por la pestaña vieja dice la causa una vez, en
 *       el resumen; las filas dicen «No salió» sin una alerta cada una, y en
 *       vez de «Registrar», que volvería a fallar, ofrece volver a cargar.
 *   1e. El reporte diario a medio llenar en la pestaña vieja: al volver tras
 *       31 s ya no se recarga solo (Next recarga el documento entero si
 *       `router.refresh()` ve otra compilación, y se perdía lo escrito y la foto
 *       quedaba suelta); arriba se dice que el sistema se actualizó. Al «Subir
 *       reporte», la foto se quita y se pide elegirla otra vez. Sin despliegue,
 *       al volver se repinta como siempre y sin aviso.
 *   1f. La planilla sin internet del kardex, como el conteo.
 *   1g. La cotización con cliente nuevo dice que hay que recargar, no «Vuelve a
 *       intentar», que nunca entraría.
 *   1h. El plano a dos áreas: una sola acción, una subida y un borrado, y un
 *       mensaje que no pide a la vez recargar y reenviar.
 *   3.  La parte se arma sola en un banco nuevo (antes dependía de que hubiera
 *       corrido probar-documentos-al-elegir), dice «Avance del día reportado» en
 *       la copia a la vista y en la otra al girar, y deja al OPERARIO
 *       desactivado.
 *
 * Y lo que se cerró antes de la trigésima: una vez que la pestaña se sabe
 * vieja, lo que se elija o se envíe desde ella ni sube a Storage, porque al
 * recargar, como pide el aviso de arriba, quedaría suelto.
 *
 *   1c. El segundo «Adjuntar» del contrato no sube el archivo ni llama a la acción.
 *   1e. La foto que se elige después de «Subir reporte» no sube, lo dice y no
 *       ofrece «Reintentar».
 *   El aviso de arriba solo está montado en la pestaña vieja (fijo en toda
 *   pantalla quedaba delante de la región de estado de cada una) y nace vacío,
 *   para que el lector lo oiga.
 *
 * Y lo que dejó la trigésima:
 *
 *   1c. Si el banco no tiene ningún subcontrato, registra uno con la sesión de
 *       Administración: antes dependía de SC-0001-2026 y en un banco nuevo
 *       tumbaba la suite entera.
 *   1e. Al saberse vieja la pestaña al volver, la foto ya subida se quita en el
 *       acto, queda sin miniatura con una sola alerta, y debajo se pide volver
 *       a cargar, no «Quita o vuelve a subir». Descubierta al enviar, el aviso
 *       de arriba está sin región: el del botón ya lo dice.
 *   1i. El despliegue de todos los días: la acción conserva su id (Next guarda
 *       la clave en .next/cache y Vercel la conserva) y solo cambia la
 *       compilación de las respuestas. Antes la pestaña no se enteraba y se
 *       recargaba sola. Ahora, al volver y en el sondeo, lo dice arriba sin
 *       recargar ni repintar; la foto sigue; «Volver a cargar» la quita antes
 *       de recargar; sin señal al volver no sale la página sin conexión; y el
 *       reporte entra con su foto.
 *   1j. La ventana que pregunta al abrirse por su envío anterior descubre la
 *       pestaña vieja y lo dice dentro; abierta otra vez, nace con el aviso.
 *   1k. El PDF de la orden: la segunda vez, ya sabida vieja, ni sube.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 * SOLO=1a,2 corre solo esas partes (1i son 1i-volver, 1i-sondeo y 1i-sin-senal).
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
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  ventas: process.env.VENTAS ?? 'ventas.local@metalwork.test',
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

/** Lo que haría `correo` desde la pantalla, con su sesión y su permiso: `set local role authenticated`. */
async function comoLaCuenta(correo, hacer) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claims', json_build_object('sub', (select id from usuarios where correo = $1), 'role', 'authenticated')::text, true)`, [correo])
    await base.query('set local role authenticated')
    await hacer()
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}
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

async function entrar(correo, viewport = { width: 1280, height: 900 }, { compilacion = false } = {}) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    // El 404 de la acción vieja y el error que Next anota por él son lo que se prueba.
    if (m.type() === 'error' && !/Failed to fetch|net::|404|UnrecognizedActionError|Server Action/.test(t)) errores.push(t.slice(0, 300))
  })
  // Lo que nadie atrapó: la consola lo anota con el texto de arriba, que se deja
  // pasar, y una acción desconocida sin atrapar se lleva la pantalla.
  pagina.on('pageerror', (e) => errores.push(`sin atrapar: ${String(e?.message ?? e).slice(0, 300)}`))
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
  // `despliegue` en ese momento. Con `compilacion`, además, las respuestas RSC
  // llegan con otro x-nextjs-deployment-id mientras dure `despliegue`, como las
  // de otra compilación: con eso Next recarga el documento entero.
  //
  // `conservaIds`, con `despliegue`: el despliegue de todos los días. Next
  // guarda la clave de los ids en .next/cache y Vercel conserva esa carpeta,
  // así que el servidor nuevo conoce las acciones de la pestaña: no se cambia
  // el id, y lo que cambia es la compilación que dicen sus respuestas (la
  // cabecera, y en el cuerpo la `b` de Next y la que contesta
  // contarAvisosSinLeer). La de la pantalla se lee de la página al entrar.
  const cdp = await contexto.newCDPSession(pagina)
  const patrones = [{ urlPattern: '*', requestStage: 'Request' }]
  if (compilacion) patrones.push({ urlPattern: '*', requestStage: 'Response' })
  await cdp.send('Fetch.enable', { patterns: patrones })
  const corte = { despliegue: false, conservaIds: false, marca: null, retenidas: 0, esperan: [], acciones: 0, documentos: 0, rsc: 0, storage: [], reescritas: 0 }
  corte.compilacion = (await pagina.content()).match(/\\"compilacion\\":\\"([^\\"]+)\\"/)?.[1] ?? null
  corte.soltar = () => {
    for (const listo of corte.esperan.splice(0)) listo()
  }
  const cuerpo = (r) =>
    r.postDataEntries?.length ? r.postDataEntries.map((x) => Buffer.from(x.bytes ?? '', 'base64').toString()).join('') : (r.postData ?? '')
  cdp.on('Fetch.requestPaused', async (e) => {
    const seguir = (extra = {}) => cdp.send('Fetch.continueRequest', { requestId: e.requestId, ...extra }).catch(() => {})
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    if (e.responseStatusCode !== undefined || e.responseErrorReason !== undefined) {
      const responder = (extra = {}) => cdp.send('Fetch.continueResponse', { requestId: e.requestId, ...extra }).catch(() => seguir())
      if (!corte.despliegue || e.responseErrorReason) return responder()
      const responseHeaders = [...(e.responseHeaders ?? []).filter((x) => x.name.toLowerCase() !== 'x-nextjs-deployment-id'), { name: 'x-nextjs-deployment-id', value: 'compilacion-nueva' }]
      if (h['next-action']) {
        if (!corte.conservaIds || !corte.compilacion) return responder()
        // Lo que contesta el servidor nuevo a una acción que conoce: dice su compilación.
        const leido = await cdp.send('Fetch.getResponseBody', { requestId: e.requestId }).catch(() => null)
        if (!leido) return responder()
        const texto = Buffer.from(leido.body, leido.base64Encoded ? 'base64' : 'utf8').toString('utf8').split(corte.compilacion).join('compilacion-nueva')
        corte.reescritas++
        return cdp
          .send('Fetch.fulfillRequest', {
            requestId: e.requestId,
            responseCode: e.responseStatusCode,
            responseHeaders: responseHeaders.filter((x) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(x.name)),
            body: Buffer.from(texto).toString('base64'),
          })
          .catch(() => responder())
      }
      if (h.rsc !== '1') return responder()
      return responder({ responseCode: e.responseStatusCode, responseHeaders })
    }
    if (e.resourceType === 'Document') corte.documentos++
    // El repintado, no lo que Next pide por adelantado de los enlaces.
    if (h.rsc === '1' && !h['next-action'] && !h['next-router-prefetch']) corte.rsc++
    const objeto = e.request.url.match(/\/storage\/v1\/object\/([^?]+)/)?.[1]
    if (objeto && e.request.method !== 'GET' && e.request.method !== 'OPTIONS') corte.storage.push(`${e.request.method} ${objeto}`)
    if (e.request.method !== 'POST' || !h['next-action']) return seguir()
    corte.acciones++
    if (corte.marca && cuerpo(e.request).includes(corte.marca)) {
      corte.marca = null
      corte.retenidas++
      await new Promise((listo) => corte.esperan.push(listo))
    }
    if (!corte.despliegue || corte.conservaIds) return seguir()
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

/**
 * Anota, para cada región `role="status"` donde aparece `texto`, si ya estaba
 * montada al llamar: la que nace con su texto el lector no la anuncia.
 * `leer()` da la lista, en el orden en que aparecieron.
 */
async function vigilarElVerde(pagina, texto) {
  await pagina.evaluate((texto) => {
    for (const e of document.querySelectorAll('[role="status"]')) e.dataset.deAntes = '1'
    window.__verdes = []
    const mirar = () => {
      for (const e of document.querySelectorAll('[role="status"]')) {
        if (!e.dataset.vistoVerde && (e.textContent ?? '').includes(texto)) {
          e.dataset.vistoVerde = '1'
          window.__verdes.push(e.dataset.deAntes === '1')
        }
      }
    }
    new MutationObserver(mirar).observe(document.body, { subtree: true, childList: true, characterData: true })
  }, texto)
  return { leer: () => pagina.evaluate(() => window.__verdes ?? []) }
}

/** Lo que hace el teléfono al cambiar de aplicación y volver `ms` después: blur, y focus con el reloj adelantado. */
const salirYVolver = (pagina, ms = 31_000) =>
  pagina.evaluate((ms) => {
    window.dispatchEvent(new Event('blur'))
    const real = Date.now.bind(Date)
    Date.now = () => real() + ms
    window.dispatchEvent(new Event('focus'))
  }, ms)
/** Una marca en `window` que solo una recarga del documento borra. */
const marcarDocumento = (pagina) => pagina.evaluate(() => { window.__mismoDocumento = 1 })
const mismoDocumento = (pagina) => pagina.evaluate(() => window.__mismoDocumento === 1).catch(() => false)
const avisoDeArriba = async (pagina) => limpio(await pagina.locator('[data-pestana-vieja]').innerText().catch(() => ''))
const TEXTO_VIEJA =
  'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde aquí no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.'
const TEXTO_NUEVA =
  'El sistema se actualizó mientras tenías la pantalla abierta. Termina lo que estás haciendo y vuelve a cargar la pantalla para ver lo nuevo.'
const TEXTO_VENTANA =
  'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde esta ventana no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.'
/** Anota si la región del aviso de arriba nació vacía: la que nace con su texto el lector no la lee. */
const vigilarLaRegionDeArriba = (pagina) =>
  pagina.evaluate(() => {
    window.__regionVaciaPrimero = undefined
    new MutationObserver(() => {
      const r = document.querySelector('[data-region-pestana-vieja]')
      if (r && window.__regionVaciaPrimero === undefined) window.__regionVaciaPrimero = !r.textContent
    }).observe(document.body, { subtree: true, childList: true })
  })
const regionDeArriba = (pagina) =>
  pagina.evaluate(() => ({ rol: document.querySelector('[data-region-pestana-vieja]')?.getAttribute('role') ?? null, vacia: window.__regionVaciaPrimero }))

async function elegir(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  // Como en probar-reporte-diario: se escribe cuando la caja de búsqueda ya
  // tiene el foco, o las letras se pierden en el botón.
  const caja = pagina.locator('input[type="search"]:focus')
  await caja.waitFor({ timeout: 10000 })
  await caja.fill(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

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

/** Un material propio con 5 en stock, como en probar-fotos-al-cerrar: contar o sacar uno del catálogo le quitaría la salida a otras suites. */
async function materialPropio(codigo, descripcion) {
  const [{ id }] = await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, descripcion],
  )
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
     select gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Compra de banco', u.id, 2, 'PEN', now() - interval '1 hour'
     from public.usuarios u where u.correo = $2`,
    [id, CUENTAS.almacen],
  )
  return id
}

const sello = Date.now().toString().slice(-6)
const archivos = join(CAPTURAS, 'pestana-vieja')
mkdirSync(archivos, { recursive: true })
const fotos = {}
{
  const p = await (await navegador.newContext()).newPage()
  for (const [n, color] of [['a', '#7a4b2a'], ['b', '#3a3f44'], ['c', '#2a5a7a'], ['d', '#5a7a2a'], ['e', '#7a2a5a']]) {
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

    // Y el que sí entra con la ventana ya cerrada: su verde sale en una región
    // que estaba montada (vigesimonovena pasada).
    await abrir(fotos.e)
    const marcaOk = `1b-ok ${sello}`
    await ventana.locator('#rf-descripcion').fill(`${marcaOk}: se pintó la compuerta`)
    corte.marca = marcaOk
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    await hasta(() => corte.retenidas, (n) => n >= 2)
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    const verde = await vigilarElVerde(pagina, 'Reporte registrado')
    corte.soltar()
    const verdes = await hasta(verde.leer, (v) => v?.length > 0, 20000)
    const dice = limpio(await pagina.getByRole('status').filter({ hasText: 'Reporte registrado' }).first().innerText().catch(() => ''))
    comprobar(verdes?.[0] === true && dice.startsWith('Reporte registrado') && (await reportes()) === 1,
      `[Maestranza 1280] 1b. cerrada en vuelo, «${dice}» sale en una región montada desde antes, que el lector anuncia (${JSON.stringify(verdes)})`)
  }
  comprobar(errores.length === 0, `[Maestranza 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1c. Otra versión del contrato de un subcontrato (Administración)
if (corre('1c')) {
  const vigente = () => consulta(`select id, numero from subcontratos where estado <> 'ANULADO' order by numero limit 1`)
  let [sc] = await vigente()
  if (!sc) {
    // En un banco nuevo no hay ninguno: se registra uno con la sesión y el
    // permiso de Administración, como lo haría ella (nunca ADMIN).
    await comoLaCuenta(CUENTAS.administracion, async () => {
      const [{ id: quien }] = await consulta(`select gen_random_uuid() as id`)
      await consulta(`select public.guardar_subcontratista($1::uuid, '10043200017', 'Subcontratista de la pestaña vieja', null, null, null, null, true)`, [quien])
      await consulta(`select public.registrar_subcontrato(gen_random_uuid(), $1::uuid, 'PLANTA', $2, 'PEN', 1000, null, null, 'MTZ')`, [quien, `Pintura de la tolva ${sello}`])
    })
    ;[sc] = await vigente()
  }
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
  // Ya se sabe vieja: el segundo intento ni sube el archivo ni llama a la acción.
  const s1 = corte.storage.length
  const a1 = corte.acciones
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  await pagina.waitForTimeout(2000)
  const otraVez = limpio(await v.getByRole('alert').allInnerTexts().then((t) => t.join(' ')))
  comprobar(otraVez.includes(SE_ACTUALIZO) && corte.storage.length === s1 && corte.acciones === a1 && (await sueltos()) === sueltosAntes,
    `[Administración 1280] 1c. el segundo «Adjuntar», con la pestaña ya sabida vieja, no sube nada ni llama a la acción (${corte.storage.length - s1} pedidos a Storage, ${corte.acciones - a1} llamadas)`)
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
  const alRegistrar = limpio(await hasta(() => v.innerText(), (t) => /el sistema se actualizó|No se confirmó/i.test(t ?? ''), 20000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1d-conteo.png') })
  comprobar(/el sistema se actualizó mientras tenías la pantalla abierta/i.test(alRegistrar) && !/No se confirmó/.test(alRegistrar) && corte.acciones - a0 === 1 && (await movimientos()) === m0,
    `[Almacén 1280] 1d. registrar el conteo desde la pestaña vieja dice que hay que recargar, en una sola llamada, y no registra nada (${corte.acciones - a0} llamada)`)
  // La causa una vez, en el resumen que recibe el cursor; las filas sin alerta
  // propia; y en vez de «Registrar», que fallaría igual, volver a cargar.
  const resumen = limpio(await pagina.evaluate(() => document.activeElement?.textContent ?? ''))
  const alertas = await v.getByRole('alert').filter({ hasText: /actualizó/ }).count()
  const fila = limpio(await v.getByText('No salió: el sistema se actualizó.').first().innerText().catch(() => ''))
  const registrarOtraVez = await v.getByRole('button', { name: /^Registrar \d/ }).count()
  const recargar = v.getByRole('button', { name: 'Volver a cargar la pantalla' })
  comprobar(resumen === 'No se registró ningún material; 1 no salió porque el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y elige el archivo otra vez: lo registrado no se duplica.',
    `[Almacén 1280] 1d. el resumen enfocado dice la causa y qué hacer («${resumen}»)`)
  comprobar(alertas === 0 && fila === 'No salió: el sistema se actualizó.' && registrarOtraVez === 0 && (await recargar.count()) === 1,
    `[Almacén 1280] 1d. la fila dice «${fila}» sin alerta propia (${alertas}); no queda «Registrar» (${registrarOtraVez}) y sí «Volver a cargar la pantalla»`)
  comprobar((await avisoDeArriba(pagina)).startsWith(SE_ACTUALIZO), `[Almacén 1280] 1d. y arriba de la pantalla lo dice también («${await avisoDeArriba(pagina)}»)`)
  corte.despliegue = false
  await marcarDocumento(pagina)
  if (await recargar.count()) await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), recargar.click()])
  comprobar(!(await mismoDocumento(pagina)) && (await pagina.locator('[data-pestana-vieja]').count()) === 0,
    `[Almacén 1280] 1d. «Volver a cargar la pantalla» la recarga, y ya sin el aviso de arriba`)
  comprobar(errores.length === 0, `[Almacén 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1e y 1i. El reporte diario a medio llenar (Maestranza, a 390)
if (corre('1e') || corre('1i-volver') || corre('1i-sondeo') || corre('1i-sin-senal')) {
  // Una persona de Maestranza para el trabajo, como la dejaría RR. HH.; al
  // final se le pone su costo y se da de baja. Para enviar no hace falta.
  const persona = `Pedro ${sello}`
  await consulta(
    `insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
     select $1, 'Prueba Pestaña Vieja', '5' || $2 || '01', 'Soldador', (select id from areas where codigo = 'MTZ'), (select id from usuarios where correo = $3)`,
    [persona, sello.slice(-5), CUENTAS.rrhh],
  )
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.mtz])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const subidas = async () =>
    (await consulta(`select name from storage.objects where bucket_id = 'fotos-reporte-diario' and owner_id = $1 and created_at >= $2 order by created_at`, [yo, desde])).map((o) => o.name)
  const asunto = `Pestaña vieja ${sello}`
  const reportes = async () => Number((await consulta(`select count(*) n from reportes_diarios where asunto = $1`, [asunto]))[0].n)
  const llenar = async (pagina, conFoto) => {
    await ir(pagina, `${BASE}/reportes-diarios/nuevo`)
    await pagina.fill('#rd-codigo', 'PLANTA')
    await pagina.fill('#rd-asunto', asunto)
    await pagina.fill('#rd-descripcion', 'Se ordenó la planta y se soldaron los soportes.')
    const t1 = pagina.locator('fieldset[data-trabajo="1"]')
    await elegir(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
    await t1.locator('textarea').fill('Soportes de la tolva')
    await t1.locator('input[type="number"]').first().fill('30')
    await elegir(pagina, 'Personal del trabajo 1: persona 1', persona)
    await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('2')
    if (conFoto) {
      await pagina.locator('input[type="file"]:not([capture])').first().setInputFiles(fotos.d)
      await esperarSubidas(pagina)
    }
    // El último toque fuera de un campo, como al cerrar el teclado tocando el
    // título: con el cursor en un campo, RefrescoAlVolver espera de todos modos.
    await pagina.locator('main h1').first().click()
  }
  // La foto a la vista: su miniatura. Al quitarla por la pestaña vieja queda
  // en la lista sin miniatura, diciendo «Se quitó».
  const miniaturas = (pagina) => pagina.locator('main img[alt^="vieja-d-"]').count()
  const subirReporte = (pagina) => pagina.getByRole('button', { name: 'Subir reporte' })

  // Sin despliegue: al volver se repinta, sin recargar el documento y sin aviso.
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const r0 = corte.rsc
    const d0 = corte.documentos
    await salirYVolver(pagina)
    const repinto = await hasta(() => corte.rsc - r0, (n) => n > 0, 10000)
    await quieta(pagina)
    comprobar(repinto > 0 && corte.documentos === d0 && (await mismoDocumento(pagina)) && (await pagina.inputValue('#rd-asunto')) === asunto && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0,
      `[Maestranza 390] 1e. sin despliegue, al volver tras 31 s se repinta sin recargar, lo escrito sigue y arriba no hay aviso ni su región (${repinto} pedidos RSC, ${corte.documentos - d0} documentos)`)
    comprobar(errores.length === 0, `[Maestranza 390] 1e. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Un despliegue que cambia los ids: al volver no se recarga sola, lo dice
  // arriba, y la foto ya subida se quita en el acto (trigésima pasada: antes
  // se quedaba hasta «Subir reporte», y al recargar como pedía el aviso quedaba suelta).
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    await vigilarLaRegionDeArriba(pagina)
    const d0 = corte.documentos
    corte.despliegue = true
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    const quitada = !(await hasta(() => existe('fotos-reporte-diario', ruta), (v) => v === false, 10000))
    await pagina.waitForTimeout(1500)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-al-volver.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto')
    comprobar(corte.documentos === d0 && mismo && escrito === asunto,
      `[Maestranza 390] 1e. con despliegue, al volver tras 31 s la pantalla no se recarga sola: lo escrito sigue (mismo documento ${mismo}, asunto «${escrito}»)`)
    comprobar(arriba === `${TEXTO_VIEJA} Volver a cargar` && (await pagina.locator('[data-pestana-vieja="vieja"]').count()) === 1,
      `[Maestranza 390] 1e. y arriba lo dice, con «Volver a cargar» («${arriba}»)`)
    const region = await regionDeArriba(pagina)
    comprobar(region.rol === 'status' && region.vacia === true,
      `[Maestranza 390] 1e. el aviso de arriba nace en una región role=status montada antes que su texto (role ${region.rol}, vacía primero ${region.vacia})`)
    const alerta = limpio(await pagina.locator('[data-fotos-quitadas]').innerText().catch(() => ''))
    const alertas = await pagina.locator('main [role="alert"]').filter({ hasText: /se quitó|se quitaron/ }).count()
    const tarjeta = limpio(await pagina.locator('main').getByText('Se quitó', { exact: true }).first().innerText().catch(() => ''))
    comprobar(Boolean(ruta) && quitada && (await miniaturas(pagina)) === 0 && tarjeta === 'Se quitó'
      && alerta === 'La foto ya subida se quitó: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.' && alertas === 1,
      `[Maestranza 390] 1e. la foto ya subida se quita de Storage en el acto y queda sin miniatura, con una sola alerta que pide elegirla otra vez («${alerta}»; quitada ${quitada}, ${alertas} alerta)`)
    const ayuda = await pagina.getByText('Vuelve a cargar la pantalla para subir el reporte.', { exact: true }).count()
    comprobar(ayuda === 1 && (await pagina.getByText(/Quita o vuelve a subir/).count()) === 0 && (await subirReporte(pagina).isDisabled()) && (await reportes()) === 0,
      `[Maestranza 390] 1e. debajo dice «Vuelve a cargar la pantalla para subir el reporte.», no «Quita o vuelve a subir», y «Subir reporte» no se deja tocar`)
    // Ya se sabe vieja: la foto que se elija ahora ni sube. Al recargar, como
    // pide el aviso, quedaría suelta.
    const s1 = corte.storage.length
    await pagina.locator('input[type="file"]:not([capture])').first().setInputFiles(fotos.a)
    const noSubio = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'No se subió' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-otra-foto.png'), fullPage: true })
    comprobar(noSubio.endsWith(': No se subió: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.') && corte.storage.length === s1
      && (await pagina.getByRole('button', { name: /^Volver a subir/ }).count()) === 0 && (await subidas()).length === 0,
      `[Maestranza 390] 1e. la foto elegida después no sube, lo dice y no ofrece «Reintentar» («${noSubio}»; ${corte.storage.length - s1} pedidos a Storage)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1e. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Descubierta al enviar: lo dice el aviso junto al botón; el de arriba está,
  // pero sin región que lo anuncie otra vez, y la foto no suma otra alerta
  // (trigésima pasada: el lector lo oía dos veces seguidas).
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    corte.despliegue = true
    await subirReporte(pagina).click()
    const dice = limpio(await hasta(() => pagina.locator('main [role="alert"]').filter({ hasText: SE_ACTUALIZO }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const quitada = !(await hasta(() => existe('fotos-reporte-diario', ruta), (v) => v === false, 10000))
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 5000))
    await pagina.waitForTimeout(800)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-enviar.png'), fullPage: true })
    comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta: no se registró. Copia lo escrito, vuelve a cargar la pantalla y elige las fotos otra vez.',
      `[Maestranza 390] 1e. «Subir reporte» desde la pestaña vieja pide elegir las fotos otra vez («${dice}»)`)
    comprobar(quitada && (await miniaturas(pagina)) === 0 && (await reportes()) === 0 && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1e. la foto se quita de Storage y de la pantalla, no hay reporte y lo escrito sigue para copiarlo (quitada ${quitada})`)
    comprobar(arriba === `${TEXTO_VIEJA} Volver a cargar` && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0 && (await pagina.locator('[data-fotos-quitadas]').count()) === 0,
      `[Maestranza 390] 1e. arriba lo dice sin región que lo anuncie otra vez, y la foto no suma su propia alerta («${arriba}»)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1e. al enviar, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. El despliegue de todos los días: el servidor nuevo conoce las acciones
  // de la pestaña (la clave de sus ids dura 14 días y Vercel la conserva), así
  // que nada vuelve 404. Antes la pestaña no se enteraba, `router.refresh()`
  // recargaba el documento entero y se perdía lo escrito y la foto (X3 de la
  // crítica de la trigésima). Ahora la pregunta por los avisos trae de qué
  // despliegue es el servidor.
  if (corre('1i-volver')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    comprobar(Boolean(corte.compilacion), `[Maestranza 390] 1i. la pantalla trae de qué compilación es («${corte.compilacion}»)`)
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    await vigilarLaRegionDeArriba(pagina)
    const d0 = corte.documentos
    const r0 = corte.rsc
    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    await pagina.waitForTimeout(2000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1i-al-volver.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto')
    comprobar(corte.reescritas > 0 && corte.documentos === d0 && corte.rsc === r0 && mismo && escrito === asunto,
      `[Maestranza 390] 1i. el servidor nuevo contesta la pregunta (${corte.reescritas} respuestas de otra compilación) y la pantalla no se recarga ni se repinta: lo escrito sigue (${corte.rsc - r0} pedidos RSC, ${corte.documentos - d0} documentos)`)
    comprobar(arriba === `${TEXTO_NUEVA} Volver a cargar` && (await pagina.locator('[data-pestana-vieja="nueva"]').count()) === 1,
      `[Maestranza 390] 1i. arriba dice que el sistema se actualizó y que termine lo que está haciendo («${arriba}»)`)
    const region = await regionDeArriba(pagina)
    comprobar(region.rol === 'status' && region.vacia === true,
      `[Maestranza 390] 1i. en una región role=status montada antes que su texto (role ${region.rol}, vacía primero ${region.vacia})`)
    comprobar(Boolean(ruta) && (await miniaturas(pagina)) === 1 && (await existe('fotos-reporte-diario', ruta)) && (await pagina.locator('[data-fotos-quitadas]').count()) === 0 && !(await subirReporte(pagina).isDisabled()),
      `[Maestranza 390] 1i. la foto sigue y «Subir reporte» también: con la acción viva el reporte todavía entra`)
    // «Volver a cargar»: antes de recargar, quita la foto que nadie va a nombrar
    // (X4 de la crítica). La recarga se ve en la marca de `window`: el pedido del
    // documento lo hace el service worker, y no pasa por esta sesión de CDP.
    await Promise.all([
      pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}),
      pagina.locator('[data-pestana-vieja]').getByRole('button', { name: 'Volver a cargar' }).click(),
    ])
    corte.despliegue = false
    corte.conservaIds = false
    await quieta(pagina)
    const quitada = !(await existe('fotos-reporte-diario', ruta))
    const recargo = !(await mismoDocumento(pagina))
    const avisos = await pagina.locator('[data-pestana-vieja]').count()
    comprobar(recargo && quitada && avisos === 0,
      `[Maestranza 390] 1i. «Volver a cargar» quita la foto ya subida y recién después recarga; la pantalla nueva sale sin aviso (quitada ${quitada}, recargó ${recargo}, ${avisos} avisos)`)
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. Lo mismo sin salir de la pantalla: el sondeo de cada minuto.
  if (corre('1i-sondeo')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    const r0 = corte.rsc
    corte.despliegue = true
    corte.conservaIds = true
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 75000))
    const mismo = await mismoDocumento(pagina)
    comprobar(arriba.startsWith(TEXTO_NUEVA) && mismo && corte.documentos === d0 && corte.rsc === r0 && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1i. sin salir, el sondeo de cada minuto lo dice arriba sin recargar ni repintar (${corte.rsc - r0} pedidos RSC, mismo documento ${mismo})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sondeo, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. Sin señal al volver: la pregunta no llega y no se repinta. Antes Next
  // pedía la pantalla entera al navegador, salía la página sin conexión y se
  // llevaba lo escrito (D1 de diseño y H2 de funcionamiento, de main). Y al
  // volver la señal, con la acción viva, el reporte entra desde la pestaña
  // del despliegue anterior.
  if (corre('1i-sin-senal')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    await contexto.setOffline(true)
    await salirYVolver(pagina)
    await pagina.waitForTimeout(4000)
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto').catch(() => '')
    const titulo = await pagina.title().catch(() => '')
    const fotoSigue = await miniaturas(pagina)
    await contexto.setOffline(false)
    comprobar(mismo && corte.documentos === d0 && escrito === asunto && fotoSigue === 1 && (await pagina.locator('[data-pestana-vieja]').count()) === 0,
      `[Maestranza 390] 1i. sin señal, al volver tras 31 s no sale la página sin conexión: lo escrito y la foto siguen y arriba no dice nada («${titulo}», mismo documento ${mismo})`)

    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    await hasta(() => avisoDeArriba(pagina), Boolean, 15000)
    const n0 = await reportes()
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      subirReporte(pagina).click(),
    ])
    await quieta(pagina)
    const [rd] = await consulta(
      `select r.id, (select count(*)::int from reporte_diario_fotos f where f.reporte_id = r.id and f.ruta = $2) as fotos
       from reportes_diarios r where r.asunto = $1 order by r.creado_en desc limit 1`,
      [asunto, ruta],
    )
    const llego = new URL(pagina.url()).pathname
    corte.despliegue = false
    corte.conservaIds = false
    comprobar((await reportes()) === n0 + 1 && rd?.fotos === 1 && llego === `/reportes-diarios/${rd?.id}`,
      `[Maestranza 390] 1i. con la acción viva, «Subir reporte» desde la pestaña del despliegue anterior entra con su foto y lleva al reporte (${llego})`)
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sin señal y al enviar, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  // Su costo, como se lo pondría RR. HH.: las horas del reporte que entró pasan
  // al costeo, y el aviso de «Horas… que esperan su costo» no queda prendido
  // para probar-reporte-diario.
  await consulta(
    `insert into trabajador_costos (trabajador_id, costo_mensual) select id, 1680 from trabajadores where nombres = $1
      and not exists (select 1 from trabajador_costos c where c.trabajador_id = trabajadores.id)`,
    [persona],
  )
  await consulta(`update trabajadores set activo = false where nombres = $1`, [persona])
}

// ------------------------------------------- 1f. La planilla sin internet del kardex (Almacén)
if (corre('1f')) {
  const codigo = `QA-VIEJA-P-${sello}`
  const materialId = await materialPropio(codigo, `Disco de corte de la pestaña vieja ${sello}`)
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.almacen])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const movimientos = async () => Number((await consulta(`select count(*) n from movimientos_materiales where material_id = $1`, [materialId]))[0].n)
  const sueltas = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'evidencias-almacen' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from movimientos_materiales m where m.foto_ruta = o.name)`, [yo, desde])).map((o) => o.name)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  let unidad = null
  libro.getWorksheet('Unidades')?.eachRow((f, n) => {
    if (n > 1 && !unidad && f.getCell(1).value) unidad = String(f.getCell(1).value)
  })
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
  const salidas = libro.getWorksheet('Salidas')
  salidas.getCell(5, 1).value = new Date(Date.UTC(a, m - 1, d))
  salidas.getCell(5, 3).value = codigo
  salidas.getCell(5, 6).value = 1
  salidas.getCell(5, 7).value = `Vale de la pestaña vieja ${sello}`
  salidas.getCell(5, 8).value = unidad
  salidas.getCell(5, 9).value = 'Soldador de banco'
  const llena = join(archivos, `planilla-vieja-${sello}.xlsx`)
  await libro.xlsx.writeFile(llena)
  await pagina.getByRole('button', { name: /sin internet/i }).first().click()
  await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  const foto = v.locator('input[type=file][aria-label^="Elegir la foto de la salida"]').first()
  await foto.waitFor({ state: 'attached', timeout: 30000 })
  await foto.setInputFiles(fotos.e)
  const boton = v.getByRole('button', { name: /^Registrar 1 movimiento/ })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const a0 = corte.acciones
  const s0 = corte.storage.length
  corte.despliegue = true
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 30000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1f-planilla.png') })
  const alertas = await v.getByRole('alert').filter({ hasText: /actualizó/ }).count()
  const fila = limpio(await v.getByText('No salió: el sistema se actualizó.').first().innerText().catch(() => ''))
  const registrarOtraVez = await v.getByRole('button', { name: /^Registrar/ }).count()
  const enStorage = corte.storage.slice(s0).filter((x) => x.includes('evidencias-almacen'))
  comprobar(resumen === 'No se registró ninguno; 1 no salió porque el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y elige la planilla y sus fotos otra vez: lo registrado no se duplica.',
    `[Almacén 1280] 1f. la planilla desde la pestaña vieja: el resumen enfocado dice la causa y qué hacer («${resumen}»)`)
  comprobar(alertas === 0 && fila === 'No salió: el sistema se actualizó.' && registrarOtraVez === 0 && (await v.getByRole('button', { name: 'Volver a cargar la pantalla' }).count()) === 1,
    `[Almacén 1280] 1f. la fila dice «${fila}» sin alerta propia (${alertas}); no queda «Registrar» (${registrarOtraVez}) y sí «Volver a cargar la pantalla»`)
  comprobar(corte.acciones - a0 === 1 && (await movimientos()) === m0 && (await hasta(sueltas, (l) => l.length === 0, 10000)).length === 0,
    `[Almacén 1280] 1f. una sola llamada, ningún movimiento y ninguna foto suelta (${corte.acciones - a0} llamada; Storage: ${enStorage.join(', ') || 'nada'})`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Almacén 1280] 1f. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1g. La cotización con cliente nuevo (Ventas)
if (corre('1g')) {
  // Un RUC válido que nadie tiene: el cliente nuevo no llega a crearse.
  const [{ n: ruc }] = await consulta(`select n from (select '209' || lpad($1::text, 7, '0') || d as n from generate_series(0, 9) d) x
                                       where public.ruc_es_valido(n) and not exists (select 1 from clientes c where c.numero_documento = x.n) limit 1`, [sello])
  const numero = `QA-VIEJA-COT-${sello}`
  const razon = `Transportes de la pestaña vieja ${sello}`
  const clientes = async () => Number((await consulta(`select count(*) n from clientes where razon_social = $1`, [razon]))[0].n)
  const cotizaciones = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  if (!(await d.locator('#cot-razon').count())) await d.getByRole('button', { name: 'Es un cliente nuevo' }).click()
  await d.locator('#cot-tipo-doc').selectOption('RUC')
  await d.locator('#cot-num-doc').fill(ruc)
  await d.locator('#cot-razon').fill(razon)
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  const a0 = corte.acciones
  corte.despliegue = true
  for (const vez of [1, 2]) {
    await subir.click()
    await hasta(() => corte.acciones - a0, (n) => n >= vez, 20000)
    const dice = limpio(await hasta(() => d.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => /actualizó|Vuelve a intentar/.test(t ?? ''), 20000))
    comprobar(dice.startsWith(SE_ACTUALIZO) && !/Vuelve a intentar/.test(dice),
      `[Ventas 1280] 1g. cotización con cliente nuevo desde la pestaña vieja, intento ${vez}: dice que hay que recargar, no «Vuelve a intentar» («${dice}»)`)
  }
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1g-cotizacion.png') })
  comprobar(corte.acciones - a0 === 2 && (await clientes()) === 0 && (await cotizaciones()) === 0,
    `[Ventas 1280] 1g. una llamada por intento, sin cliente ni cotización nuevos (${corte.acciones - a0} llamadas)`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Ventas 1280] 1g. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1h. El plano a dos áreas (Diseño)
if (corre('1h')) {
  // Un plano va en una etapa de su orden, como en probar-archivo-sin-dejarlo-suelto;
  // en la orden con plan propio la base pide quién lo elaboró.
  const [orden] = await consulta(`select o.id, e.id as etapa_id, o.plan_etapas_manual from ordenes_trabajo o join ot_etapas e on e.orden_id = o.id
                                  where o.estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') order by o.numero limit 1`)
  const integrante = orden.plan_etapas_manual
    ? (await consulta(`insert into ot_equipo_diseno (orden_id, nombre, funcion) values ($1, 'QA banco Diseño', 'COLABORADOR')
                       on conflict (orden_id, lower(btrim(nombre))) do update set nombre = excluded.nombre returning id`, [orden.id]))[0].id
    : null
  const [plano] = await consulta(`insert into ot_planos (orden_id, numero_plano, nombre, etapa_id, integrante_diseno_id)
                                  values ($1, $2, 'Plano de la pestaña vieja', $3, $4) returning id`, [orden.id, `QA-VIEJA-PL-${sello}`, orden.etapa_id, integrante])
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.diseno])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'planos-privados' and o.name like $1 and o.created_at >= $2
        and not exists (select 1 from ot_plano_versiones v where v.ruta_storage = o.name)`, [`${yo}/%`, desde])).map((o) => o.name)
  const versiones = async () => Number((await consulta(`select count(*) n from ot_plano_versiones where plano_id = $1`, [plano.id]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno)
  await ir(pagina, `${BASE}/ordenes/${orden.id}/planos?plano=${plano.id}`)
  const archivo = pagina.locator('#version-archivo')
  await archivo.waitFor({ state: 'attached', timeout: 30000 })
  const formulario = archivo.locator('xpath=ancestor::form')
  await formulario.getByLabel('Maestranza', { exact: true }).check()
  await formulario.getByLabel('Producción', { exact: true }).check()
  await archivo.setInputFiles({ name: `QA-VIEJA-PL-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-VIEJA-PL-${sello}`]) })
  const a0 = corte.acciones
  const s0 = corte.storage.length
  corte.despliegue = true
  await formulario.getByRole('button', { name: 'Enviar a revisión' }).click()
  const dice = limpio(await hasta(() => formulario.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')), (t) => /actualizó|Falta/.test(t ?? ''), 30000))
  await pagina.waitForTimeout(1500)
  const enStorage = corte.storage.slice(s0).filter((x) => x.includes('planos-privados'))
  const subidasPl = enStorage.filter((x) => x.startsWith('POST')).length
  const borrados = enStorage.filter((x) => x.startsWith('DELETE')).length
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1h-plano.png') })
  comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta. Copia lo escrito y vuelve a cargar la pantalla.',
    `[Diseño 1280] 1h. el plano a Maestranza y Producción desde la pestaña vieja dice solo que hay que recargar, sin «Vuelve a enviar sin cambiar el archivo» («${dice}»)`)
  comprobar(corte.acciones - a0 === 1 && subidasPl === 1 && borrados === 1 && (await versiones()) === 0 && (await hasta(sueltos, (l) => l.length === 0, 10000)).length === 0,
    `[Diseño 1280] 1h. una sola llamada, una subida y su borrado, ninguna versión y ningún PDF suelto (${corte.acciones - a0} llamada; Storage: ${enStorage.join(', ')})`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Diseño 1280] 1h. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1j. La ventana que pregunta por su envío anterior (Requerimientos)
if (corre('1j')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/requerimientos`)
  const boton = pagina.getByRole('button', { name: /^Nuevo requerimiento/ }).first()
  const v = pagina.getByRole('dialog')
  await vigilarLaRegionDeArriba(pagina)
  // Al abrir, la ventana pregunta si su envío anterior entró (`consultarEnvio`):
  // desde la pestaña vieja vuelve 404, y antes se callaba (H3 de funcionamiento).
  corte.despliegue = true
  await boton.click()
  await v.waitFor()
  const enVentana = limpio(await hasta(() => v.locator('[data-ventana-vieja]').innerText().catch(() => ''), Boolean, 15000))
  const enRegion = await v.locator('[role="status"] [data-ventana-vieja]').count()
  const arriba = await avisoDeArriba(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1j-ventana.png') })
  comprobar(enVentana === TEXTO_VENTANA && enRegion === 1 && arriba.startsWith(TEXTO_VIEJA) && (await pagina.locator('[data-region-pestana-vieja]').count()) === 1,
    `[Requerimientos 1280] 1j. al abrir «Nuevo requerimiento», la pregunta por el envío anterior descubre la pestaña vieja: la ventana lo dice en una región que lo anuncia, y arriba también («${enVentana}»)`)
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  await hasta(() => v.count(), (n) => n === 0, 5000)
  // Abierta otra vez, ya sabida vieja: nace con el aviso, y lo nombra su aria-describedby.
  await boton.click()
  await v.waitFor()
  const alAbrir = await v.locator('[data-ventana-vieja]').count()
  const sinRegion = (await v.locator('[role="status"] [data-ventana-vieja]').count()) === 0
  const describe = await v.evaluate((d) => (d.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '').join(' | '))
  comprobar(alAbrir === 1 && sinRegion && describe.includes(TEXTO_VENTANA),
    `[Requerimientos 1280] 1j. abierta otra vez, la ventana nace con el aviso, sin región, y su aria-describedby lo nombra («${describe}»)`)
  await pagina.keyboard.press('Escape')
  comprobar(errores.length === 0, `[Requerimientos 1280] 1j. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1k. El PDF de la orden, dos veces (Administración)
if (corre('1k')) {
  const [ot] = await consulta(
    `select o.id, o.numero from ordenes_trabajo o
     where not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero limit 1`,
  )
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.administracion])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [yo, desde])).length
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/ordenes/${ot?.id}`)
  const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot?.id}, #subir-pdf-${ot?.id} input[type="file"]`).first()
  if (!ot || (await campo.count()) === 0) {
    comprobar(false, `[Administración 1280] 1k. hay una orden sin PDF que ofrezca «Subir el PDF de la orden» (${ot?.numero ?? 'ninguna'})`)
  } else {
    corte.despliegue = true
    const dicen = []
    const subieron = []
    for (const vez of [1, 2]) {
      const s0 = corte.storage.length
      await campo.setInputFiles({ name: `orden-vieja-${vez}-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Pestaña vieja ${vez} ${sello}`]) })
      dicen.push(limpio(await hasta(() => pagina.locator('main').innerText().then((t) => t.match(/[^.]*se actualizó[^.]*\.[^.]*\./)?.[0] ?? ''), Boolean, 30000)))
      await pagina.waitForTimeout(1500)
      subieron.push(corte.storage.slice(s0).filter((x) => x.startsWith('POST')).length)
    }
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1k-pdf.png') })
    corte.despliegue = false
    const [{ n }] = await consulta(`select count(*)::int n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN'`, [ot.id])
    comprobar(dicen.every((d) => d.includes(SE_ACTUALIZO)) && subieron[0] === 1 && (await hasta(sueltos, (s) => s === 0, 10000)) === 0 && n === 0,
      `[Administración 1280] 1k. la primera vez, todavía sin saberse vieja, sube el PDF, la acción vuelve 404 y se quita; la orden sigue sin PDF («${dicen[0]}»)`)
    comprobar(subieron[1] === 0,
      `[Administración 1280] 1k. la segunda, ya sabida vieja, ni lo sube (${subieron[1]} subidas a Storage; «${dicen[1]}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1k. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
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
  // «Reportar día» es de las órdenes de antes del plan de etapas propio: en las
  // demás se reporta por tarea, con produccion.reportar_tarea, que el OPERARIO
  // no tiene, y la actividad sin etapa no entra. Toda orden nueva nace con plan
  // propio y la base no deja cambiarlo: en el banco, y solo aquí, la 0001-2026
  // vuelve a ser «de antes» con los disparadores apagados, como hace
  // probar-documentos-al-elegir. Antes la parte solo pasaba si esa suite había
  // corrido (vigesimonovena pasada).
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo where numero = '0001-2026'`)
  const sinDisparadores = async (sql, valores) => {
    await consulta('begin')
    await consulta('set local session_replication_role = replica')
    await consulta(sql, valores)
    await consulta('commit')
  }
  if (orden?.plan_etapas_manual) await sinDisparadores(`update public.ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
  // La cuenta y la actividad, como postgres lo que no tiene pantalla en el banco
  // (no hay cuentas OPERARIO) y con la sesión de Diseño la actividad, que pasa
  // por su disparador. Peso 0: no mueve el avance de la orden.
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
  // Activa solo mientras corre esta parte: al final se desactiva, y no queda una
  // cuenta OPERARIO con la clave del banco entre una suite y otra. Cambiar el
  // estado de un usuario es de administrador (fn_usuario_proteger_rol): aquí,
  // con los disparadores apagados.
  await sinDisparadores(`update public.usuarios set activo = true where correo = $1`, [CUENTAS.operario])
  try {
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
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-desenlace.png'), fullPage: true })
    corte.despliegue = false
    comprobar(desenlaceGiro.includes('El reporte que se estaba enviando no se registró: el sistema se actualizó') && desenlace390 === desenlaceGiro && (await boton().getAttribute('aria-disabled')) === null && (await avances()).length === 0,
      `[Operario] 3. el desenlace sale en la copia a la vista, girado y de vuelta, y el botón se libera («${desenlaceGiro}»; a 390 «${desenlace390}»)`)

    // Y el reporte entra: el banco ya manda `[]` a la columna jsonb.
    await ir(pagina, `${BASE}/ordenes/${orden?.id}?vista=actividades`)
    await boton().click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.getByRole('button', { name: '25 %' }).click()
    await ventana.locator('input[name="nota"]').fill(`${marca} entra`)
    const verde = await vigilarElVerde(pagina, 'Avance del día reportado')
    await ventana.getByRole('button', { name: 'Reportar', exact: true }).click()
    const [fila] = await hasta(avances, (r) => r.length === 1, 15000)
    comprobar(fila && Number(fila.avance_pct) === 25 && Array.isArray(fila.materiales_usados) && fila.materiales_usados.length === 0,
      `[Operario 390] 3. el reporte del día entra, con materiales_usados [] (${JSON.stringify(fila?.materiales_usados)})`)
    // Al ponerse al día, la página cambia el «Reportar día» de hoy por «Corregir
    // el de hoy» y «Otro día»: el verde es de la actividad y se queda; antes se
    // iba a los 300 ms (vigesimonovena pasada).
    await hasta(() => deLaActividad('button, span').allInnerTexts().then((t) => /Corregir el de hoy|Reportado hoy/.test(t.join(' '))), Boolean, 15000)
    await pagina.waitForTimeout(1500)
    const verde390 = await aLaVista()
    const verdes = await verde.leer()
    await pagina.setViewportSize(GIRADO)
    await pagina.waitForTimeout(800)
    const verdeGiro = await aLaVista()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-verde-girado.png') })
    comprobar(verde390.includes('Avance del día reportado.') && verdes[0] === true,
      `[Operario 390] 3. «Avance del día reportado.» sigue a la vista tras ponerse al día, y salió primero en una región montada desde antes («${verde390}», ${JSON.stringify(verdes)})`)
    comprobar(verdeGiro.includes('Avance del día reportado.'), `[Operario girado a 844] 3. la otra copia también lo dice («${verdeGiro}»)`)
    comprobar(errores.length === 0, `[Operario] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  } finally {
    await sinDisparadores(`update public.usuarios set activo = false where correo = $1`, [CUENTAS.operario])
  }
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

/**
 * Las fotos de un envío que se cierra a medias, y lo que la traba deja dicho
 * (vigesimosexta a vigesimoctava pasadas del PR #148), con clic real y la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El supervisor de Maestranza reporta un trabajo sin orden:
 *      a. cierra la ventana mientras el reporte va en camino: entra con su
 *         foto y la foto sigue en Storage (antes se quitaba al cerrar y el
 *         reporte quedaba nombrando una foto que no existía); cuando entra, el
 *         botón se libera y «se sigue enviando» no asoma junto al verde
 *         mientras la página se pone al día (lo hacía: se miraba el envío de
 *         `useEnvio`, que sigue encendido durante esa puesta al día);
 *      b. sin respuesta y con «Cancelar», el servidor lo recibe después: la
 *         foto se queda, porque no se sabe si entró;
 *      c. mientras se envía, el selector y los campos están trabados (una
 *         foto elegida entonces se perdía, y la ✕ quitaba la que el envío
 *         nombraba); cierra en vuelo: «Reportar» gira con el cursor encima, no
 *         abre otra ventana y dice que sigue enviándose (la ventana vuelta a
 *         abrir salía vacía, girando sin decir por qué); vuelve rechazado: se
 *         quita su foto y se dice que no se registró;
 *      d. quita con ✕ una foto que todavía sube y en otra pestaña entra
 *         Logística: la foto se quita cuando vuelve su cuenta (antes el borrado
 *         salía con la sesión de Logística, volvía vacío y la foto quedaba
 *         suelta para siempre).
 *   2. Requerimientos, en el celular, cierra el ingreso de un vehículo
 *      mientras se envía: entra con su foto. Si además la respuesta se pierde
 *      y el servidor lo recibe después, entra igual y junto al botón se dice
 *      que no llegó la respuesta. Antes la base lo rechazaba («La foto 1 no
 *      terminó de subir») y nada lo decía. Si ya había entrado la primera vez
 *      y se reenvía con otra foto, cerrado en vuelo: se dice sin rojo, la foto
 *      nueva se quita y la primera se queda.
 *   3. La salida del mismo vehículo, cerrada mientras se envía: entra con su foto.
 *   4. Logística elige el comprobante de una OC directa con la traba puesta:
 *      al volver, el anuncio no lee el pie del campo («toca», «haz clic», «KB»).
 *   5. Almacén registra 1 material del conteo inicial: el cursor va al resumen.
 *
 * La pausa va con CDP: en la etapa del pedido (no llegó al servidor) o en la
 * de la respuesta (ya se cumplió). «Carrera» corta el pedido en el navegador y
 * lo manda al servidor unos segundos después, como una señal que llega tarde.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import ExcelJS from 'exceljs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  mtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  almacen: process.env.ALMACEN ?? 'almacen.local@metalwork.test',
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
/** Espera hasta que `leer` dé algo que cumpla `cumple`, o se acabe el tiempo; devuelve lo último leído. */
async function hasta(leer, cumple, ms = 20000) {
  const fin = Date.now() + ms
  let ultimo = await leer()
  while (!cumple(ultimo) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 300))
    ultimo = await leer()
  }
  return ultimo
}
/**
 * Mira en la página, cada 30 ms, si el aviso verde y el «se sigue enviando»
 * llegan a verse a la vez, hasta 1,5 s después de que aparece el verde: tras el
 * ok la página se pone al día y el envío de `useEnvio` sigue encendido.
 */
const vigilarJunto = (pagina, verde) =>
  pagina.evaluate(async (verde) => {
    const fin = Date.now() + 20000
    let hasta = Infinity
    while (Date.now() < Math.min(fin, hasta)) {
      const t = document.body.innerText
      if (t.includes(verde)) {
        if (t.includes('se sigue enviando')) return true
        if (hasta === Infinity) hasta = Date.now() + 1500
      }
      await new Promise((r) => setTimeout(r, 30))
    }
    return false
  }, verde).catch(() => null)
const esperarSubidas = (pagina) => pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    // El corte a propósito deja su error de red en la consola.
    if (m.type() === 'error' && !t.includes('_next/hmr') && !t.includes('WebSocket') && !/Failed to fetch|ERR_CONNECTION_RESET|net::/.test(t)) errores.push(t.slice(0, 300))
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

  // `regla`: la próxima acción de servidor cuyo cuerpo lleva `marca` se detiene
  // en `etapa` ('Request': todavía no llegó al servidor; 'Response': ya se
  // cumplió) hasta `soltar(como)`: 'seguir', 'cortar' o 'carrera' (se corta en
  // el navegador y llega al servidor `demora` ms después).
  // `subida`: la respuesta de la próxima foto que sube a ese bucket se detiene
  // hasta `soltarSubida()`; la foto ya está en Storage.
  const cdp = await contexto.newCDPSession(pagina)
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*', requestStage: 'Response' }] })
  const corte = { regla: null, retenidas: 0, esperan: [], subida: null, subidasRetenidas: 0, esperanSubidas: [], demora: 4000, repeticiones: [] }
  corte.soltar = (como = 'seguir') => {
    for (const listo of corte.esperan.splice(0)) listo(como)
  }
  corte.soltarSubida = () => {
    for (const listo of corte.esperanSubidas.splice(0)) listo()
  }
  const bytes = (r) =>
    r.postDataEntries?.length ? Buffer.concat(r.postDataEntries.map((x) => Buffer.from(x.bytes ?? '', 'base64'))) : Buffer.from(r.postData ?? '')
  cdp.on('Fetch.requestPaused', async (e) => {
    const seguir = () => cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
    const cortar = () => cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => {})
    const enRespuesta = e.responseStatusCode !== undefined || e.responseErrorReason !== undefined
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    const r = corte.regla
    if (r && (r.etapa === 'Response') === enRespuesta && e.request.method === 'POST' && h['next-action'] && bytes(e.request).toString().includes(r.marca)) {
      corte.regla = null
      corte.retenidas++
      const como = await new Promise((listo) => corte.esperan.push(listo))
      if (como === 'cortar') return cortar()
      if (como === 'carrera') {
        const cuerpo = bytes(e.request)
        const cabeceras = Object.fromEntries(Object.entries(e.request.headers).filter(([k]) => !/^(content-length|host|cookie)$/i.test(k)))
        await cortar()
        const repeticion = new Promise((listo) => setTimeout(listo, corte.demora)).then(() =>
          contexto.request.fetch(e.request.url, { method: 'POST', headers: cabeceras, data: cuerpo }).then((x) => x.status()).catch((err) => String(err).slice(0, 120)))
        corte.repeticiones.push(repeticion)
        return
      }
      return seguir()
    }
    if (corte.subida && enRespuesta && e.request.method === 'POST' && e.request.url.includes(`/storage/v1/object/${corte.subida}/`)) {
      corte.subida = null
      corte.subidasRetenidas++
      await new Promise((listo) => corte.esperanSubidas.push(listo))
    }
    return seguir()
  })
  return { pagina, contexto, errores, corte }
}

/** En otra pestaña del mismo navegador se cierra la sesión y entra `correo`: la sesión es de todas. */
async function enOtraPestana(contexto, correo) {
  const otra = await contexto.newPage()
  await ir(otra, `${BASE}/`)
  await Promise.all([
    otra.waitForURL((u) => u.pathname.startsWith('/ingresar'), { timeout: 30000 }),
    otra.evaluate(() => document.querySelector('form[action="/auth/salir"]')?.requestSubmit()),
  ])
  await quieta(otra)
  await otra.fill('input[type="email"]', correo)
  await otra.fill('input[type="password"]', CLAVE)
  await Promise.all([
    otra.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    otra.click('button[type="submit"]'),
  ])
  if (otra.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(otra)
  await otra.close()
}
const trabaAbierta = (pagina) => pagina.locator('dialog[data-traba-otra-cuenta]').evaluate((d) => d.open).catch(() => false)

const sello = Date.now().toString().slice(-6)
const archivos = join(CAPTURAS, 'fotos-al-cerrar')
mkdirSync(archivos, { recursive: true })
// Fotos chicas en JPEG, cada una distinta: se suben tal cual.
const fotos = {}
{
  const p = await (await navegador.newContext()).newPage()
  for (const [n, color] of [['a', '#7a4b2a'], ['b', '#3a3f44'], ['c', '#2a5a7a'], ['d', '#5a7a2a'], ['e', '#7a2a5a'], ['f', '#2a7a6a'], ['g', '#6a2a7a'], ['h', '#7a6a2a'], ['i', '#2a2a7a'], ['j', '#7a7a2a']]) {
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
    fotos[n] = join(archivos, `cierre-${n}-${sello}.jpg`)
    writeFileSync(fotos[n], Buffer.from(b64, 'base64'))
  }
  await p.context().close()
}
const SIN_RESPUESTA = 'No llegó la respuesta'
// SOLO=2,4 corre solo esas partes.
const SOLO = process.env.SOLO?.split(',')
const corre = (parte) => !SOLO || SOLO.includes(parte)

// ------------------------------------------- 1. Reportar un trabajo sin orden (Maestranza)
if (corre('1')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz)
  await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await pagina.fill('#descripcion', `Tolva de prueba de fotos ${sello}`)
  await pagina.fill('#trabajo', 'Cambio de compuerta y refuerzos')
  await Promise.all([
    pagina.waitForURL((u) => /^\/avance\/trabajos\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }),
    pagina.getByRole('button', { name: 'Registrar el trabajo' }).click(),
  ])
  await quieta(pagina)
  const flotaId = new URL(pagina.url()).pathname.split('/').pop()
  const [{ desde }] = await consulta(`select now() as desde`)
  const subidas = () =>
    consulta(`select name from storage.objects where bucket_id = 'fotos-avance' and name like $1 and created_at >= $2 order by created_at`, [`flota/${flotaId}/%`, desde])
      .then((r) => r.map((x) => x.name))
  const vistas = new Set()
  /** Las rutas que subieron desde la última vez que se preguntó. */
  const nuevas = async () => (await subidas()).filter((n) => !vistas.has(n) && vistas.add(n))
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#rf-descripcion') })
  const abrir = async () => {
    await pagina.getByRole('button', { name: 'Reportar', exact: true }).click()
    await ventana.waitFor({ timeout: 10000 })
  }
  const ponerFoto = async (f) => {
    await ventana.locator('input[type="file"]:not([capture])').setInputFiles(f)
    await esperarSubidas(pagina)
  }
  const cerrada = () => hasta(() => ventana.count(), (n) => n === 0, 5000).then((n) => n === 0)
  const reporte = (inicio) =>
    consulta(
      `select a.id, (select count(*)::int from flota_avance_fotos f where f.avance_id = a.id) as fotos,
              (select min(f.ruta_storage) from flota_avance_fotos f where f.avance_id = a.id) as ruta
         from flota_avances a where a.flota_id = $1 and a.descripcion like $2`,
      [flotaId, `${inicio}%`],
    )

  // a. Se cierra mientras el reporte va en camino, antes de que llegue.
  await abrir()
  await ponerFoto(fotos.a)
  const [rutaA] = await nuevas()
  const descA = `Reporte ${sello} A: se cortó la compuerta`
  await ventana.locator('#rf-descripcion').fill(descA)
  corte.regla = { marca: `Reporte ${sello} A`, etapa: 'Request' }
  await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
  const retenidoA = (await hasta(() => corte.retenidas, (n) => n === 1)) === 1
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  const cerroA = await cerrada()
  // Lo que antes se quitaba en el acto, al cerrar.
  await pagina.waitForTimeout(1500)
  const enVueloA = await existe('fotos-avance', rutaA)
  const juntoA = vigilarJunto(pagina, 'Reporte registrado')
  corte.soltar('seguir')
  const [repA] = await hasta(() => reporte(descA), (r) => r.length === 1)
  const avisoA = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'Reporte registrado' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
  const asomaA = await juntoA
  const libreA = (await pagina.getByRole('button', { name: 'Reportar' }).getAttribute('aria-disabled')) === null
  await pagina.waitForTimeout(1500)
  comprobar(asomaA === false && libreA,
    `[Maestranza 1280] a. cuando el reporte entra, el botón se libera y «se sigue enviando» no asoma junto al verde mientras la página se pone al día (asoma ${asomaA}, libre ${libreA})`)
  comprobar(retenidoA && cerroA && enVueloA && repA?.fotos === 1 && repA?.ruta === rutaA && (await existe('fotos-avance', rutaA)) && avisoA.includes('Reporte registrado'),
    `[Maestranza 1280] a. cierra mientras se envía: la foto se queda en el camino, el reporte entra con ella y lo dice junto al botón (retenido ${retenidoA}, cerró ${cerroA}, en vuelo ${enVueloA}, ${repA?.fotos} foto, «${avisoA}»)`)

  // b. Sin respuesta, «Cancelar», y el servidor lo recibe después.
  await abrir()
  await ponerFoto(fotos.b)
  const [rutaB] = await nuevas()
  const descB = `Reporte ${sello} B: se soldaron los refuerzos`
  await ventana.locator('#rf-descripcion').fill(descB)
  corte.regla = { marca: `Reporte ${sello} B`, etapa: 'Request' }
  await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
  const retenidoB = (await hasta(() => corte.retenidas, (n) => n === 2)) === 2
  corte.soltar('carrera')
  const dijoB = limpio(await hasta(() => ventana.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  const cerroB = await cerrada()
  const sigueB = await existe('fotos-avance', rutaB)
  const estadoB = await Promise.all(corte.repeticiones)
  const [repB] = await hasta(() => reporte(descB), (r) => r.length === 1)
  await pagina.waitForTimeout(2000)
  comprobar(retenidoB && dijoB.includes(SIN_RESPUESTA) && cerroB && sigueB && estadoB.at(-1) === 200 && repB?.fotos === 1 && repB?.ruta === rutaB && (await existe('fotos-avance', rutaB)),
    `[Maestranza 1280] b. sin respuesta y «Cancelar»: la foto se queda y el reporte que llega después la encuentra («${dijoB.slice(0, 40)}…», llegó con ${estadoB.at(-1)}, ${repB?.fotos} foto)`)

  // c. Trabado mientras se envía; cerrado en vuelo, el botón gira y no abre
  //    otra; vuelve rechazado y se dice que no se registró.
  await abrir()
  await ponerFoto(fotos.c)
  const [rutaC] = await nuevas()
  await ventana.locator('#rf-descripcion').fill('abc')
  corte.regla = { marca: rutaC, etapa: 'Response' }
  await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
  const retenidoC = (await hasta(() => corte.retenidas, (n) => n === 3)) === 3
  const trabadoC = {
    elegir: await ventana.locator('input[type="file"]:not([capture])').isDisabled(),
    quitar: await ventana.getByRole('button', { name: `Quitar ${basename(fotos.c)}` }).isDisabled(),
    texto: await ventana.locator('#rf-descripcion').isDisabled(),
    cancelar: await ventana.getByRole('button', { name: 'Cancelar' }).isEnabled(),
  }
  comprobar(retenidoC && Object.values(trabadoC).every(Boolean),
    `[Maestranza 1280] c. mientras se envía, el selector de fotos y los campos están trabados y «Cancelar» no (${JSON.stringify(trabadoC)})`)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await cerrada()
  const reportar = pagina.getByRole('button', { name: 'Reportar', exact: true })
  const ocupadoC = await reportar.getAttribute('aria-disabled')
  const cursorC = await pagina.evaluate(() => (document.activeElement?.textContent ?? '').trim())
  const sigueC = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'se sigue enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 5000))
  // Un toque al botón que gira no abre otra ventana.
  await reportar.click({ force: true })
  await pagina.waitForTimeout(800)
  const abrioOtra = (await ventana.count()) > 0
  const enVueloC = await existe('fotos-avance', rutaC)
  await pagina.screenshot({ path: join(CAPTURAS, 'fotos-al-cerrar-sigue-enviando.png') })
  comprobar(ocupadoC === 'true' && cursorC === 'Reportar' && sigueC === 'El reporte se sigue enviando: lo que conteste se dice aquí.' && !abrioOtra && enVueloC,
    `[Maestranza 1280] c. cerrada en vuelo: «Reportar» gira con el cursor encima, no abre otra ventana y dice que sigue enviándose (aria-disabled ${ocupadoC}, cursor en «${cursorC}», «${sigueC}», abrió otra ${abrioOtra}, foto en vuelo ${enVueloC})`)
  corte.soltar('seguir')
  const quitadaC = !(await hasta(() => existe('fotos-avance', rutaC), (v) => !v, 15000))
  const desenlace = limpio(await hasta(
    () => pagina.getByRole('alert').filter({ hasText: 'El reporte que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 10000))
  const libreC = (await reportar.getAttribute('aria-disabled')) === null
  comprobar(quitadaC && libreC && desenlace === 'El reporte que se estaba enviando no se registró: Cuenta qué se hizo hoy',
    `[Maestranza 1280] c. vuelve rechazado: se quita su foto, el botón se libera y junto a él se dice que no se registró y por qué («${desenlace}», libre ${libreC})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'fotos-al-cerrar-rechazo.png'), fullPage: true })
  // Al volver a abrir, la ventana nueva no hereda el rechazo y el de afuera se va.
  await abrir()
  const enLaNueva = limpio((await ventana.locator('[role="alert"]').allInnerTexts()).join(' '))
  const afuera = await pagina.getByRole('alert').filter({ hasText: 'que se estaba enviando' }).count()
  comprobar(!enLaNueva && afuera === 0, `[Maestranza 1280] c. la ventana vuelta a abrir sale limpia («${enLaNueva}», afuera ${afuera})`)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await cerrada()

  // d. ✕ a la que todavía sube, y entra Logística en otra pestaña.
  await abrir()
  corte.subida = 'fotos-avance'
  await ventana.locator('input[type="file"]:not([capture])').setInputFiles(fotos.e)
  await hasta(() => corte.subidasRetenidas, (n) => n === 1)
  const [rutaE] = await hasta(nuevas, (r) => r.length === 1)
  await ventana.getByRole('button', { name: `Quitar ${basename(fotos.e)}` }).click()
  await enOtraPestana(contexto, CUENTAS.logistica)
  const trabada = await hasta(() => trabaAbierta(pagina), Boolean, 10000)
  corte.soltarSubida()
  await pagina.waitForTimeout(2500)
  const conLaTraba = await existe('fotos-avance', rutaE)
  await enOtraPestana(contexto, CUENTAS.mtz)
  const destrabada = await hasta(() => trabaAbierta(pagina).then((v) => !v), Boolean, 10000)
  const quitadaE = !(await hasta(() => existe('fotos-avance', rutaE), (v) => !v, 15000))
  comprobar(trabada && conLaTraba && destrabada && quitadaE,
    `[Maestranza 1280] d. la quitada con ✕ mientras subía espera a que vuelva su cuenta y entonces se quita (trabada ${trabada}, con la traba ${conLaTraba ? 'sigue' : 'ya no está'}, al volver ${quitadaE ? 'quitada' : 'sigue'})`)
  await ventana.getByRole('button', { name: 'Cancelar' }).click().catch(() => {})
  await cerrada()

  const sueltas = await consulta(
    `select o.name from storage.objects o where o.bucket_id = 'fotos-avance' and o.name like $1
        and not exists (select 1 from flota_avance_fotos f where f.ruta_storage = o.name)`,
    [`flota/${flotaId}/%`],
  )
  comprobar(sueltas.length === 0, `[Maestranza 1280] ninguna foto suelta en el trabajo (${sueltas.length})`)
  comprobar(errores.length === 0, `[Maestranza 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 2 y 3. El vehículo (Requerimientos, en el celular)
if (corre('2')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos, CELULAR)
  const [yo] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.requerimientos])
  const [{ desde }] = await consulta(`select now() as desde`)
  const vistas = new Set()
  const nuevas = async () =>
    (await consulta(`select name from storage.objects where bucket_id = 'fotos-vehiculos' and name like $1 and created_at >= $2 order by created_at`, [`${yo.id}/%`, desde]))
      .map((x) => x.name).filter((n) => !vistas.has(n) && vistas.add(n))
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#veh-motivo') })
  const registro = (empresa) =>
    consulta(
      `select v.id, (select count(*)::int from registro_vehiculo_fotos f where f.registro_id = v.id and f.momento = 'INGRESO') as fotos,
              (select min(f.ruta) from registro_vehiculo_fotos f where f.registro_id = v.id and f.momento = 'INGRESO') as ruta
         from registro_vehiculos v where v.empresa = $1`,
      [empresa],
    )
  const llenarIngreso = async (letra, foto) => {
    await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.locator('#veh-motivo').selectOption('COCHERA')
    await ventana.locator('#veh-placa').fill(`C${letra}${sello.slice(-1)}-${sello.slice(0, 3)}`)
    await ventana.locator('#veh-unidad').fill('Camioneta del cliente')
    const empresa = `EMPRESA CIERRE ${sello} ${letra}`
    await ventana.locator('#veh-empresa').fill(empresa)
    await ventana.locator('input[type="file"]:not([capture])').setInputFiles(foto)
    await esperarSubidas(pagina)
    const [ruta] = await nuevas()
    return { empresa, ruta }
  }
  /** Envía y espera a que el pedido quede retenido; `false` si nunca llegó a retenerse. */
  const enviarYRetener = async (empresa) => {
    corte.regla = { marca: empresa, etapa: 'Request' }
    await ventana.getByRole('button', { name: 'Registrar ingreso' }).click()
    const retenido = (await hasta(() => corte.retenidas, (n) => n === vistasRetenidas + 1)) === vistasRetenidas + 1
    vistasRetenidas++
    return retenido
  }
  const cerrarEnVuelo = async () => {
    await pagina.keyboard.press('Escape')
    return (await hasta(() => ventana.count(), (n) => n === 0, 5000)) === 0
  }
  const ingreso = async (letra, foto) => {
    const { empresa, ruta } = await llenarIngreso(letra, foto)
    const retenido = await enviarYRetener(empresa)
    // Mientras se envía, el selector de fotos está trabado.
    const trabado = await ventana.locator('input[type="file"]:not([capture])').isDisabled()
    const cerro = await cerrarEnVuelo()
    const boton = pagina.getByRole('button', { name: 'Registrar ingreso' })
    const ocupado = (await boton.getAttribute('aria-disabled')) === 'true'
    const sigue = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'se sigue enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 5000))
    await pagina.waitForTimeout(1500)
    return { empresa, ruta, cerro, retenido, trabado, ocupado, sigue, enVuelo: await existe('fotos-vehiculos', ruta) }
  }
  let vistasRetenidas = 0
  await ir(pagina, `${BASE}/vehiculos`)

  // 2a. Se cierra mientras va en camino y llega.
  const a = await ingreso('A', fotos.f)
  const juntoIngreso = vigilarJunto(pagina, 'Ingreso registrado')
  corte.soltar('seguir')
  const [regA] = await hasta(() => registro(a.empresa), (r) => r.length === 1)
  const avisoA = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'Ingreso registrado' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
  const asomaIngreso = await juntoIngreso
  comprobar(asomaIngreso === false,
    `[Requerimientos 390] 2a. cuando el ingreso entra, «se sigue enviando» no asoma junto al verde mientras la página se pone al día (asoma ${asomaIngreso})`)
  comprobar(a.retenido && a.trabado && a.ocupado && a.sigue === 'El ingreso se sigue enviando: lo que conteste se dice aquí.',
    `[Requerimientos 390] 2a. mientras se envía, las fotos están trabadas; cerrada en vuelo, «Registrar ingreso» gira y dice que sigue enviándose (retenido ${a.retenido}, trabado ${a.trabado}, ocupado ${a.ocupado}, «${a.sigue}»)`)
  comprobar(a.cerro && a.enVuelo && regA?.fotos === 1 && regA?.ruta === a.ruta && (await existe('fotos-vehiculos', a.ruta)) && avisoA.includes('Ingreso registrado con 1 foto'),
    `[Requerimientos 390] 2a. cierra mientras se envía: el ingreso entra con su foto y lo dice junto al botón (cerró ${a.cerro}, en vuelo ${a.enVuelo}, ${regA?.fotos ?? 'sin'} foto, «${avisoA}»)`)

  // 2b. Se cierra, la respuesta se pierde y el servidor lo recibe después.
  const b = await ingreso('B', fotos.g)
  corte.soltar('carrera')
  const desenlace = limpio(await hasta(
    () => pagina.getByRole('alert').filter({ hasText: 'El ingreso que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
  const estadoB = await Promise.all(corte.repeticiones)
  const [regB] = await hasta(() => registro(b.empresa), (r) => r.length === 1)
  await pagina.waitForTimeout(2000)
  comprobar(b.retenido && b.cerro && b.enVuelo && desenlace.includes(`El ingreso que se estaba enviando: ${SIN_RESPUESTA}`) && estadoB.at(-1) === 200
      && regB?.fotos === 1 && (await existe('fotos-vehiculos', b.ruta)),
    `[Requerimientos 390] 2b. cerrado y sin respuesta: lo dice junto al botón, la foto se queda y el ingreso que llega después entra con ella («${desenlace.slice(0, 70)}…», llegó con ${estadoB.at(-1)}, ${regB?.fotos ?? 'sin'} foto)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'fotos-al-cerrar-ingreso-390.png'), fullPage: true })

  // 2c. La respuesta se pierde con la ventana abierta y el ingreso entra; se
  //     agrega otra foto, se reenvía y se cierra en vuelo. «Ya quedó» se dice
  //     sin rojo y diciendo que lo cambiado no se guardó; la foto nueva se
  //     quita y la primera se queda con su ingreso.
  const c = await llenarIngreso('C', fotos.i)
  const retenidoC1 = await enviarYRetener(c.empresa)
  corte.soltar('carrera')
  const sinRespuestaC = limpio(await hasta(() => ventana.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  const [regC1] = await hasta(() => registro(c.empresa), (r) => r.length === 1)
  await ventana.locator('input[type="file"]:not([capture])').setInputFiles(fotos.j)
  await esperarSubidas(pagina)
  const [rutaJ] = await nuevas()
  const retenidoC2 = await enviarYRetener(c.empresa)
  const cerroC = await cerrarEnVuelo()
  corte.soltar('seguir')
  const yaQuedo = limpio(await hasta(
    () => pagina.getByRole('status').filter({ hasText: 'ya había quedado' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
  const rojoC = await pagina.getByRole('alert').filter({ hasText: 'El ingreso' }).count()
  const quitadaJ = !(await hasta(() => existe('fotos-vehiculos', rutaJ), (v) => !v, 15000))
  const [regC] = await registro(c.empresa)
  await pagina.screenshot({ path: join(CAPTURAS, 'fotos-al-cerrar-ya-quedo-390.png'), fullPage: true })
  comprobar(retenidoC1 && sinRespuestaC.includes(SIN_RESPUESTA) && Boolean(regC1) && retenidoC2 && cerroC
      && yaQuedo === 'El ingreso ya había quedado registrado la primera vez: lo que cambiaste al reenviar no se guardó.' && rojoC === 0
      && quitadaJ && regC?.fotos === 1 && regC?.ruta === c.ruta && (await existe('fotos-vehiculos', c.ruta)),
    `[Requerimientos 390] 2c. «ya quedó» con la ventana cerrada: sin rojo, dice que lo cambiado no se guardó, la foto nueva se quita y la primera se queda («${yaQuedo}», rojos ${rojoC}, nueva quitada ${quitadaJ}, ${regC?.fotos ?? 'sin'} foto)`)

  // 3. La salida del primero, cerrada mientras se envía.
  await ir(pagina, `${BASE}/vehiculos/${regA?.id}`)
  await pagina.getByRole('button', { name: 'Marcar salida' }).click()
  const s = pagina.locator('[role="dialog"]', { has: pagina.locator('textarea[name="observacion"]') })
  await s.waitFor({ timeout: 10000 })
  const obs = `Salida ${sello}: la recoge el conductor`
  await s.locator('textarea[name="observacion"]').fill(obs)
  await s.locator('input[type="file"]:not([capture])').setInputFiles(fotos.h)
  await esperarSubidas(pagina)
  const [rutaS] = await nuevas()
  corte.regla = { marca: `Salida ${sello}`, etapa: 'Request' }
  await s.getByRole('button', { name: 'Registrar salida' }).click()
  const retenidoS = (await hasta(() => corte.retenidas, (n) => n === vistasRetenidas + 1)) === vistasRetenidas + 1
  vistasRetenidas++
  const trabadoS = await s.locator('input[type="file"]:not([capture])').isDisabled()
  await pagina.keyboard.press('Escape')
  const cerroS = (await hasta(() => s.count(), (n) => n === 0, 5000)) === 0
  const ocupadoS = (await pagina.getByRole('button', { name: 'Marcar salida' }).getAttribute('aria-disabled')) === 'true'
  const sigueS = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'se sigue enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 5000))
  await pagina.waitForTimeout(1500)
  const enVueloS = await existe('fotos-vehiculos', rutaS)
  corte.soltar('seguir')
  const [salida] = await hasta(
    () => consulta(
      `select salida_en is not null as salio, (select count(*)::int from registro_vehiculo_fotos f where f.registro_id = v.id and f.momento = 'SALIDA') as fotos
         from registro_vehiculos v where id = $1`, [regA?.id]),
    (r) => r[0]?.salio,
  )
  const sinMarcar = await hasta(() => pagina.getByRole('button', { name: 'Marcar salida' }).count(), (n) => n === 0, 10000)
  comprobar(retenidoS && trabadoS && ocupadoS && sigueS === 'La salida se sigue enviando: lo que conteste se dice aquí.',
    `[Requerimientos 390] 3. mientras se envía, las fotos de la salida están trabadas; cerrada en vuelo, «Marcar salida» gira y dice que sigue enviándose (retenido ${retenidoS}, trabado ${trabadoS}, ocupado ${ocupadoS}, «${sigueS}»)`)
  comprobar(cerroS && enVueloS && salida?.salio && salida?.fotos === 1 && (await existe('fotos-vehiculos', rutaS)) && sinMarcar === 0,
    `[Requerimientos 390] 3. la salida cerrada mientras se envía entra con su foto y la pantalla ya no ofrece «Marcar salida» (cerró ${cerroS}, en vuelo ${enVueloS}, ${salida?.fotos ?? 'sin'} foto)`)
  comprobar(errores.length === 0, `[Requerimientos 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 4. El anuncio al volver no lee el pie del campo (Logística)
if (corre('4')) {
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  await ir(pagina, `${BASE}/compras/ordenes`)
  await pagina.getByRole('button', { name: /Nueva OC directa/ }).first().click()
  const d = pagina.locator('[role="dialog"]', { has: pagina.locator('#ocd-factura') })
  await d.waitFor({ timeout: 20000 })
  await d.locator('#ocd-comprobante').selectOption('false')
  await enOtraPestana(contexto, CUENTAS.almacen)
  const trabada = await hasta(() => trabaAbierta(pagina), Boolean, 10000)
  const nombre = `QA-BOLETA-${sello}.pdf`
  await d.locator('#ocd-factura').setInputFiles({
    name: nombre,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%${'x'.repeat(1500)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`),
  })
  await pagina.waitForTimeout(800)
  await enOtraPestana(contexto, CUENTAS.logistica)
  const destrabada = await hasta(() => trabaAbierta(pagina).then((v) => !v), Boolean, 10000)
  const anuncio = limpio(await hasta(() => pagina.locator('[data-volvio-la-cuenta]').textContent().catch(() => ''), Boolean, 5000))
  const elegido = (await d.getByText(nombre).count()) > 0
  comprobar(trabada && destrabada && elegido && /volvi|cuenta/i.test(anuncio) && !/toca|haz clic|\bKB\b/i.test(anuncio),
    `[Logística 1280] el comprobante elegido con la traba puesta queda en su campo y el anuncio al volver no lee su pie («${anuncio}»; elegido ${elegido})`)
  await d.getByRole('button', { name: 'Cancelar' }).click().catch(() => {})
  comprobar(errores.length === 0, `[Logística 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 5. El conteo inicial lleva el cursor al resumen (Almacén)
if (corre('5')) {
  // Un material propio: un conteo deja fuera de la planilla todo movimiento de antes,
  // y contar uno del catálogo le quitaría la salida a las suites que lo usan.
  const codigo = `QA-CIERRE-${sello}`
  const [{ id: materialId }] = await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, `Trapo de cierre ${sello}`],
  )
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
     select gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Compra de banco', u.id, 2, 'PEN', now() - interval '1 hour'
     from public.usuarios u where u.correo = $2`,
    [materialId, CUENTAS.almacen],
  )
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/conteo-inicial`)).body())
  const hoja = libro.getWorksheet('Conteo')
  let encabezado = 0
  hoja.eachRow((f, n) => {
    if (!encabezado && f.values.includes('Cantidad contada')) encabezado = n
  })
  let elegida = 0
  for (let n = encabezado + 1; n <= hoja.rowCount; n++) {
    if (String(hoja.getCell(n, 1).value) === codigo) {
      elegida = n
      hoja.getCell(n, 5).value = Number(hoja.getCell(n, 4).value) + 1
    } else hoja.getCell(n, 5).value = null
  }
  const lleno = join(archivos, `conteo-cursor-${sello}.xlsx`)
  await libro.xlsx.writeFile(lleno)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const boton = v.getByRole('button', { name: 'Registrar 1 material' })
  await boton.waitFor({ timeout: 30000 })
  await boton.click()
  const resumen = await hasta(
    () => pagina.evaluate(() => {
      const a = document.activeElement
      return a?.getAttribute('role') === 'status' ? a.textContent.replace(/\s+/g, ' ').trim() : `${a?.tagName}`
    }),
    (t) => t.startsWith('Se registró'), 20000,
  )
  comprobar(elegida > 0 && resumen === 'Se registró 1 material.',
    `[Almacén 1280] tras «Registrar 1 material» el cursor va al resumen, que lo dice («${resumen}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'conteo-cursor-resumen.png') })
  comprobar(errores.length === 0, `[Almacén 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)

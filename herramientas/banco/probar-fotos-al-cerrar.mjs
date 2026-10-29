/**
 * Las fotos de un envío que se cierra a medias, y lo que la traba deja dicho
 * (vigesimosexta pasada del PR #148), con clic real y la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. El supervisor de Maestranza reporta un trabajo sin orden:
 *      a. cierra la ventana mientras el reporte va en camino: entra con su
 *         foto y la foto sigue en Storage (antes se quitaba al cerrar y el
 *         reporte quedaba nombrando una foto que no existía);
 *      b. sin respuesta y con «Cancelar», el servidor lo recibe después: la
 *         foto se queda, porque no se sabe si entró;
 *      c. cierra, vuelve a abrir con otra foto y el primero vuelve rechazado:
 *         se quita la foto del rechazado y no la de la ventana nueva, y el
 *         motivo se dice junto al botón;
 *      d. quita con ✕ una foto que todavía sube y en otra pestaña entra
 *         Logística: la foto se quita cuando vuelve su cuenta (antes el borrado
 *         salía con la sesión de Logística, volvía vacío y la foto quedaba
 *         suelta para siempre).
 *   2. Requerimientos, en el celular, cierra el ingreso de un vehículo
 *      mientras se envía: entra con su foto. Si además la respuesta se pierde
 *      y el servidor lo recibe después, entra igual y junto al botón se dice
 *      que no llegó la respuesta. Antes la base lo rechazaba («La foto 1 no
 *      terminó de subir») y nada lo decía.
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
  for (const [n, color] of [['a', '#7a4b2a'], ['b', '#3a3f44'], ['c', '#2a5a7a'], ['d', '#5a7a2a'], ['e', '#7a2a5a'], ['f', '#2a7a6a'], ['g', '#6a2a7a'], ['h', '#7a6a2a']]) {
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
  await hasta(() => corte.retenidas, (n) => n === 1)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  const cerroA = await cerrada()
  // Lo que antes se quitaba en el acto, al cerrar.
  await pagina.waitForTimeout(1500)
  const enVueloA = await existe('fotos-avance', rutaA)
  corte.soltar('seguir')
  const [repA] = await hasta(() => reporte(descA), (r) => r.length === 1)
  const avisoA = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'Reporte registrado' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
  await pagina.waitForTimeout(1500)
  comprobar(cerroA && enVueloA && repA?.fotos === 1 && repA?.ruta === rutaA && (await existe('fotos-avance', rutaA)) && avisoA.includes('Reporte registrado'),
    `[Maestranza 1280] a. cierra mientras se envía: la foto se queda en el camino, el reporte entra con ella y lo dice junto al botón (cerró ${cerroA}, en vuelo ${enVueloA}, ${repA?.fotos} foto, «${avisoA}»)`)

  // b. Sin respuesta, «Cancelar», y el servidor lo recibe después.
  await abrir()
  await ponerFoto(fotos.b)
  const [rutaB] = await nuevas()
  const descB = `Reporte ${sello} B: se soldaron los refuerzos`
  await ventana.locator('#rf-descripcion').fill(descB)
  corte.regla = { marca: `Reporte ${sello} B`, etapa: 'Request' }
  await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
  await hasta(() => corte.retenidas, (n) => n === 2)
  corte.soltar('carrera')
  const dijoB = limpio(await hasta(() => ventana.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  const cerroB = await cerrada()
  const sigueB = await existe('fotos-avance', rutaB)
  const estadoB = await Promise.all(corte.repeticiones)
  const [repB] = await hasta(() => reporte(descB), (r) => r.length === 1)
  await pagina.waitForTimeout(2000)
  comprobar(dijoB.includes(SIN_RESPUESTA) && cerroB && sigueB && estadoB.at(-1) === 200 && repB?.fotos === 1 && repB?.ruta === rutaB && (await existe('fotos-avance', rutaB)),
    `[Maestranza 1280] b. sin respuesta y «Cancelar»: la foto se queda y el reporte que llega después la encuentra («${dijoB.slice(0, 40)}…», llegó con ${estadoB.at(-1)}, ${repB?.fotos} foto)`)

  // c. Cierra, abre otra con otra foto, y el primero vuelve rechazado.
  await abrir()
  await ponerFoto(fotos.c)
  const [rutaC] = await nuevas()
  await ventana.locator('#rf-descripcion').fill('abc')
  corte.regla = { marca: rutaC, etapa: 'Response' }
  await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
  await hasta(() => corte.retenidas, (n) => n === 3)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await cerrada()
  await pagina.waitForTimeout(1500)
  const enVueloC = await existe('fotos-avance', rutaC)
  await abrir()
  await ponerFoto(fotos.d)
  const [rutaD] = await nuevas()
  corte.soltar('seguir')
  const quitadaC = !(await hasta(() => existe('fotos-avance', rutaC), (v) => !v, 15000))
  await pagina.waitForTimeout(1000)
  const siguenD = await existe('fotos-avance', rutaD)
  const enLaNueva = limpio((await ventana.locator('[role="alert"]').allInnerTexts()).join(' '))
  comprobar(enVueloC && quitadaC && siguenD && !enLaNueva.includes('Cuenta qué se hizo hoy'),
    `[Maestranza 1280] c. el rechazado vuelve con otra ventana abierta: se quita su foto, la de la ventana nueva sigue y esa ventana no hereda el rechazo (en vuelo ${enVueloC}, quitada ${quitadaC}, la nueva ${siguenD}, «${enLaNueva}»)`)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()
  await cerrada()
  const quitadaD = !(await hasta(() => existe('fotos-avance', rutaD), (v) => !v, 15000))
  const desenlace = limpio(await hasta(
    () => pagina.getByRole('alert').filter({ hasText: 'El reporte que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 5000))
  comprobar(quitadaD && desenlace.includes('El reporte que se estaba enviando: Cuenta qué se hizo hoy'),
    `[Maestranza 1280] c. al cancelar la nueva se quita su foto, y junto al botón queda por qué no entró el primero («${desenlace}»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'fotos-al-cerrar-rechazo.png'), fullPage: true })

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
  const ingreso = async (letra, foto) => {
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
    corte.regla = { marca: empresa, etapa: 'Request' }
    await ventana.getByRole('button', { name: 'Registrar ingreso' }).click()
    await hasta(() => corte.retenidas, (n) => n === vistasRetenidas + 1)
    vistasRetenidas++
    await pagina.keyboard.press('Escape')
    const cerro = (await hasta(() => ventana.count(), (n) => n === 0, 5000)) === 0
    await pagina.waitForTimeout(1500)
    return { empresa, ruta, cerro, enVuelo: await existe('fotos-vehiculos', ruta) }
  }
  let vistasRetenidas = 0
  await ir(pagina, `${BASE}/vehiculos`)

  // 2a. Se cierra mientras va en camino y llega.
  const a = await ingreso('A', fotos.f)
  corte.soltar('seguir')
  const [regA] = await hasta(() => registro(a.empresa), (r) => r.length === 1)
  const avisoA = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'Ingreso registrado' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
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
  comprobar(b.cerro && b.enVuelo && desenlace.includes(`El ingreso que se estaba enviando: ${SIN_RESPUESTA}`) && estadoB.at(-1) === 200
      && regB?.fotos === 1 && (await existe('fotos-vehiculos', b.ruta)),
    `[Requerimientos 390] 2b. cerrado y sin respuesta: lo dice junto al botón, la foto se queda y el ingreso que llega después entra con ella («${desenlace.slice(0, 70)}…», llegó con ${estadoB.at(-1)}, ${regB?.fotos ?? 'sin'} foto)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'fotos-al-cerrar-ingreso-390.png'), fullPage: true })

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
  await hasta(() => corte.retenidas, (n) => n === vistasRetenidas + 1)
  await pagina.keyboard.press('Escape')
  const cerroS = (await hasta(() => s.count(), (n) => n === 0, 5000)) === 0
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
